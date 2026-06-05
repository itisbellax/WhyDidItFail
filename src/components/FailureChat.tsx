'use client'

import { useState, useRef, useEffect } from 'react'
import type { DiagnosisResult, FailureSnapshot } from '@/types'

interface Message { role: 'user' | 'assistant'; content: string }

interface FailureChatProps {
  snapshot: FailureSnapshot
  diagnosis: DiagnosisResult
}

const SUGGESTIONS = [
  'How long will this repair take?',
  'Could this damage the printer?',
  'How do I prevent this in future?',
]

export function FailureChat({ snapshot, diagnosis }: FailureChatProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    bottomRef.current?.parentElement?.scrollTo({ top: 1e7, behavior: 'smooth' })
  }, [messages])

  async function send(text?: string) {
    const content = (text ?? input).trim()
    if (!content || streaming) return
    const userMsg: Message = { role: 'user', content }
    const nextMessages = [...messages, userMsg]
    setMessages([...nextMessages, { role: 'assistant', content: '' }])
    setInput('')
    setStreaming(true)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshotId: snapshot.id, messages: nextMessages, diagnosis }),
      })
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n'); buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const payload = line.slice(6).trim()
          if (payload === '[DONE]') continue
          try {
            const parsed = JSON.parse(payload) as { text?: string }
            if (parsed.text) setMessages(prev => { const u = [...prev]; u[u.length - 1] = { role: 'assistant', content: u[u.length - 1].content + parsed.text }; return u })
          } catch { /* ignore */ }
        }
      }
    } catch (err) {
      setMessages(prev => { const u = [...prev]; u[u.length - 1] = { role: 'assistant', content: `Error: ${err instanceof Error ? err.message : String(err)}` }; return u })
    } finally {
      setStreaming(false)
      inputRef.current?.focus()
    }
  }

  return (
    <div className="wd-chat wd-chat--compact">
      <div className="wd-chat__body">
        {messages.length === 0 ? (
          <div>
            <div className="wd-chat__sugg">
              {SUGGESTIONS.map(s => (
                <button key={s} className="wd-chip" onClick={() => send(s)}>{s}</button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((m, i) => (
              <div key={i} className={`wd-msg wd-msg--${m.role}`}>
                <div className="wd-bubble">
                  {m.content || <span className="wd-typing"><i /><i /><i /></span>}
                </div>
              </div>
            ))}
          </>
        )}
        <div ref={bottomRef} />
      </div>
      <div className="wd-chat__input">
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          placeholder="Ask about this failure…"
          disabled={streaming}
        />
        <button className="wd-btn wd-btn--primary" onClick={() => send()} disabled={!input.trim() || streaming}>
          Send
        </button>
      </div>
    </div>
  )
}
