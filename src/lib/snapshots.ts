import fs from 'fs'
import path from 'path'
import type { FailureSnapshot } from '@/types'

const FAILURES_DIR = path.join(process.cwd(), 'src', 'data', 'failures')

export function listSnapshots(): FailureSnapshot[] {
  if (!fs.existsSync(FAILURES_DIR)) return []

  return fs
    .readdirSync(FAILURES_DIR)
    .filter(f => f.startsWith('failure-') && f.endsWith('.json'))
    .map(filename => {
      const raw = fs.readFileSync(path.join(FAILURES_DIR, filename), 'utf-8')
      return JSON.parse(raw) as FailureSnapshot
    })
    .sort((a, b) => b.triggeredAt - a.triggeredAt) // newest first
}

export function getSnapshot(id: string): FailureSnapshot | null {
  const filepath = path.join(FAILURES_DIR, `failure-${id}.json`)
  if (!fs.existsSync(filepath)) return null
  return JSON.parse(fs.readFileSync(filepath, 'utf-8')) as FailureSnapshot
}
