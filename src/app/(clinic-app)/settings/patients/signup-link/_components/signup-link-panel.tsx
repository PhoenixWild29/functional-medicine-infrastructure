'use client'

// ============================================================
// Settings > Patients > Patient sign-up link (Patient Intake PR 3)
// ============================================================
//
// The clinic's standing link and its QR code, for the waiting room. A new
// patient who scans it signs up through the self-intake steps.
//   - Everyone who sees this page: the link, the QR code, Copy, Print.
//   - The clinic admin also: Turn off / Turn on, and Make a new link (after
//     a confirmation: the old link and printed QR codes stop working).
// The print sheet carries the clinic name, the QR code and the link only:
// no patient data. WCAG 2.1 AA: labelled controls, results and errors
// announced.

import { useState } from 'react'
import { QrCode } from './qr-code'

export interface SignupLinkView {
  linkId: string
  enabled: boolean
  useCount: number
  lastUsedAt: string | null
  createdAt: string
  url: string
}

const QR_LABEL = 'QR code for the patient sign-up link'
const primaryButton = 'rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60'
const secondaryButton = 'rounded-md border border-slate-500 px-4 py-2 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60'

// Print only the sheet, whatever layout surrounds this page.
const PRINT_CSS = `@media print {
  body * { visibility: hidden !important; }
  #signup-print-sheet, #signup-print-sheet * { visibility: visible !important; }
  #signup-print-sheet { position: absolute; inset: 0; display: flex !important; }
}`

const formatDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })

export function SignupLinkPanel({ clinicName, initial, canManage }: { clinicName: string; initial: SignupLinkView | null; canManage: boolean }) {
  const [link, setLink] = useState<SignupLinkView | null>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  async function change(action: 'create' | 'disable' | 'enable') {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/settings/signup-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const body = await res.json().catch(() => ({})) as { link?: SignupLinkView; error?: string }
      if (!res.ok || !body.link) {
        setError(body.error ?? 'The sign-up link could not be changed. Try again.')
        return
      }
      setLink(body.link)
      setConfirming(false)
      setNotice(action === 'create' ? 'New link made. The old link no longer works.' : action === 'disable' ? 'Link turned off.' : 'Link turned on.')
    } catch {
      setError('The sign-up link could not be changed. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (!link) return
    setError(null)
    try {
      await navigator.clipboard.writeText(link.url)
      setNotice('Link copied.')
    } catch {
      setError('The link could not be copied. Select it and copy it instead.')
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Patient sign-up link</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          New patients scan this QR code or open the link to sign up with {clinicName}. They give their details, address and
          allergies, and appear in Select Patient labelled &ldquo;From sign-up link&rdquo;. Possible duplicates are flagged for you; nobody is told whether
          they are already a patient.
        </p>
      </div>

      {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <p role="status" className="text-sm text-foreground empty:hidden">{notice}</p>

      {!link ? (
        <section className="space-y-3 rounded-lg border border-border bg-card p-6">
          <p className="text-sm text-foreground">Your clinic does not have a sign-up link yet.</p>
          {canManage ? (
            <button type="button" onClick={() => void change('create')} disabled={busy} className={primaryButton}>
              {busy ? 'Creating…' : 'Create a sign-up link'}
            </button>
          ) : (
            <p className="text-sm text-foreground">Ask your clinic admin to create one.</p>
          )}
        </section>
      ) : (
        <section aria-label="Your clinic’s sign-up link" className="space-y-4 rounded-lg border border-border bg-card p-6">
          {!link.enabled && (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              This link is off. Patients who open it are told it is no longer active.
            </p>
          )}
          <div className="flex flex-col gap-6 sm:flex-row">
            <QrCode text={link.url} label={QR_LABEL} className="h-48 w-48 shrink-0 rounded-md border border-border" />
            <div className="min-w-0 flex-1 space-y-3">
              <div>
                <label htmlFor="signup-link-url" className="block text-sm font-medium text-foreground">Sign-up link</label>
                <input
                  id="signup-link-url"
                  type="text"
                  readOnly
                  value={link.url}
                  onFocus={e => e.currentTarget.select()}
                  className="mt-1 block w-full rounded-md border border-slate-500 bg-background px-3 py-2 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <p className="text-sm text-foreground">
                {link.enabled ? 'On' : 'Off'}. Made {formatDate(link.createdAt)}. Used {link.useCount} {link.useCount === 1 ? 'time' : 'times'}.
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void copy()} className={secondaryButton}>Copy link</button>
                <button type="button" onClick={() => window.print()} className={secondaryButton}>Print</button>
                {canManage && (
                  <button type="button" onClick={() => void change(link.enabled ? 'disable' : 'enable')} disabled={busy} className={secondaryButton}>
                    {link.enabled ? 'Turn off' : 'Turn on'}
                  </button>
                )}
                {canManage && !confirming && (
                  <button type="button" onClick={() => { setError(null); setConfirming(true) }} disabled={busy} className={secondaryButton}>Make a new link</button>
                )}
              </div>
              {!canManage && (
                <p className="text-sm text-muted-foreground">Only the clinic admin can turn this link off or make a new one.</p>
              )}
              {canManage && confirming && (
                <div role="group" aria-label="Make a new link" className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3">
                  <p className="text-sm text-amber-950">
                    The current link and any printed QR codes will stop working. Patients who open them are told the link is no longer active.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => void change('create')} disabled={busy} className={primaryButton}>
                      {busy ? 'Making…' : 'Yes, make a new link'}
                    </button>
                    <button type="button" onClick={() => setConfirming(false)} className={secondaryButton}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* The print sheet: clinic name, QR code and link. No patient data. */}
          <style>{PRINT_CSS}</style>
          <div id="signup-print-sheet" data-testid="signup-print-sheet" className="hidden flex-col items-center justify-center gap-6 bg-white p-12 text-center text-black">
            <p className="text-3xl font-semibold">{clinicName}</p>
            <p className="text-xl">Scan to sign up as a new patient</p>
            <QrCode text={link.url} label={QR_LABEL} className="h-72 w-72" />
            <p className="break-all font-mono text-sm">{link.url}</p>
          </div>
        </section>
      )}
    </div>
  )
}
