'use client'

// Patient Intake PR 2: "Possible duplicate of <name>", for a patient whose
// intake matched another patient in the clinic (same mobile + date of
// birth, or same name + date of birth). Never merged: staff check, and
// Dismiss records who and when and writes the PHI access log.

import { useState } from 'react'

interface Props {
  patientId: string
  duplicateName: string
  onDismissed?: () => void
  className?: string
}

export function PossibleDuplicateFlag({ patientId, duplicateName, onDismissed, className = '' }: Props) {
  const [dismissed, setDismissed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (dismissed) return null

  async function dismiss() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/patients/${patientId}/duplicate-flag`, { method: 'DELETE' })
      if (res.ok) {
        setDismissed(true)
        onDismissed?.()
        return
      }
      setError('The flag could not be dismissed. Try again.')
    } catch {
      setError('The flag could not be dismissed. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={className} onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
      <div className="inline-flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1">
        <span className="text-xs font-medium text-amber-950">Possible duplicate of {duplicateName}</span>
        <button
          type="button"
          onClick={() => void dismiss()}
          disabled={busy}
          aria-label={`Dismiss possible duplicate of ${duplicateName}`}
          className="rounded border border-amber-700 px-1.5 py-0.5 text-[11px] font-semibold text-amber-950 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        >
          {busy ? 'Dismissing…' : 'Dismiss'}
        </button>
      </div>
      {error && <p role="alert" className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  )
}
