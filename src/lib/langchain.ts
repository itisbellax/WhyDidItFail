import fs from 'fs'
import path from 'path'
import { ChatAnthropic } from '@langchain/anthropic'
import { RunnableSequence, RunnableLambda } from '@langchain/core/runnables'
import { ChatPromptTemplate } from '@langchain/core/prompts'
import { StringOutputParser } from '@langchain/core/output_parsers'
import { DynamicTool } from '@langchain/core/tools'
import { createReactAgent } from '@langchain/langgraph/prebuilt'
import { HumanMessage } from '@langchain/core/messages'
import { getRetriever } from './vectorstore'
import type { FailureSnapshot, DiagnosisResult } from '@/types'

const FAILURES_DIR = path.join(process.cwd(), 'src', 'data', 'failures')

// ─── Shared model ───────────────────────────────────────────────────────────

function getModel() {
  return new ChatAnthropic({
    model: 'claude-haiku-4-5-20251001',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  })
}

// ─── Step helpers for the chain ─────────────────────────────────────────────

interface AnalysisStep {
  snapshot: FailureSnapshot
  anomaly: string
  tempDropRate: number // °C per second
  minTemp: number
  maxTemp: number
}

interface RetrievedStep extends AnalysisStep {
  similarCaseDocs: string[]
}

/** Step 1: Analyse temperature curve from the buffer */
function analyzeTemperatureCurve(snapshot: FailureSnapshot): AnalysisStep {
  const frames = snapshot.buffer
  if (frames.length === 0) {
    return {
      snapshot,
      anomaly: 'No temperature data captured before failure',
      tempDropRate: 0,
      minTemp: 0,
      maxTemp: 0,
    }
  }

  const temps = frames.map(f => f.hotendTemp)
  const maxTemp = Math.max(...temps)
  const minTemp = Math.min(...temps)
  const drop = maxTemp - minTemp

  const firstTs = frames[0].timestamp
  const lastTs = frames[frames.length - 1].timestamp
  const durationSec = Math.max((lastTs - firstTs) / 1000, 1)
  const tempDropRate = drop / durationSec

  const target = frames[0].hotendTarget
  const anomaly =
    drop > 5
      ? `Hotend dropped from ${maxTemp.toFixed(1)}°C to ${minTemp.toFixed(1)}°C ` +
        `(−${drop.toFixed(1)}°C in ${durationSec.toFixed(0)}s, target was ${target}°C)`
      : `Hotend temperature was stable near ${maxTemp.toFixed(1)}°C before error triggered`

  return { snapshot, anomaly, tempDropRate, minTemp, maxTemp }
}

/** Step 2: Retrieve similar cases from the knowledge base */
async function retrieveSimilarCases(analysis: AnalysisStep): Promise<RetrievedStep> {
  const retriever = await getRetriever()
  const query = `${analysis.snapshot.errorMessage} temperature drop anomaly: ${analysis.anomaly}`
  const docs = await retriever.invoke(query)
  const similarCaseDocs = docs.map(d => d.pageContent)
  return { ...analysis, similarCaseDocs }
}

/** Step 3: LLM generates structured DiagnosisResult (vision-aware) */
async function generateDiagnosis(retrieved: RetrievedStep): Promise<DiagnosisResult> {
  const model = getModel()

  const systemText = `You are an expert Prusa MK3S+ 3D printer technician.

## Failure Event
Error message: ${retrieved.snapshot.errorMessage}
Anomaly detected in serial data: ${retrieved.anomaly}
Temperature drop rate: ${retrieved.tempDropRate.toFixed(2)} °C/s
Printer model: MK3S+

IMPORTANT: If the error message starts with "[Manual]", this is a user-reported visual issue observed mid-print — NOT a sensor or firmware error. The temperature data may be normal or absent. Focus your diagnosis on the reported issue type and any photo provided, not on temperature anomalies.

## Similar Cases from Knowledge Base
${retrieved.similarCaseDocs.length > 0 ? retrieved.similarCaseDocs.join('\n\n---\n\n') : 'No similar cases found.'}

## Task
Respond with ONLY a valid JSON object — no markdown, no extra text:
{
  "failureType": string,
  "anomalyDetected": string,
  "likelyCause": string,
  "similarCases": string[],
  "fixSteps": string[],
  "confidence": "high" | "medium" | "low"
}`

  // Build message content — add image if snapshot has one
  const snapshot = retrieved.snapshot
  let raw: string

  if (snapshot.imagePath) {
    try {
      const absPath = path.join(process.cwd(), 'public', snapshot.imagePath.replace(/^\//, ''))
      const imageBuffer = fs.readFileSync(absPath)
      const base64 = imageBuffer.toString('base64')
      const ext = path.extname(absPath).slice(1).toLowerCase()
      const mediaType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}` as 'image/jpeg' | 'image/png' | 'image/webp'

      const message = new HumanMessage({
        content: [
          {
            type: 'image_url',
            image_url: { url: `data:${mediaType};base64,${base64}` },
          },
          {
            type: 'text',
            text: systemText + '\n\nA photo of the print has been provided above. Use it to inform your diagnosis.',
          },
        ],
      })
      const response = await model.invoke([message])
      raw = typeof response.content === 'string' ? response.content : JSON.stringify(response.content)
    } catch (err) {
      console.error('[langchain] Failed to load image for vision:', err)
      // Fall back to text-only
      const response = await model.invoke([new HumanMessage(systemText)])
      raw = typeof response.content === 'string' ? response.content : JSON.stringify(response.content)
    }
  } else {
    const response = await model.invoke([new HumanMessage(systemText)])
    raw = typeof response.content === 'string' ? response.content : JSON.stringify(response.content)
  }

  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  const parsed = JSON.parse(cleaned) as DiagnosisResult
  return parsed
}

// ─── A) RAG Retriever ────────────────────────────────────────────────────────

export { getRetriever }

// ─── B) Diagnosis Chain (RunnableSequence) ───────────────────────────────────

export async function buildDiagnosisChain(): Promise<
  RunnableSequence<FailureSnapshot, DiagnosisResult>
> {
  return RunnableSequence.from([
    new RunnableLambda({ func: analyzeTemperatureCurve }),
    new RunnableLambda({ func: retrieveSimilarCases }),
    new RunnableLambda({ func: generateDiagnosis }),
  ])
}

// ─── C) Diagnosis Agent ──────────────────────────────────────────────────────

export async function buildDiagnosisAgent() {
  const model = getModel()

  const readSnapshotTool = new DynamicTool({
    name: 'getFailureSnapshot',
    description:
      'Read a failure snapshot JSON file from disk by its snapshot ID. ' +
      'Returns the full FailureSnapshot including buffer frames and error message.',
    func: async (snapshotId: string): Promise<string> => {
      const filepath = path.join(FAILURES_DIR, `failure-${snapshotId}.json`)
      if (!fs.existsSync(filepath)) {
        return JSON.stringify({ error: `Snapshot not found: ${snapshotId}` })
      }
      const content = fs.readFileSync(filepath, 'utf-8')
      return content
    },
  })

  const queryKbTool = new DynamicTool({
    name: 'queryKnowledgeBase',
    description:
      'Query the Prusa troubleshooting knowledge base for cases similar to a given failure description. ' +
      'Input should be a natural-language description of the failure or error message.',
    func: async (query: string): Promise<string> => {
      const retriever = await getRetriever()
      const docs = await retriever.invoke(query)
      const results = docs.map(d => ({
        content: d.pageContent,
        metadata: d.metadata,
      }))
      return JSON.stringify(results, null, 2)
    },
  })

  const agent = createReactAgent({
    llm: model,
    tools: [readSnapshotTool, queryKbTool],
  })

  return agent
}

// ─── Top-level entry points used by routes ───────────────────────────────────

/** Non-streaming version (kept for compatibility) */
export async function runDiagnosis(snapshotId: string): Promise<DiagnosisResult> {
  return runDiagnosisStreaming(snapshotId, () => {})
}

/**
 * Streaming version — calls `onStatus` before each major step so the HTTP
 * route can push progress events to the client before the final result.
 */
export async function runDiagnosisStreaming(
  snapshotId: string,
  onStatus: (text: string) => void,
): Promise<DiagnosisResult> {
  // 1. Agent reads snapshot + queries KB autonomously
  onStatus('Agent reading snapshot and querying knowledge base…')
  const agent = await buildDiagnosisAgent()
  await agent.invoke({
    messages: [
      new HumanMessage(
        `A 3D print failure has occurred. Snapshot ID: ${snapshotId}. ` +
          'Please read the failure snapshot and query the knowledge base to understand the failure. ' +
          'Summarise what you found — the error, temperature anomaly, and most likely cause.',
      ),
    ],
  })

  // 2. Structured chain pipeline
  const snapshotPath = path.join(FAILURES_DIR, `failure-${snapshotId}.json`)
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8')) as FailureSnapshot

  onStatus('Analysing temperature curve…')
  const analysis = analyzeTemperatureCurve(snapshot)

  onStatus('Retrieving similar cases from knowledge base…')
  const retrieved = await retrieveSimilarCases(analysis)

  onStatus('Generating structured diagnosis…')
  const result = await generateDiagnosis(retrieved)

  return result
}
