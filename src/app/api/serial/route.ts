import { getSerialManager } from '@/lib/serial'
import type { SerialFrame, FailureSnapshot } from '@/types'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  const manager = getSerialManager()
  manager.start()

  const encoder = new TextEncoder()

  // detach() is set inside start() and called from cancel().
  // Declared before ReadableStream so the let binding exists when start() runs.
  let detach: (() => void) | undefined

  const stream = new ReadableStream({
    start(controller) {
      let active = true

      function send(event: string, data: unknown): void {
        if (!active) return
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          )
        } catch {
          active = false
          detach?.()
        }
      }

      const onLine    = (line: string)          => send('line',    { line })
      const onFrame   = (frame: SerialFrame)     => send('frame',   frame)
      const onFailure = (snap: FailureSnapshot)  => send('failure', snap)

      detach = () => {
        active = false
        manager.off('line',    onLine)
        manager.off('frame',   onFrame)
        manager.off('failure', onFailure)
      }

      manager.on('line',    onLine)
      manager.on('frame',   onFrame)
      manager.on('failure', onFailure)
    },
    cancel() {
      detach?.()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection:      'keep-alive',
    },
  })
}
