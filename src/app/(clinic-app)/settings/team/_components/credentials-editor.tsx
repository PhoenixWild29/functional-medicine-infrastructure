'use client'

// ============================================================
// Team: the clinic admin's credential controls (Compliance C4)
// ============================================================
//
// Add or update a state license (one per state; saving a state again
// replaces it) and re-run the NPI check against the registry. Both call
// the admin-only APIs and refresh the page with what was stored.

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC', 'AS', 'GU', 'MP', 'PR', 'VI',
]

export function CredentialsEditor({ providerId, providerName }: { providerId: string; providerName: string }) {
  const router = useRouter()
  const [state, setState] = useState('')
  const [licenseNumber, setLicenseNumber] = useState('')
  const [expiresOn, setExpiresOn] = useState('')
  const [busy, setBusy] = useState<'license' | 'npi' | null>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  async function saveLicense(e: React.FormEvent) {
    e.preventDefault()
    setBusy('license')
    setMessage(null)
    try {
      const res = await fetch(`/api/providers/${providerId}/licenses`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state, licenseNumber, expiresOn }),
      })
      const body = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) {
        setMessage({ tone: 'error', text: body.error ?? 'The license could not be saved.' })
        return
      }
      setMessage({ tone: 'ok', text: `${state} license saved.` })
      setState('')
      setLicenseNumber('')
      setExpiresOn('')
      router.refresh()
    } catch {
      setMessage({ tone: 'error', text: 'The license could not be saved. Check your connection and try again.' })
    } finally {
      setBusy(null)
    }
  }

  async function rerunNpi() {
    setBusy('npi')
    setMessage(null)
    try {
      const res = await fetch(`/api/providers/${providerId}/npi-check`, { method: 'POST' })
      const body = await res.json().catch(() => ({})) as { error?: string; status?: string; reason?: string | null }
      if (!res.ok) {
        setMessage({ tone: 'error', text: body.error ?? 'The NPI check could not be run.' })
        return
      }
      setMessage(body.status === 'verified'
        ? { tone: 'ok', text: 'NPI verified with the registry.' }
        : { tone: 'error', text: body.reason ?? 'The NPI was not verified.' })
      router.refresh()
    } catch {
      setMessage({ tone: 'error', text: 'The NPI check could not be run. Check your connection and try again.' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <form onSubmit={saveLicense} className="flex flex-wrap items-end gap-3" aria-label={`Add or update a license for ${providerName}`}>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          State
          <select required value={state} onChange={e => setState(e.target.value)} className="rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground">
            <option value="">Choose</option>
            {STATES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          License number
          <input required maxLength={40} value={licenseNumber} onChange={e => setLicenseNumber(e.target.value)} className="rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Expires on
          <input required type="date" value={expiresOn} onChange={e => setExpiresOn(e.target.value)} className="rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground" />
        </label>
        <button type="submit" disabled={busy !== null} className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
          {busy === 'license' ? 'Saving...' : 'Save license'}
        </button>
        <button type="button" onClick={rerunNpi} disabled={busy !== null} className="rounded-md border border-border px-4 py-1.5 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50">
          {busy === 'npi' ? 'Checking...' : 'Re-run NPI check'}
        </button>
      </form>
      {message && (
        <p role={message.tone === 'error' ? 'alert' : 'status'} className={`text-xs ${message.tone === 'error' ? 'text-red-700' : 'text-emerald-700'}`}>
          {message.text}
        </p>
      )}
    </div>
  )
}
