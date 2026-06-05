import fs from 'fs'
import path from 'path'
import { EventEmitter } from 'events'
import { v4 as uuidv4 } from 'uuid'
// Switch sources by setting SERIAL_PORT in .env.local.
// If SERIAL_PORT is set → real hardware; otherwise → mock emulator.
import { createSerialSource as createMock, type SerialSource } from './mock-serial'
import { createSerialSource as createReal } from './real-serial'

function createSerialSource(): SerialSource {
  return process.env.SERIAL_PORT ? createReal() : createMock()
}
import { parseSerialLine, isErrorLine, isNoiseLine, buildFrame } from './parser'
import type { SerialFrame, FailureSnapshot } from '@/types'

const WINDOW_MS = 2 * 60 * 1000 // 2 minutes
const FAILURES_DIR = path.join(process.cwd(), 'src', 'data', 'failures')

export interface SerialManagerEvents {
  line: (line: string) => void
  frame: (frame: SerialFrame) => void
  failure: (snapshot: FailureSnapshot) => void
}

class SerialManager extends EventEmitter {
  private source: SerialSource | null = null
  private buffer: SerialFrame[] = []
  private partialState: Partial<SerialFrame> = {}

  private retryTimer: ReturnType<typeof setTimeout> | null = null

  start(): void {
    if (this.source) return         // already running
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null }
    this.buffer = []
    this.partialState = {}
    this.source = createSerialSource()
    this.source.on('data', (line: string) => this.handleLine(line))
    this.source.on('error', () => {
      // Port error — schedule a retry in 5 s (port may still be busy)
      this.source = null
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null
        console.log('[serial] Retrying connection…')
        this.start()
      }, 5000)
    })
    this.source.on('close', () => { this.source = null })
    this.source.open()
  }

  stop(): void {
    this.source?.close()
    this.source = null
  }

  getBuffer(): SerialFrame[] {
    return [...this.buffer]
  }

  private handleLine(line: string): void {
    const now = Date.now()
    // Evict frames older than the window
    this.buffer = this.buffer.filter(f => now - f.timestamp < WINDOW_MS)

    // Always check for errors first — even noisy lines can carry error prefixes
    if (isErrorLine(line)) {
      this.emit('line', line)          // always show error lines in the monitor
      const snapshot = this.flushSnapshot(line)
      this.writeSnapshotToDisk(snapshot)
      this.emit('failure', snapshot)
      return
    }

    // Parse every line (updates partialState) but only forward meaningful
    // lines to the Serial Monitor UI — suppress high-frequency noise
    this.partialState = parseSerialLine(line, this.partialState)

    if (!isNoiseLine(line)) {
      this.emit('line', line)
    }

    // Push a frame whenever we get a temperature reading (most info-dense)
    // Handles both bare "T:…" and "ok T:…" lines
    if (/T:\d/.test(line)) {
      const frame = buildFrame(this.partialState, line)
      this.buffer.push(frame)
      this.emit('frame', frame)
    }
  }

  manualSnapshot(reason: string): FailureSnapshot {
    const snapshot = this.flushSnapshot(`[Manual] ${reason}`)
    this.writeSnapshotToDisk(snapshot)
    this.emit('failure', snapshot)
    return snapshot
  }

  private flushSnapshot(errorLine: string): FailureSnapshot {
    return {
      id: uuidv4(),
      triggeredAt: Date.now(),
      errorMessage: errorLine,
      buffer: [...this.buffer],
      printerModel: 'MK3S+',
    }
  }

  private writeSnapshotToDisk(snapshot: FailureSnapshot): void {
    fs.mkdirSync(FAILURES_DIR, { recursive: true })
    const filename = `failure-${snapshot.id}.json`
    const filepath = path.join(FAILURES_DIR, filename)
    fs.writeFileSync(filepath, JSON.stringify(snapshot, null, 2))
    console.log(`[serial] Snapshot written: ${filepath}`)
  }
}

// Singleton — one connection per process.
// In dev, stored on globalThis so hot reloads share the same instance.
// On each module load we flush all 'line'/'frame'/'failure' listeners from
// the previous module version — their controllers are already closed, and
// keeping them causes the uncaughtException spam.
const g = globalThis as typeof globalThis & { __serialManager?: SerialManager }

export function getSerialManager(): SerialManager {
  if (!g.__serialManager) {
    g.__serialManager = new SerialManager()
  } else {
    // Hot-reload: remove every SSE listener the previous module registered.
    // The new module's route handler will re-register its own listeners.
    g.__serialManager.removeAllListeners('line')
    g.__serialManager.removeAllListeners('frame')
    g.__serialManager.removeAllListeners('failure')
  }
  return g.__serialManager
}
