'use client'

// "Forgot password?" (B11): asks POST /api/auth/password-reset to email the
// reset link. The answer is the same whether or not the address has an
// account.

import Link from 'next/link'
import { useState, type FormEvent } from 'react'

const INPUT = 'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
const LINK = 'font-medium text-primary underline underline-offset-2 hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (sending) return
    setSending(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      const json = await res.json().catch(() => ({})) as { message?: string; error?: string }
      if (res.ok) setSent(json.message ?? 'If an account uses that email, we sent it a link to set a new password.')
      else setError(json.error ?? 'The reset link could not be requested. Try again.')
    } catch {
      setError('The reset link could not be requested. Try again.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-5">
      {sent ? (
        <p role="status" data-testid="reset-sent" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {sent}
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error && (
            <p data-testid="reset-request-error" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
          )}
          <div className="space-y-1.5">
            <label htmlFor="reset-email" className="block text-sm font-medium text-foreground">Email address</label>
            <input id="reset-email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} disabled={sending} className={INPUT} />
          </div>
          <button
            type="submit"
            disabled={sending || !email.trim()}
            className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
          >
            {sending ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
      )}
      <p className="text-center text-sm">
        <Link href="/login" className={LINK}>Back to sign in</Link>
      </p>
    </div>
  )
}
