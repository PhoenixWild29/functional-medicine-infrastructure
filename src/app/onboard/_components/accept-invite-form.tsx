'use client'

// ============================================================
// Accept an onboarding invite: create the account
// ============================================================
//
// For the clinic admin (/onboard/clinic/<token>) and invited providers
// and medical assistants (/onboard/join/<token>). The email is the one
// the invite was sent to; the invitee sets their name and password. The
// server creates the account with the role and clinic in app_metadata,
// then the page signs them in and continues (the wizard for the admin).
// Two-step sign-in, if required, follows through the normal MFA gate.

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@/lib/supabase/client'
import { TextField, FormAlert, BUTTON_PRIMARY } from '@/components/onboarding/fields'
import type { InviteKind, InviteStatus } from '@/lib/onboarding/tokens'

const MIN_PASSWORD = 12

const ROLE_LABEL: Record<InviteKind, string> = {
  clinic_admin:      'clinic admin',
  provider:          'provider',
  medical_assistant: 'medical assistant',
}

interface Props {
  token:      string
  kind:       InviteKind
  clinicName: string
  email:      string
  status:     InviteStatus | 'not_found'
}

const UNAVAILABLE: Record<Exclude<Props['status'], 'pending'>, { title: string; body: string }> = {
  accepted:  { title: 'This invite has been used', body: 'An account has already been created with this link. Sign in instead.' },
  revoked:   { title: 'This invite was withdrawn', body: 'Ask the person who invited you for a new link.' },
  expired:   { title: 'This invite has expired', body: 'Invite links work for 7 days. Ask the person who invited you for a new one.' },
  not_found: { title: 'This invite link is not valid', body: 'Check that you copied the whole link, or ask for a new one.' },
}

export function AcceptInviteForm({ token, kind, clinicName, email, status }: Props) {
  const router = useRouter()
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (status !== 'pending') {
    const u = UNAVAILABLE[status]
    return (
      <section aria-labelledby="invite-title" className="space-y-3">
        <h1 id="invite-title" className="text-2xl font-bold text-foreground">{u.title}</h1>
        <p className="text-sm text-slate-700">{u.body}</p>
        <a href="/login" className="inline-block text-sm font-medium text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Go to sign in
        </a>
      </section>
    )
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const next: Record<string, string> = {}
    if (!fullName.trim()) next['fullName'] = 'Enter your full name.'
    if (password.length < MIN_PASSWORD) next['password'] = `Use at least ${MIN_PASSWORD} characters.`
    if (confirm !== password) next['confirm'] = 'The passwords do not match.'
    setErrors(next)
    setFormError(null)
    if (Object.keys(next).length > 0) return

    setBusy(true)
    try {
      const res = await fetch('/api/onboarding/invite/accept', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ token, fullName: fullName.trim(), password }),
      })
      const data = await res.json().catch(() => ({})) as { error?: string; errors?: Record<string, string>; next?: string }
      if (!res.ok) {
        if (data.errors) setErrors(data.errors)
        setFormError(data.error ?? 'Your account could not be created. Try again.')
        setBusy(false)
        return
      }
      const supabase = createBrowserClient()
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        router.push('/login?redirectTo=' + encodeURIComponent(data.next ?? '/'))
        return
      }
      router.refresh()
      router.push(data.next ?? '/')
    } catch {
      setFormError('Network error. Check your connection and try again.')
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="invite-title" className="space-y-6">
      <div>
        <h1 id="invite-title" className="text-2xl font-bold text-foreground">Join {clinicName} on CompoundIQ</h1>
        <p className="mt-1 text-sm text-slate-700">
          You were invited as the {ROLE_LABEL[kind]}. Your account email is <strong className="font-semibold text-foreground">{email}</strong>.
        </p>
      </div>
      {formError && <FormAlert id="invite-form-error">{formError}</FormAlert>}
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        <TextField id="invite-name" label="Full name" autoComplete="name" value={fullName} onChange={e => setFullName(e.target.value)} error={errors['fullName']} disabled={busy} required />
        <TextField id="invite-password" label="Password" type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} error={errors['password']} hint={`At least ${MIN_PASSWORD} characters.`} disabled={busy} required />
        <TextField id="invite-confirm" label="Confirm password" type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} error={errors['confirm']} disabled={busy} required />
        <button type="submit" className={`${BUTTON_PRIMARY} w-full`} disabled={busy}>
          {busy ? 'Creating your account…' : 'Create account'}
        </button>
        <p className="text-xs text-slate-600">
          After you sign in you may be asked to set up two-step verification.
        </p>
      </form>
    </section>
  )
}
