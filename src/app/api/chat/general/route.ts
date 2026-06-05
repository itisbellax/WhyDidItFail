import { ChatAnthropic } from '@langchain/anthropic'
import type { SerialFrame } from '@/types'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface GeneralChatRequest {
  messages: ChatMessage[]
  printerFrame?: SerialFrame | null   // optional live context from the dashboard
}

export async function POST(request: Request): Promise<Response> {
  let body: GeneralChatRequest
  try {
    body = await request.json() as GeneralChatRequest
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const { messages, printerFrame } = body
  if (!Array.isArray(messages)) {
    return new Response('Missing messages array', { status: 400 })
  }

  const printerContext = printerFrame
    ? `\n## Live Printer Status\n` +
      `- Hotend: ${printerFrame.hotendTemp.toFixed(1)}°C / target ${printerFrame.hotendTarget.toFixed(1)}°C\n` +
      `- Bed: ${printerFrame.bedTemp.toFixed(1)}°C / target ${printerFrame.bedTarget.toFixed(1)}°C\n` +
      `- Progress: ${printerFrame.percentDone}% (${printerFrame.timeRemainingMins} min remaining)\n` +
      (printerFrame.zPos !== undefined ? `- Z height: ${printerFrame.zPos.toFixed(2)} mm\n` : '') +
      (printerFrame.fanSpeed !== undefined
        ? `- Fan: ${Math.round((printerFrame.fanSpeed / 255) * 100)}%\n`
        : '')
    : '\n## Live Printer Status\nNo live data available (printer may be idle).'

  const systemPrompt =
    `You are PrintMind, an expert assistant for Prusa MK3S+ 3D printing. ` +
    `You help with all aspects of 3D printing: troubleshooting, settings, materials, ` +
    `slicing, maintenance, upgrades, and best practices.\n` +
    printerContext +
    `\n\nGuidelines:\n` +
    `- Be concise and practical — users are often mid-print or mid-repair\n` +
    `- When live printer data is available, reference it when relevant\n` +
    `- For Prusa-specific answers, prefer MK3S+ defaults and known quirks\n` +
    `- If a question is outside 3D printing, gently redirect`

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
        console.error('[chat/general] Error:', msg)
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
