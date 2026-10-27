'use client'

// Settings > Account "Change password" (B11): POST /api/auth/password/change
// checks the current password, applies the policy and signs out the
// person's other sessions. This one stays signed in.

import { useState, type FormEvent } from 'react'
import { MIN_PASSWORD_LENGTH } from '@/lib/auth/create-login'

const INPUT = 'mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
const LABEL = 'block text-sm font-medium text-foreground'

export function ChangePasswordForm() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (saving) return
    setDone(false)
    if (next !== confirm) {
      setError('The new passwords do not match.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/password/change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      })
      if (res.ok) {
        setDone(true)
        setCurrent('')
        setNext('')
        setConfirm('')
      } else {
        const json = await res.json().catch(() => ({})) as { error?: string }
        setError(json.error ?? 'Your password could not be changed. Try again.')
      }
    } catch {
      setError('Your password could not be changed. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 max-w-sm" noValidate aria-label="Change password">
      {done && (
        <p role="status" data-testid="change-password-done" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Your password was changed. You were signed out on your other devices.
        </p>
      )}
      {error && (
        <p data-testid="change-password-error" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}
      <div>
        <label htmlFor="current-password" className={LABEL}>Current password</label>
        <input id="current-password" type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} disabled={saving} className={INPUT} />
      </div>
      <div>
        <label htmlFor="change-new-password" className={LABEL}>New password</label>
        <input id="change-new-password" type="password" autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} disabled={saving} aria-describedby="change-new-password-hint" className={INPUT} />
        <p id="change-new-password-hint" className="mt-1 text-xs text-slate-700 dark:text-slate-300">
          At least {MIN_PASSWORD_LENGTH} characters. Not a common password, and not your email address.
        </p>
      </div>
      <div>
        <label htmlFor="change-confirm-password" className={LABEL}>Confirm new password</label>
        <input id="change-confirm-password" type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} disabled={saving} className={INPUT} />
      </div>
      <button
        type="submit"
        disabled={saving || !current || !next || !confirm}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Change password'}
      </button>
    </form>
  )
}
