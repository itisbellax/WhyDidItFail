'use client'

import type { SerialFrame } from '@/types'

interface PrinterStatusProps {
  frame: SerialFrame | null
  status: 'idle' | 'printing' | 'error'
}

function Gauge({ label, actual, target, unit = '°C' }: {
  label: string; actual: number; target: number; unit?: string
}) {
  const pct = target > 0 ? Math.min((actual / target) * 100, 100) : 0
  const ok = target === 0 || Math.abs(actual - target) < 5
  const tone = ok ? 'nominal' : 'caution'
  return (
    <div className="wd-gauge">
      <div className="wd-gauge__row">
        <span className="wd-gauge__label">{label}</span>
        <span className={`wd-gauge__val wd-${tone}`}>
          {actual.toFixed(1)}
          {target > 0 && <span className="wd-gauge__t"> / {target.toFixed(1)} {unit}</span>}
          {target === 0 && <span className="wd-gauge__t"> {unit}</span>}
        </span>
      </div>
      <div className="wd-track">
        <div className={`wd-fill wd-fill--${tone}`} style={{ width: target > 0 ? `${pct}%` : '0%' }} />
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: 'idle' | 'printing' | 'error' }) {
  if (status === 'error') return <span className="wd-badge wd-badge--fault"><span className="wd-dot" />FAULT</span>
  if (status === 'printing') return <span className="wd-badge wd-badge--nominal"><span className="wd-dot wd-dot--pulse" />PRINTING</span>
  return <span className="wd-badge wd-badge--neutral"><span className="wd-dot" />IDLE</span>
}

function formatTime(mins: number): string {
  if (mins <= 0) return '—'
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h > 0) return `${h}h ${m}m`
  return `${m} min`
}

export function PrinterStatus({ frame, status }: PrinterStatusProps) {
  const isPrinting = frame && frame.hotendTarget > 0

  return (
    <div className="wd-panel">
      <div className="wd-status__head">
        <span className="wd-status__name">MK3S+</span>
        <StatusBadge status={status} />
      </div>

      {frame ? (
        <>
          {/* Always show temps when we have data */}
          <Gauge label="Nozzle" actual={frame.hotendTemp} target={frame.hotendTarget} />
          <Gauge label="Bed" actual={frame.bedTemp} target={frame.bedTarget} />

          {/* Progress + time only when printing */}
          {isPrinting && (
            <>
              {/* Time remaining — prominent */}
              <div className="wd-gauge" style={{ marginTop: 4 }}>
                <div className="wd-gauge__row">
                  <span className="wd-gauge__label">Time remaining</span>
                  <span className="wd-gauge__val" style={{ color: 'var(--fg-strong)', fontSize: 15, fontWeight: 600 }}>
                    {formatTime(frame.timeRemainingMins)}
                  </span>
                </div>
              </div>

              {/* Progress bar */}
              {frame.percentDone > 0 && (
                <div className="wd-gauge">
                  <div className="wd-gauge__row">
                    <span className="wd-gauge__label">Progress</span>
                    <span className="wd-gauge__val" style={{ color: 'var(--fg-strong)' }}>
                      {frame.percentDone}<span className="wd-gauge__t">%</span>
                    </span>
                  </div>
                  <div className="wd-track">
                    <div className="wd-fill wd-fill--signal" style={{ width: `${frame.percentDone}%` }} />
                  </div>
                </div>
              )}

              {(frame.zPos !== undefined || frame.fanSpeed !== undefined) && (
                <div className="wd-stats">
                  {frame.zPos !== undefined && (
                    <div className="wd-stat">
                      <span className="wd-stat__k">Z height</span>
                      <span className="wd-stat__v">{frame.zPos.toFixed(2)} mm</span>
                    </div>
                  )}
                  {frame.fanSpeed !== undefined && (
                    <div className="wd-stat">
                      <span className="wd-stat__k">Fan</span>
                      <span className="wd-stat__v">{Math.round((frame.fanSpeed / 255) * 100)}%</span>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </>
      ) : (
        <div className="wd-status__idle">No data yet</div>
      )}
    </div>
  )
}
