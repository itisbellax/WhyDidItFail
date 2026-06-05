'use client'

import { useEffect, useRef } from 'react'

interface SerialMonitorProps {
  lines: string[]
}

function lineKind(text: string): string {
  if (text.startsWith('Error:') || text.startsWith('PROBE_FAIL')) return 'err'
  if (/T:\d/.test(text)) return 'hot'
  if (/^(Warning|warn)/i.test(text)) return 'warn'
  return 'meta'
}

export function SerialMonitor({ lines }: SerialMonitorProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.parentElement?.scrollTo({ top: 1e7 })
  }, [lines])

  return (
    <div className="wd-term">
      <div className="wd-term__bar">
        <span className="wd-term__l">
          <span className="wd-dot wd-dot--pulse" style={{ color: 'var(--signal-300)' }} />
          SERIAL · /dev/tty.usbmodem101
        </span>
        <span className="wd-term__r">{lines.length} / 200 lines</span>
      </div>
      <div className="wd-term__body">
        {lines.length === 0 && (
          <div className="wd-term__wait">Waiting for serial data…</div>
        )}
        {lines.map((line, i) => (
          <div key={i} className={`wd-sl wd-sl--${lineKind(line)}`}>
            <span className="wd-sl__tx">{line}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
