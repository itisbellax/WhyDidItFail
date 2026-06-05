import type { SerialFrame } from '@/types'

// ── Temperature ──────────────────────────────────────────────────────────────
// Matches both bare and "ok"-prefixed lines:
//   T:215.2 /215.0 B:60.1 /60.0 ...
//   ok T:215.2 /215.0 B:60.1 /60.0 ...
const TEMP_RE = /T:(\d+\.?\d*)\s*\/(\d+\.?\d*)\s+B:(\d+\.?\d*)\s*\/(\d+\.?\d*)/

// ── Progress ──────────────────────────────────────────────────────────────────
const PROGRESS_RE = /Percent done:\s*(\d+);\s*print time remaining in mins:\s*(\d+)/

// ── Fan speed ─────────────────────────────────────────────────────────────────
// "Fan speed:127" or "Fan speed: 127"
const FAN_RE = /Fan speed:\s*(\d+)/i

// ── Z position ────────────────────────────────────────────────────────────────
// Position report lines look like: "X:125.00 Y:105.00 Z:10.25 E:0.00 ..."
const ZPOS_RE = /\bZ:([-\d.]+)/

// ── Printer action events ─────────────────────────────────────────────────────
// "//action:pause", "//action:cancel", "//action:resume"
const ACTION_RE = /^\/\/action:(\w+)/

// ── Noise patterns ────────────────────────────────────────────────────────────
// Lines that carry no diagnostic value for the serial monitor display
const NOISE_PATTERNS: RegExp[] = [
  /^echo:/i,           // firmware echo of sent G-code commands
  /^ok$/,              // bare "ok" acknowledgement with no data
  /^ok\s+[NP]\d+/,    // "ok N42 P15 B3" flow-control acks
  /^NORMAL MODE:/i,    // Prusa startup banner
  /^SILENT MODE:/i,
  /^Filament sensor/i, // filament sensor state changes (very frequent)
  /^LA10C:/i,          // Linear Advance mode info
  /^K out of allowed range/i, // Linear Advance K value warning
  /^Linear Advance/i,  // Linear Advance related messages
]

/**
 * Returns true for lines that add no useful information to the serial monitor.
 * These are still processed internally (e.g. temps inside "ok T:…") but are
 * not forwarded to the UI line feed.
 */
export function isNoiseLine(line: string): boolean {
  return NOISE_PATTERNS.some(re => re.test(line))
}

/**
 * Returns true when the line represents a hard printer error that should
 * trigger a failure snapshot.
 */
export function isErrorLine(line: string): boolean {
  if (line.startsWith('Error:')) return true
  if (line.startsWith('PROBE_FAIL')) return true
  // Note: //action:cancel is a user action, NOT a hardware failure — don't snapshot it
  // Note: "K out of allowed range!" is a Linear Advance config warning, not a print failure
  return false
}

/**
 * Returns true for lines that look like errors in the UI (red highlight)
 * but should NOT trigger a failure snapshot.
 */
export function isWarnLine(line: string): boolean {
  if (line.includes('K out of allowed range')) return true
  if (line.includes('LA10C') || line.includes('Linear Advance')) return true
  return false
}

/**
 * Parse a single serial line and merge any extracted values into `state`.
 * Always returns a new object (immutable update pattern).
 */
export function parseSerialLine(line: string, state: Partial<SerialFrame>): Partial<SerialFrame> {
  const next: Partial<SerialFrame> = { ...state, rawLine: line, timestamp: Date.now() }

  // Temperature — most common line type, check first
  const tempMatch = TEMP_RE.exec(line)
  if (tempMatch) {
    next.hotendTemp = parseFloat(tempMatch[1])
    next.hotendTarget = parseFloat(tempMatch[2])
    next.bedTemp = parseFloat(tempMatch[3])
    next.bedTarget = parseFloat(tempMatch[4])
    return next
  }

  // Progress report
  const progressMatch = PROGRESS_RE.exec(line)
  if (progressMatch) {
    next.percentDone = parseInt(progressMatch[1], 10)
    next.timeRemainingMins = parseInt(progressMatch[2], 10)
    return next
  }

  // Fan speed
  const fanMatch = FAN_RE.exec(line)
  if (fanMatch) {
    next.fanSpeed = parseInt(fanMatch[1], 10)
    return next
  }

  // Position report — extract Z only (most useful for layer tracking)
  const zMatch = ZPOS_RE.exec(line)
  if (zMatch && /^X:/.test(line)) {          // guard: must be a real position line
    next.zPos = parseFloat(zMatch[1])
    return next
  }

  // Printer action event
  const actionMatch = ACTION_RE.exec(line)
  if (actionMatch) {
    next.action = actionMatch[1].toLowerCase()
    return next
  }

  return next
}

/**
 * Materialise a complete SerialFrame from the accumulated partial state.
 * Called whenever we want to push a frame into the sliding window buffer.
 */
export function buildFrame(partial: Partial<SerialFrame>, line: string): SerialFrame {
  return {
    timestamp: partial.timestamp ?? Date.now(),
    hotendTemp: partial.hotendTemp ?? 0,
    hotendTarget: partial.hotendTarget ?? 0,
    bedTemp: partial.bedTemp ?? 0,
    bedTarget: partial.bedTarget ?? 0,
    percentDone: partial.percentDone ?? 0,
    timeRemainingMins: partial.timeRemainingMins ?? 0,
    rawLine: line,
    // Optional extended fields — only included when present
    ...(partial.fanSpeed !== undefined && { fanSpeed: partial.fanSpeed }),
    ...(partial.zPos !== undefined && { zPos: partial.zPos }),
    ...(partial.action !== undefined && { action: partial.action }),
  }
}
