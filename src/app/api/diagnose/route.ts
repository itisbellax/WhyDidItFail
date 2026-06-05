import { z } from 'zod'
import { runDiagnosisStreaming } from '@/lib/langchain'

const RequestSchema = z.object({ snapshotId: z.string().uuid() })

export async function POST(request: Request): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const parsed = RequestSchema.safeParse(body)
  if (!parsed.success) {
    return new Response(JSON.stringify(parsed.error.flatten()), { status: 400 })
  }

  const { snapshotId } = parsed.data
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: unknown) {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        )
      }
      try {
        const result = await runDiagnosisStreaming(snapshotId, (text) => {
          send('status', { text })
        })
        send('result', result)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[diagnose] Error:', msg)
        send('error', { message: msg })
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
