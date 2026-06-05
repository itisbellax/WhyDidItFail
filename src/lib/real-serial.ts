import { EventEmitter } from 'events'
import { SerialPort, ReadlineParser } from 'serialport'
import type { SerialSource } from './mock-serial'

const PORT_PATH = process.env.SERIAL_PORT  ?? '/dev/tty.usbmodem101'
const BAUD_RATE = parseInt(process.env.SERIAL_BAUD ?? '115200', 10)

class RealSerialEmitter extends EventEmitter implements SerialSource {
  private port: SerialPort | null = null

  open(): void {
    if (this.port?.isOpen) return

    this.port = new SerialPort({
      path: PORT_PATH,
      baudRate: BAUD_RATE,
      autoOpen: false,
    })

    // Parse incoming bytes into newline-delimited strings
    const parser = this.port.pipe(new ReadlineParser({ delimiter: '\n' }))

    this.port.on('open', () => {
      console.log(`[serial] Connected to ${PORT_PATH} @ ${BAUD_RATE} baud`)
      this.emit('open')
    })

    this.port.on('error', (err: Error) => {
      console.error('[serial] Port error:', err.message)
      this.emit('error', err)
      this.close()
    })

    this.port.on('close', () => {
      console.log('[serial] Port closed')
      this.port = null
      this.emit('close')
    })

    parser.on('data', (line: string) => {
      this.emit('data', line.trim())
    })

    this.port.open()
  }

  close(): void {
    if (this.port?.isOpen) {
      this.port.close()
    } else {
      this.port = null
      this.emit('close')
    }
  }
}

export function createSerialSource(): SerialSource {
  return new RealSerialEmitter()
}
