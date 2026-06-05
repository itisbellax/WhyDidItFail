import { listSnapshots } from '@/lib/snapshots'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  const snapshots = listSnapshots()
  return Response.json(snapshots)
}
