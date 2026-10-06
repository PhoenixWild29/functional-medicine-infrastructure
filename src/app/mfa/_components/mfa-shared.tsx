'use client'

// Shared pieces of the enroll and challenge pages.

import { useState } from 'react'
import { createBrowserClient } from '@/lib/supabase/client'
import { redirectToLogin } from '@/lib/auth/redirect-to-login'

export function MfaCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-card p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-foreground">{title}</h1>
        {children}
      </div>
    </main>
  )
}

/** A 6-digit code field; submit is enabled only for exactly six digits. */
export function CodeForm({ onSubmit, busy, submitLabel }: {
  onSubmit: (code: string) => void | Promise<void>
  busy: boolean
  submitLabel: string
}) {
  const [code, setCode] = useState('')
  const valid = /^\d{6}$/.test(code)
  return (
    <form
      className="space-y-2"
      onSubmit={e => { e.preventDefault(); if (valid && !busy) void onSubmit(code) }}
    >
      <label htmlFor="mfa-code" className="block text-xs font-medium text-muted-foreground">6-digit code</label>
      <input
        id="mfa-code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={code}
        onChange={e => setCode(e.target.value.trim())}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-center font-mono text-lg tracking-widest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <button
        type="submit"
        disabled={!valid || busy}
        className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {busy ? 'Checking...' : submitLabel}
      </button>
    </form>
  )
}

/** A user without their phone must be able to leave, not be stuck here. */
export function SignOutLink() {
  const [supabase] = useState(() => createBrowserClient())
  return (
    <button
      type="button"
      onClick={async () => { await supabase.auth.signOut(); redirectToLogin() }}
      className="text-xs text-muted-foreground underline-offset-2 hover:underline focus-visible:outline-none"
    >
      Sign out
    </button>
  )
}
