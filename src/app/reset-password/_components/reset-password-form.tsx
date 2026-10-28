'use client'

// /reset-password (B11): the recovery session sets a new password (POST
// /api/auth/password, which signs out every session), then /login says so.

import { useState, type FormEvent } from 'react'
import { navigateFully } from '@/lib/auth/full-navigation'
import { MIN_PASSWORD_LENGTH } from '@/lib/auth/create-login'

const INPUT = 'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring'

export function ResetPasswordForm() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (saving) return
    if (password !== confirm) {
      setError('The passwords do not match.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (res.ok) {
        navigateFully('/login?notice=password_reset')
        return
      }
      const json = await res.json().catch(() => ({})) as { error?: string }
      setError(json.error ?? 'Your password could not be changed. Try again.')
    } catch {
      setError('Your password could not be changed. Try again.')
    }
    setSaving(false)
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && (
        <p data-testid="reset-password-error" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}
      <div className="space-y-1.5">
        <label htmlFor="new-password" className="block text-sm font-medium text-foreground">New password</label>
        <input id="new-password" type="password" autoComplete="new-password" required value={password} onChange={e => setPassword(e.target.value)} disabled={saving} aria-describedby="new-password-hint" className={INPUT} />
        <p id="new-password-hint" className="text-xs text-muted-foreground">
          At least {MIN_PASSWORD_LENGTH} characters. Not a common password, and not your email address.
        </p>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="confirm-password" className="block text-sm font-medium text-foreground">Confirm new password</label>
        <input id="confirm-password" type="password" autoComplete="new-password" required value={confirm} onChange={e => setConfirm(e.target.value)} disabled={saving} className={INPUT} />
      </div>
      <button
        type="submit"
        disabled={saving || !password || !confirm}
        className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Set new password'}
      </button>
    </form>
  )
}
