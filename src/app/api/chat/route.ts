import { ChatAnthropic } from '@langchain/anthropic'
import { getSnapshot } from '@/lib/snapshots'
import type { DiagnosisResult } from '@/types'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ChatRequest {
  snapshotId: string
  messages: ChatMessage[]
  diagnosis?: DiagnosisResult | null
}

export async function POST(request: Request): Promise<Response> {
  let body: ChatRequest
  try {
    body = await request.json() as ChatRequest
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const { snapshotId, messages, diagnosis } = body
  if (!snapshotId || !Array.isArray(messages)) {
    return new Response('Missing snapshotId or messages', { status: 400 })
  }

  const snapshot = getSnapshot(snapshotId)

  const diagnosisContext = diagnosis
    ? `\n## Diagnosis Result\n` +
      `- Failure type: ${diagnosis.failureType}\n` +
      `- Anomaly detected: ${diagnosis.anomalyDetected}\n` +
      `- Likely cause: ${diagnosis.likelyCause}\n` +
      `- Fix steps: ${diagnosis.fixSteps.map((s, i) => `${i + 1}. ${s}`).join('; ')}\n` +
      `- Confidence: ${diagnosis.confidence}`
    : '\nNo structured diagnosis available yet.'

  const systemPrompt =
    `You are an expert Prusa MK3S+ technician assistant helping a user understand and fix a 3D printing failure.\n` +
    `\n## Failure Event\n` +
    `Error: ${snapshot?.errorMessage ?? 'Unknown error'}\n` +
    `Printer model: MK3S+\n` +
    `Frames captured before failure: ${snapshot?.buffer.length ?? 0}\n` +
    diagnosisContext +
    `\n\nBe concise and specific. Reference the diagnosis above when relevant. ` +
    `If asked about steps already listed in the diagnosis, elaborate with more detail.`

  const model = new ChatAnthropic({
    model: 'claude-haiku-4-5-20251001',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  })

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const langchainMessages = [
          { role: 'system' as const, content: systemPrompt },
          ...messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        ]

        const streamResult = await model.stream(langchainMessages)

        for await (const chunk of streamResult) {
          const text = typeof chunk.content === 'string' ? chunk.content : ''
          if (text) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`))
          }
        }

        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[chat] Error:', msg)
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
