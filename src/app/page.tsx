'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Activity, History, AlertTriangle, X, ChevronLeft, Camera } from 'lucide-react'
import { SerialMonitor } from '@/components/SerialMonitor'
import { PrinterStatus } from '@/components/PrinterStatus'
import { FailureCard } from '@/components/FailureCard'
import { GeneralChat } from '@/components/GeneralChat'
import type { SerialFrame, FailureSnapshot, DiagnosisResult } from '@/types'

interface FailureEntry {
  snapshot: FailureSnapshot
  diagnosis: DiagnosisResult | null
  diagnosing: boolean
  statusText?: string
}

const MAX_LINES = 200

const ISSUE_OPTIONS = [
  { id: 'warping',       label: 'Warping',            desc: 'Print lifting off bed at corners or edges' },
  { id: 'stringing',     label: 'Stringing',           desc: 'Thin strings of plastic between parts' },
  { id: 'layer_shift',   label: 'Layer Shift',       desc: 'Layers suddenly shifted horizontally' },
  { id: 'under_extrude', label: 'Under-extrusion',   desc: 'Gaps or weak layers in the print' },
  { id: 'clog',          label: 'Clog / Jam',          desc: 'Extruder clicking, no filament coming out' },
  { id: 'adhesion',      label: 'Bed adhesion',      desc: 'Print not sticking to the bed surface' },
  { id: 'other',         label: 'Other',               desc: 'Something else is wrong' },
]

const MATERIAL_OPTIONS = ['PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'Other']

interface IssueContext {
  material: string
  layer: string
  roomTemp: string
  notes: string
}

export default function Dashboard() {
  const router = useRouter()
  const [lines, setLines] = useState<string[]>([])
  const [latestFrame, setLatestFrame] = useState<SerialFrame | null>(null)
  const [status, setStatus] = useState<'idle' | 'printing' | 'error'>('idle')
  const [failures, setFailures] = useState<FailureEntry[]>([])
  const [modalStep, setModalStep] = useState<'closed' | 'pick' | 'detail'>('closed')
  const [selectedIssue, setSelectedIssue] = useState<string | null>(null)
  const [issueCtx, setIssueCtx] = useState<IssueContext>({ material: '', layer: '', roomTemp: '', notes: '' })
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null)
  const [reporting, setReporting] = useState(false)
  const esRef = useRef<EventSource | null>(null)

  const triggerDiagnosis = useCallback(async (snapshot: FailureSnapshot) => {
    try {
      const res = await fetch('/api/diagnose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshotId: snapshot.id }),
      })
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const parts = buf.split('\n\n'); buf = parts.pop() ?? ''
        for (const part of parts) {
          const eventLine = part.split('\n').find(l => l.startsWith('event:'))
          const dataLine = part.split('\n').find(l => l.startsWith('data:'))
          if (!eventLine || !dataLine) continue
          const eventType = eventLine.slice(6).trim()
          const data = JSON.parse(dataLine.slice(5).trim()) as Record<string, unknown>
          if (eventType === 'status') {
            setFailures(prev => prev.map(e => e.snapshot.id === snapshot.id ? { ...e, statusText: data.text as string } : e))
          } else if (eventType === 'result') {
            setFailures(prev => prev.map(e => e.snapshot.id === snapshot.id ? { ...e, diagnosis: data as unknown as DiagnosisResult, diagnosing: false, statusText: undefined } : e))
          } else if (eventType === 'error') {
            setFailures(prev => prev.map(e => e.snapshot.id === snapshot.id ? { ...e, diagnosing: false, statusText: undefined } : e))
          }
        }
      }
    } catch {
      setFailures(prev => prev.map(e => e.snapshot.id === snapshot.id ? { ...e, diagnosing: false, statusText: undefined } : e))
    }
  }, [])

  useEffect(() => {
    const es = new EventSource('/api/serial')
    esRef.current = es
    es.addEventListener('line', (e) => {
      const { line } = JSON.parse(e.data) as { line: string }
      setLines(prev => [...prev.slice(-MAX_LINES + 1), line])
      if (line.startsWith('Error:')) setStatus('error')
      else setStatus('printing')
    })
    es.addEventListener('frame', (e) => {
      setLatestFrame(JSON.parse(e.data) as SerialFrame)
    })
    es.addEventListener('failure', (e) => {
      const snapshot = JSON.parse(e.data) as FailureSnapshot
      const entry: FailureEntry = { snapshot, diagnosis: null, diagnosing: true }
      setFailures(prev => [entry, ...prev])
      triggerDiagnosis(snapshot)
    })
    return () => es.close()
  }, [triggerDiagnosis])

  const openModal = () => {
    setSelectedIssue(null)
    setIssueCtx({ material: '', layer: '', roomTemp: '', notes: '' })
    setImageDataUrl(null)
    setModalStep('pick')
  }

  const closeModal = () => setModalStep('closed')

  const selectIssue = (id: string) => {
    setSelectedIssue(id)
    setModalStep('detail')
  }

  const submitIssue = useCallback(async () => {
    if (!selectedIssue) return
    closeModal()
    setReporting(true)
    const option = ISSUE_OPTIONS.find(o => o.id === selectedIssue)
    const parts = [
      `[Manual] ${option?.label ?? selectedIssue} — ${option?.desc ?? ''}`,
      issueCtx.material  ? `Material: ${issueCtx.material}` : '',
      issueCtx.layer     ? `Layer when noticed: ${issueCtx.layer}` : '',
      issueCtx.roomTemp  ? `Room temperature: ${issueCtx.roomTemp}°C` : '',
      issueCtx.notes     ? `Notes: ${issueCtx.notes}` : '',
    ].filter(Boolean)
    const reason = parts.join(' | ')
    try {
      const res = await fetch('/api/manual-snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, imageDataUrl: imageDataUrl ?? undefined }),
      })
      const { snapshot } = await res.json() as { snapshot: FailureSnapshot }
      const entry: FailureEntry = { snapshot, diagnosis: null, diagnosing: true }
      setFailures(prev => [entry, ...prev])
      triggerDiagnosis(snapshot)
    } catch (err) {
      console.error('[manual] Failed to create snapshot:', err)
    } finally {
      setReporting(false)
    }
  }, [selectedIssue, issueCtx, triggerDiagnosis])

  const statusBadgeTone = status === 'error' ? 'fault' : status === 'printing' ? 'live' : 'neutral'
  const statusLabel = status === 'error' ? 'FAULT' : status === 'printing' ? 'LIVE' : 'IDLE'

  return (
    <div className="wd-app">
      {/* Modal */}
      {modalStep !== 'closed' && (
        <div className="wd-modal-backdrop" onClick={closeModal}>
          <div className="wd-modal" onClick={e => e.stopPropagation()}>
            <div className="wd-modal__head">
              <span className="wd-modal__title">
                {modalStep === 'detail' && (
                  <button className="wd-modal__back" onClick={() => setModalStep('pick')}>
                    <ChevronLeft size={14} />
                  </button>
                )}
                <AlertTriangle size={15} />
                {modalStep === 'pick' ? "What's wrong?" : ISSUE_OPTIONS.find(o => o.id === selectedIssue)?.label}
              </span>
              <button className="wd-modal__close" onClick={closeModal}><X size={15} /></button>
            </div>

            {/* Step 1: pick issue */}
            {modalStep === 'pick' && (
              <div className="wd-modal__body">
                {ISSUE_OPTIONS.map(opt => (
                  <button key={opt.id} className="wd-issue-opt" onClick={() => selectIssue(opt.id)}>
                    <span className="wd-issue-opt__label">{opt.label}</span>
                    <span className="wd-issue-opt__desc">{opt.desc}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Step 2: detail */}
            {modalStep === 'detail' && (
              <div className="wd-modal__body">
                {/* Material */}
                <div className="wd-field">
                  <label className="wd-field__label">Material</label>
                  <div className="wd-field__chips">
                    {MATERIAL_OPTIONS.map(m => (
                      <button
                        key={m}
                        className={`wd-chip${issueCtx.material === m ? ' is-active' : ''}`}
                        onClick={() => setIssueCtx(c => ({ ...c, material: c.material === m ? '' : m }))}
                      >{m}</button>
                    ))}
                  </div>
                </div>

                {/* Layer */}
                <div className="wd-field">
                  <label className="wd-field__label">Layer when noticed <span className="wd-field__opt">(optional)</span></label>
                  <input
                    className="wd-input"
                    type="number"
                    placeholder="e.g. 12"
                    value={issueCtx.layer}
                    onChange={e => setIssueCtx(c => ({ ...c, layer: e.target.value }))}
                  />
                </div>

                {/* Room temp */}
                <div className="wd-field">
                  <label className="wd-field__label">Room temperature °C <span className="wd-field__opt">(optional)</span></label>
                  <input
                    className="wd-input"
                    type="number"
                    placeholder="e.g. 22"
                    value={issueCtx.roomTemp}
                    onChange={e => setIssueCtx(c => ({ ...c, roomTemp: e.target.value }))}
                  />
                </div>

                {/* Notes */}
                <div className="wd-field">
                  <label className="wd-field__label">Additional notes <span className="wd-field__opt">(optional)</span></label>
                  <textarea
                    className="wd-input wd-input--textarea"
                    placeholder="e.g. only back-left corner, using smooth PEI sheet…"
                    rows={2}
                    value={issueCtx.notes}
                    onChange={e => setIssueCtx(c => ({ ...c, notes: e.target.value }))}
                  />
                </div>

                {/* Photo upload */}
                <div className="wd-field">
                  <label className="wd-field__label">
                    <Camera size={12} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
                    Photo <span className="wd-field__opt">(optional — AI will analyze visually)</span>
                  </label>
                  {imageDataUrl ? (
                    <div className="wd-img-preview">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={imageDataUrl} alt="Print issue" />
                      <button className="wd-img-preview__remove" onClick={() => setImageDataUrl(null)}>
                        <X size={13} /> Remove
                      </button>
                    </div>
                  ) : (
                    <label className="wd-upload">
                      <Camera size={16} />
                      <span>Tap to add photo</span>
                      <input
                        type="file"
                        accept="image/*"
                        style={{ display: 'none' }}
                        onChange={e => {
                          const file = e.target.files?.[0]
                          if (!file) return
                          const reader = new FileReader()
                          reader.onload = ev => setImageDataUrl(ev.target?.result as string)
                          reader.readAsDataURL(file)
                        }}
                      />
                    </label>
                  )}
                </div>

                <button className="wd-btn wd-btn--primary" style={{ width: '100%', marginTop: 4 }} onClick={submitIssue}>
                  Run Diagnosis
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Top bar */}
      <header className="wd-topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span className="wd-brand-title">WhyDidItFail</span>
          <nav className="wd-tabs">
            <button className="wd-tab is-active">
              <Activity size={14} /> Live Monitor
            </button>
            <button className="wd-tab" onClick={() => router.push('/history')}>
              <History size={14} /> History
            </button>
          </nav>
        </div>
        <div className="wd-topbar__right">
          <span className="wd-port">/dev/tty.usbmodem101 · 115200</span>
          <button
            className="wd-btn wd-btn--warn"
            onClick={openModal}
            disabled={reporting}
          >
            <AlertTriangle size={13} />
            {reporting ? 'Capturing…' : 'Report Issue'}
          </button>
          <span className={`wd-badge wd-badge--${statusBadgeTone}`}>
            <span className={`wd-dot${status === 'printing' ? ' wd-dot--pulse' : ''}`} />
            {statusLabel}
          </span>
        </div>
      </header>

      {/* Main grid */}
      <div className="wd-grid">
        <div className="wd-col">
          <div>
            <div className="wd-seclabel">
              <span className="wd-seclabel__l">Serial Monitor</span>
            </div>
            <SerialMonitor lines={lines} />
          </div>
          {failures.length > 0 && (
            <div className="wd-failures">
              <div className="wd-seclabel">
                <span className="wd-seclabel__l">Detected Failures ({failures.length})</span>
              </div>
              <div className="wd-failures__list">
                {failures.map((entry) => (
                  <FailureCard
                    key={entry.snapshot.id}
                    snapshot={entry.snapshot}
                    diagnosis={entry.diagnosis}
                    diagnosing={entry.diagnosing}
                    statusText={entry.statusText}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="wd-col">
          <div>
            <div className="wd-seclabel">
              <span className="wd-seclabel__l">Printer Status</span>
            </div>
            <PrinterStatus frame={latestFrame} status={status} />
          </div>
          <div>
            <div className="wd-seclabel">
              <span className="wd-seclabel__l">Assistant</span>
            </div>
            <GeneralChat printerFrame={latestFrame} />
          </div>
        </div>
      </div>
    </div>
  )
}
