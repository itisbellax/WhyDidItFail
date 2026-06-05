import { EventEmitter } from 'events'

export interface SerialSource extends EventEmitter {
  open(): void
  close(): void
}

const NORMAL_LINES = [
  'echo:; V:3.13.3',                  // firmware echo — should be filtered
  'ok N42 P15 B3',                    // flow-control ack — should be filtered
  'Percent done: {PCT}; print time remaining in mins: {REM}; Change in mins: -1',
  'T:{HOTEND} /{TARGET} B:{BED} /60.0',
  'X:125.00 Y:105.00 Z:{Z} E:0.00 Count X:10000 Y:8400 Z:4000',
  'Fan speed: {FAN}',
]

class MockSerialEmitter extends EventEmitter implements SerialSource {
  private timer: ReturnType<typeof setInterval> | null = null
  private elapsed = 0
  private hotend = 215.0
  private failing = false

  private zPos = 0.2
  private fan = 127

  open(): void {
    this.elapsed = 0
    this.failing = false
    this.hotend = 215.0
    this.zPos = 0.2
    this.fan = 127
    this.timer = setInterval(() => this.tick(), 1000)
    this.emit('open')
  }

  close(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.emit('close')
  }

  private tick(): void {
    this.elapsed++

    // After 30s simulate heater failure: hotend starts dropping
    if (this.elapsed >= 30) {
      this.failing = true
      this.hotend = Math.max(this.hotend - 8, 25)
    } else {
      // Small natural fluctuation
      this.hotend = 215.0 + (Math.random() * 0.6 - 0.3)
    }

    const pct = Math.min(Math.floor(this.elapsed / 2), 99)
    const rem = Math.max(31 - Math.floor(this.elapsed / 60), 0)
    // Simulate Z advancing every ~5 seconds (layer height 0.2mm)
    if (this.elapsed % 5 === 0) this.zPos = parseFloat((this.zPos + 0.2).toFixed(2))
    // Fan ramps up as print progresses
    this.fan = Math.min(255, 100 + pct)

    for (const tpl of NORMAL_LINES) {
      const line = tpl
        .replace('{PCT}', String(pct))
        .replace('{REM}', String(rem))
        .replace('{HOTEND}', this.hotend.toFixed(1))
        .replace('{TARGET}', '215.0')
        .replace('{BED}', (60.0 + (Math.random() * 0.4 - 0.2)).toFixed(1))
        .replace('{Z}', this.zPos.toFixed(2))
        .replace('{FAN}', String(this.fan))
      this.emit('data', line)
    }

    // Emit error once the hotend drops far enough
    if (this.failing && this.hotend < 180) {
      this.emit('data', 'Error: Heating failed')
      this.close()
    }
  }
}

export function createSerialSource(): SerialSource {
  return new MockSerialEmitter()
}
