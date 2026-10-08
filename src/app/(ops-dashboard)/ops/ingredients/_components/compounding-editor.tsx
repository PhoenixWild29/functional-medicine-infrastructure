'use client'

// ============================================================
// Ops: change one ingredient's compounding fields (Compliance C8)
// ============================================================
//
// Status, commercial equivalent, FDA shortage, and the source (required).
// Saves through PUT /api/ops/ingredients/[id]/compounding, which stamps the
// reviewer and time; the database records the change in the audit log.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { COMPOUNDING_STATUSES, COMPOUNDING_STATUS_LABEL } from '@/lib/compliance/compounding'

export function CompoundingEditor(props: {
  ingredientId:         string
  ingredientName:       string
  status:               string
  commercialEquivalent: boolean
  onFdaShortage:        boolean
}) {
  const router = useRouter()
  const [status, setStatus] = useState(props.status)
  const [commercialEquivalent, setCommercialEquivalent] = useState(props.commercialEquivalent)
  const [onFdaShortage, setOnFdaShortage] = useState(props.onFdaShortage)
  const [source, setSource] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/ops/ingredients/${props.ingredientId}/compounding`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, commercialEquivalent, onFdaShortage, source }),
      })
      const body = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) {
        setMessage({ tone: 'error', text: body.error ?? 'It could not be saved.' })
        return
      }
      setMessage({ tone: 'ok', text: 'Saved.' })
      setSource('')
      router.refresh()
    } catch {
      setMessage({ tone: 'error', text: 'It could not be saved. Check your connection and try again.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-1.5" aria-label={`Compounding status for ${props.ingredientName}`}>
      <select
        aria-label="Compounding status"
        value={status}
        onChange={e => setStatus(e.target.value)}
        className="rounded-md border border-input bg-background px-2 py-1 text-xs"
      >
        {COMPOUNDING_STATUSES.map(s => <option key={s} value={s}>{COMPOUNDING_STATUS_LABEL[s]}</option>)}
      </select>
      <label className="flex items-center gap-1 text-xs">
        <input type="checkbox" checked={commercialEquivalent} onChange={e => setCommercialEquivalent(e.target.checked)} />
        Commercial equivalent
      </label>
      <label className="flex items-center gap-1 text-xs">
        <input type="checkbox" checked={onFdaShortage} onChange={e => setOnFdaShortage(e.target.checked)} />
        On FDA shortage list
      </label>
      <label className="flex flex-col gap-0.5 text-xs text-muted-foreground">
        Source (required)
        <input
          required
          minLength={3}
          maxLength={300}
          value={source}
          placeholder="FDA page and date"
          onChange={e => setSource(e.target.value)}
          className="rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground"
        />
      </label>
      <button type="submit" disabled={busy} className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50">
        {busy ? 'Saving...' : 'Save review'}
      </button>
      {message && (
        <p role={message.tone === 'error' ? 'alert' : 'status'} className={`text-xs ${message.tone === 'error' ? 'text-red-700' : 'text-emerald-700'}`}>
          {message.text}
        </p>
      )}
    </form>
  )
}
