'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Activity, History, Sparkles } from 'lucide-react'
import { FailureCard } from '@/components/FailureCard'
import type { FailureSnapshot, DiagnosisResult } from '@/types'

interface HistoryEntry {
  snapshot: FailureSnapshot
  diagnosis: DiagnosisResult | null
  diagnosing: boolean
  statusText?: string
}

export default function HistoryPage() {
  const router = useRouter()
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/failures')
      .then(r => r.json())
      .then((snapshots: FailureSnapshot[]) => {
        setEntries(snapshots.map(snapshot => ({ snapshot, diagnosis: null, diagnosing: false })))
        setLoading(false)
      })
      .catch(err => { setError(String(err)); setLoading(false) })
  }, [])

  const diagnose = useCallback(async (snapshotId: string) => {
    setEntries(prev => prev.map(e => e.snapshot.id === snapshotId ? { ...e, diagnosing: true } : e))
    try {
      const res = await fetch('/api/diagnose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshotId }),
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
            setEntries(prev => prev.map(e => e.snapshot.id === snapshotId ? { ...e, statusText: data.text as string } : e))
          } else if (eventType === 'result') {
            setEntries(prev => prev.map(e => e.snapshot.id === snapshotId ? { ...e, diagnosis: data as unknown as DiagnosisResult, diagnosing: false, statusText: undefined } : e))
          } else if (eventType === 'error') {
            setEntries(prev => prev.map(e => e.snapshot.id === snapshotId ? { ...e, diagnosing: false, statusText: undefined } : e))
          }
        }
      }
    } catch {
      setEntries(prev => prev.map(e => e.snapshot.id === snapshotId ? { ...e, diagnosing: false, statusText: undefined } : e))
    }
  }, [])

  return (
    <div className="wd-app">
      {/* Top bar */}
      <header className="wd-topbar">
        <span className="wd-brand-title">WhyDidItFail</span>
        <nav className="wd-tabs">
          <button className="wd-tab" onClick={() => router.push('/')}>
            <Activity size={14} /> Live Monitor
          </button>
          <button className="wd-tab is-active">
            <History size={14} /> History
          </button>
        </nav>
        <div className="wd-topbar__right">
          <span className="wd-port">/dev/tty.usbmodem101 · 115200</span>
        </div>
      </header>

      {/* Content */}
      <div className="wd-history">
        <div className="wd-seclabel" style={{ marginBottom: 16 }}>
          <span className="wd-seclabel__l">
            Failure Snapshots{entries.length > 0 ? ` (${entries.length})` : ''}
          </span>
        </div>

        {loading && (
          <div style={{ color: 'var(--fg-faint)', fontSize: 13, padding: '24px 0' }}>
            Loading snapshots…
          </div>
        )}
        {error && (
          <div style={{ color: 'var(--fault-400)', fontSize: 13, padding: '12px 0' }}>
            Error: {error}
          </div>
        )}
        {!loading && !error && entries.length === 0 && (
          <div className="wd-empty">
            <div className="wd-empty__big">NO SNAPSHOTS YET</div>
            <div className="wd-empty__sub">They appear here automatically when an error is detected.</div>
          </div>
        )}

        <div className="wd-failures__list">
          {entries.map(entry => (
            <div key={entry.snapshot.id}>
              <FailureCard
                snapshot={entry.snapshot}
                diagnosis={entry.diagnosis}
                diagnosing={entry.diagnosing}
                statusText={entry.statusText}
              />
              {!entry.diagnosis && !entry.diagnosing && (
                <button className="wd-history__diag" onClick={() => diagnose(entry.snapshot.id)}>
                  <Sparkles size={13} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />
                  Run Diagnosis
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
