'use client'

// ============================================================
// Ops: delete an unapproved self sign-up
// ============================================================
//
// Security review M2/M3: someone may sign up first with another person's
// email or NPI. Ops can remove the sign-up (its logins, provider records
// and licenses; the clinic is closed) after a confirmation. POST
// /api/ops/onboarding/clinics/[clinicId] { action: 'delete_signup',
// confirm: true }, ops_admin only (lib/onboarding/delete-signup). Shown on
// the review page for a self sign-up that is not approved.

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const BUTTON = 'inline-flex min-h-[44px] items-center rounded-md border border-slate-500 bg-background px-4 text-sm font-medium text-foreground hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50'
const DANGER = 'inline-flex min-h-[44px] items-center rounded-md bg-red-700 px-4 text-sm font-semibold text-white hover:bg-red-800 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50'

export function DeleteSignupPanel({ clinicId, clinicName }: { clinicId: string; clinicName: string }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/ops/onboarding/clinics/${clinicId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_signup', confirm: true }),
      })
      const body = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) {
        setError(body.error ?? 'The sign-up could not be deleted. Try again.')
        setBusy(false)
        return
      }
      router.push('/ops/onboarding')
    } catch {
      setError('The connection failed. Check your network and try again.')
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="delete-signup-heading" className="space-y-3 rounded-lg border border-red-300 p-4 dark:border-red-400">
      <h2 id="delete-signup-heading" className="text-lg font-semibold text-foreground">Delete this sign-up</h2>
      <p className="text-sm text-slate-700 dark:text-slate-300">
        For a sign-up made with someone else&apos;s email or NPI. Nothing was ordered: the clinic is not approved.
      </p>
      {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {confirming ? (
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">
            Delete {clinicName}? Its logins, provider records and licenses are removed, and the clinic is closed. This cannot be undone.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={DANGER} disabled={busy} onClick={() => void remove()}>Yes, delete {clinicName}</button>
            <button type="button" className={BUTTON} disabled={busy} onClick={() => setConfirming(false)}>Keep it</button>
          </div>
        </div>
      ) : (
        <button type="button" className={BUTTON} onClick={() => setConfirming(true)}>Delete this sign-up</button>
      )}
    </section>
  )
}
