import fs from 'fs'
import path from 'path'
import { getSerialManager } from '@/lib/serial'

export const dynamic = 'force-dynamic'

export async function POST(req: Request): Promise<Response> {
  const { reason, imageDataUrl } = await req.json() as { reason?: string; imageDataUrl?: string }
  const manager = getSerialManager()
  const snapshot = manager.manualSnapshot(reason ?? 'Manual report')

  // Save image if provided
  if (imageDataUrl) {
    try {
      const matches = imageDataUrl.match(/^data:image\/(\w+);base64,(.+)$/)
      if (matches) {
        const ext = matches[1]
        const base64 = matches[2]
        const imgDir = path.join(process.cwd(), 'public', 'snapshots')
        fs.mkdirSync(imgDir, { recursive: true })
        const filename = `snapshot-${snapshot.id}.${ext}`
        fs.writeFileSync(path.join(imgDir, filename), Buffer.from(base64, 'base64'))
        snapshot.imagePath = `/snapshots/${filename}`
        // Re-save snapshot JSON with imagePath
        const failuresDir = path.join(process.cwd(), 'src', 'data', 'failures')
        fs.writeFileSync(
          path.join(failuresDir, `failure-${snapshot.id}.json`),
          JSON.stringify(snapshot, null, 2)
        )
      }
    } catch (err) {
      console.error('[manual-snapshot] Failed to save image:', err)
    }
  }

  return Response.json({ snapshot, snapshotId: snapshot.id })
}
