// Quick smoke test: runs the mock serial pipeline and verifies a snapshot is written.
// Usage: node scripts/test-serial.mjs
import { EventEmitter } from 'events'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { v4 as uuidv4 } from 'uuid'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const FAILURES_DIR = path.join(ROOT, 'src', 'data', 'failures')
const WINDOW_MS = 2 * 60 * 1000

// ── inline versions of parser + mock (avoids TS/path-alias issues in plain mjs) ──

const TEMP_RE = /T:(\d+\.?\d*)\s*\/(\d+\.?\d*)\s+B:(\d+\.?\d*)\s*\/(\d+\.?\d*)/
const PROGRESS_RE = /Percent done:\s*(\d+);\s*print time remaining in mins:\s*(\d+)/

function parseSerialLine(line, state) {
  const next = { ...state, rawLine: line, timestamp: Date.now() }
  const tm = TEMP_RE.exec(line)
  if (tm) {
    next.hotendTemp = parseFloat(tm[1]); next.hotendTarget = parseFloat(tm[2])
    next.bedTemp = parseFloat(tm[3]); next.bedTarget = parseFloat(tm[4])
  }
  const pm = PROGRESS_RE.exec(line)
  if (pm) { next.percentDone = parseInt(pm[1], 10); next.timeRemainingMins = parseInt(pm[2], 10) }
  return next
}

function buildFrame(partial, line) {
  return {
    timestamp: partial.timestamp ?? Date.now(),
    hotendTemp: partial.hotendTemp ?? 0, hotendTarget: partial.hotendTarget ?? 0,
    bedTemp: partial.bedTemp ?? 0, bedTarget: partial.bedTarget ?? 0,
    percentDone: partial.percentDone ?? 0, timeRemainingMins: partial.timeRemainingMins ?? 0,
    rawLine: line,
  }
}

// ── fast mock: 100ms ticks, fails after 5 ticks ──

class FastMock extends EventEmitter {
  constructor() { super(); this.ticks = 0; this.hotend = 215.0 }
  open() {
    this.timer = setInterval(() => {
      this.ticks++
      if (this.ticks >= 5) { this.hotend -= 40 }
      const pct = this.ticks * 2
      const line1 = `NORMAL MODE: Percent done: ${pct}; print time remaining in mins: 28; Change in mins: -1`
      const line2 = `T:${this.hotend.toFixed(1)} /215.0 B:60.1 /60.0`
      this.emit('data', line1)
      this.emit('data', line2)
      if (this.hotend < 160) {
        this.emit('data', 'Error: Heating failed')
        clearInterval(this.timer)
      }
    }, 100)
  }
  close() { clearInterval(this.timer) }
}

// ── sliding window + snapshot ──

let buffer = []
let partialState = {}

function handleLine(line) {
  const now = Date.now()
  buffer = buffer.filter(f => now - f.timestamp < WINDOW_MS)

  if (line.startsWith('Error:')) {
    const snapshot = {
      id: uuidv4(),
      triggeredAt: Date.now(),
      errorMessage: line,
      buffer: [...buffer],
      printerModel: 'MK3S+',
    }
    fs.mkdirSync(FAILURES_DIR, { recursive: true })
    const filepath = path.join(FAILURES_DIR, `failure-${snapshot.id}.json`)
    fs.writeFileSync(filepath, JSON.stringify(snapshot, null, 2))
    console.log(`\n✓ Snapshot written: ${filepath}`)
    console.log(`  Frames captured: ${snapshot.buffer.length}`)
    console.log(`  Error: ${snapshot.errorMessage}`)
    console.log(`  Last hotend: ${snapshot.buffer.at(-1)?.hotendTemp ?? 'n/a'}°C`)
    return
  }

  partialState = parseSerialLine(line, partialState)
  if (line.startsWith('T:')) {
    buffer.push(buildFrame(partialState, line))
    process.stdout.write('.')
  }
}

const mock = new FastMock()
mock.on('data', handleLine)
mock.open()
