'use client'

// ============================================================
// Pharmacy invite: create the pharmacy_admin account
// ============================================================
//
// The account is created server-side (POST /api/onboard/pharmacy/<token>:
// role and pharmacy in app_metadata, never here). Then it signs in and
// goes to MFA enrollment, which a pharmacy_admin always needs, and from
// there to the onboarding wizard.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@/lib/supabase/client'
import { FormAlert, PrimaryButton, TextField, fieldErrors, sendJson } from '@/components/onboarding/fields'

const MIN_PASSWORD = 12

export function AcceptInviteForm({ token, pharmacyName, adminEmail }: { token: string; pharmacyName: string; adminEmail: string }) {
  const router = useRouter()
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const local: Record<string, string> = {}
    if (fullName.trim().length < 2) local['fullName'] = 'Enter your full name.'
    if (password.length < MIN_PASSWORD) local['password'] = `Use at least ${MIN_PASSWORD} characters.`
    if (confirm !== password) local['confirm'] = 'The passwords do not match.'
    if (Object.keys(local).length > 0) {
      setErrors(local)
      setMessage(local['confirm'] && Object.keys(local).length === 1 ? 'The passwords do not match.' : 'Check the highlighted fields.')
      return
    }

    setBusy(true)
    setErrors({})
    setMessage(null)
    const res = await sendJson(`/api/onboard/pharmacy/${encodeURIComponent(token)}`, 'POST', { fullName: fullName.trim(), password })
    if (!res.ok) {
      setBusy(false)
      setErrors(fieldErrors(res.data))
      setMessage(typeof res.data['error'] === 'string' ? res.data['error'] : 'Your account could not be created. Try again.')
      return
    }
    const { error } = await createBrowserClient().auth.signInWithPassword({ email: adminEmail, password })
    if (error) {
      setBusy(false)
      setMessage('Your account was created. Sign in to continue.')
      router.push('/login?redirectTo=%2Fpharmacy%2Fonboarding')
      return
    }
    router.push(`/mfa/enroll?redirectTo=${encodeURIComponent('/pharmacy/onboarding')}`)
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-5" aria-describedby="accept-intro">
      <p id="accept-intro" className="text-sm text-muted-foreground">
        You were invited to set up <strong className="text-foreground">{pharmacyName}</strong> on CompoundIQ. Your account
        will use <strong className="text-foreground">{adminEmail}</strong>. After this you will set up two-step sign-in.
      </p>
      <FormAlert message={message} />
      <TextField id="fullName" label="Full name" value={fullName} onChange={setFullName} error={errors['fullName']} autoComplete="name" required maxLength={100} />
      <TextField
        id="password" label="Password" type="password" value={password} onChange={setPassword} error={errors['password']}
        hint={`At least ${MIN_PASSWORD} characters. A short phrase is easier to remember.`} autoComplete="new-password" required
      />
      <TextField id="confirm" label="Confirm password" type="password" value={confirm} onChange={setConfirm} error={errors['confirm']} autoComplete="new-password" required />
      <PrimaryButton busy={busy}>{busy ? 'Creating your account…' : 'Create account'}</PrimaryButton>
    </form>
  )
}
