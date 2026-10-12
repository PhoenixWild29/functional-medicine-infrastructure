'use client'

// Patient Intake PR 2: "Resend link" for a patient who has not finished
// intake (Dashboard rows, patient header). A new link replaces the open
// one; it is texted when texting is set up and always shown to copy or
// email.

import { useState } from 'react'
import { IntakeLinkPanel, type IntakeLinkInfo } from './intake-link-panel'

export function ResendIntakeLink({ patientId, className = '' }: { patientId: string; className?: string }) {
  const [busy, setBusy] = useState(false)
  const [link, setLink] = useState<IntakeLinkInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function resend() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/patients/${patientId}/intake-link`, { method: 'POST' })
      const body = await res.json().catch(() => ({})) as { intake?: IntakeLinkInfo; code?: string }
      if (res.ok && body.intake) {
        setLink(body.intake)
      } else if (body.code === 'INTAKE_COMPLETE') {
        setError('This patient has already finished their details. Reload to see them.')
      } else {
        setError('Could not make a new link. Try again.')
      }
    } catch {
      setError('Could not make a new link. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={e => { e.stopPropagation(); void resend() }}
        onKeyDown={e => e.stopPropagation()}
        disabled={busy}
        className="rounded-md border border-slate-500 px-2 py-1 text-xs font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? 'Sending…' : 'Resend link'}
      </button>
      {error && <p role="alert" className="mt-1 text-xs text-red-700">{error}</p>}
      {link && (
        <div className="mt-2" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
          <IntakeLinkPanel link={link} idPrefix={`resend-${patientId}`} />
        </div>
      )}
    </div>
  )
}
