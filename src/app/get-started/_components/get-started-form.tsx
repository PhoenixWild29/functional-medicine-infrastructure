'use client'

// ============================================================
// /get-started: sign up without an invite
// ============================================================
//
// Three choices, each with one line on what happens next, then the form
// for that choice. POST /api/signup creates the account (lib/signup/
// self-serve); the page then signs in, as the invite pages do, and goes
// where the server says: the app under the pending-review banner (solo
// provider), the clinic wizard, or the pharmacy wizard. Two-step sign-in
// follows the normal rules (pharmacies always set it up).
//
// Copy: plain words; no em dashes; no promise of an email or a text (none
// is sent). The "website" field is a honeypot: hidden from people and
// assistive technology, filled only by bots.

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@/lib/supabase/client'
import { navigateFully, sameOriginPath } from '@/lib/auth/full-navigation'
import { TextField, SelectField, FormAlert, BUTTON_PRIMARY, BUTTON_SECONDARY } from '@/components/onboarding/fields'
import { US_STATES } from '@/lib/geo/us-states'

const MIN_PASSWORD = 12
const MAX_LICENSES = 10

type Kind = 'solo_provider' | 'clinic' | 'pharmacy'

const CHOICES: Array<{ kind: Kind; title: string; next: string }> = [
  {
    kind:  'solo_provider',
    title: "I'm a provider (solo practice)",
    next:  'Add your NPI and state licenses now. Look around right away; you can prescribe once we approve your account.',
  },
  {
    kind:  'clinic',
    title: 'I run a clinic or practice',
    next:  'Next you set up your practice, providers and agreements. Look around right away; ordering opens once we approve your clinic.',
  },
  {
    kind:  'pharmacy',
    title: 'I run a compounding pharmacy',
    next:  'Next you add your licenses, ordering method and catalog. Prescribers can send you orders once we approve your pharmacy.',
  },
]

const ORG_LABEL: Record<Kind, string> = {
  solo_provider: 'Practice name',
  clinic:        'Clinic or practice name',
  pharmacy:      'Pharmacy name',
}

interface License { state: string; licenseNumber: string; expiresOn: string }
const EMPTY_LICENSE: License = { state: '', licenseNumber: '', expiresOn: '' }

export function GetStartedForm() {
  const router = useRouter()
  const [kind, setKind] = useState<Kind | null>(null)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [organizationName, setOrganizationName] = useState('')
  const [npiNumber, setNpiNumber] = useState('')
  const [deaNumber, setDeaNumber] = useState('')
  const [licenses, setLicenses] = useState<License[]>([{ ...EMPTY_LICENSE }])
  const [website, setWebsite] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const setLicense = (i: number, patch: Partial<License>) =>
    setLicenses(ls => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!kind) return
    const local: Record<string, string> = {}
    if (password.length < MIN_PASSWORD) local['password'] = `Use at least ${MIN_PASSWORD} characters.`
    if (confirm !== password) local['confirm'] = 'The passwords do not match.'
    setErrors(local)
    setFormError(null)
    if (Object.keys(local).length > 0) return

    const body: Record<string, unknown> = {
      kind, firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim(), password,
      organizationName: organizationName.trim(), website,
    }
    if (kind === 'solo_provider') {
      body['npiNumber'] = npiNumber.trim()
      body['deaNumber'] = deaNumber.trim()
      body['licenses'] = licenses.map(l => ({ state: l.state, licenseNumber: l.licenseNumber.trim(), expiresOn: l.expiresOn }))
    }

    setBusy(true)
    try {
      const res = await fetch('/api/signup', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({})) as { error?: string; errors?: Record<string, string>; email?: string; next?: string }
      if (!res.ok) {
        setErrors(data.errors ?? {})
        setFormError(data.error ?? 'Your account could not be created. Try again.')
        setBusy(false)
        return
      }
      const next = data.next ?? '/'
      const supabase = createBrowserClient()
      const { error } = await supabase.auth.signInWithPassword({ email: data.email ?? email.trim(), password })
      if (error) {
        router.push('/login?redirectTo=' + encodeURIComponent(next))
        return
      }
      // A full navigation, not router.refresh() + router.push(): the session
      // changed in this page, and since Next 16.3 the client router reuses a
      // redirect it already saw for the destination (lib/auth/full-navigation).
      navigateFully(sameOriginPath(next))
    } catch {
      setFormError('Network error. Check your connection and try again.')
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="get-started-title" className="space-y-6">
      <div>
        <h1 id="get-started-title" className="text-2xl font-bold text-foreground">Get started with CompoundIQ</h1>
        <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">
          Create your account and look around right away. Nothing can be ordered, signed or received until CompoundIQ approves you.
        </p>
      </div>

      <div role="radiogroup" aria-labelledby="choice-label" className="space-y-3">
        <p id="choice-label" className="text-sm font-medium text-foreground">What are you setting up?</p>
        {CHOICES.map(c => (
          <div
            key={c.kind}
            className={`rounded-lg border p-3 ${kind === c.kind ? 'border-primary bg-muted/40' : 'border-border'}`}
          >
            <div className="flex items-start gap-3">
              <input
                type="radio"
                id={`choice-${c.kind}`}
                name="kind"
                value={c.kind}
                checked={kind === c.kind}
                onChange={() => { setKind(c.kind); setErrors({}); setFormError(null) }}
                aria-describedby={`choice-${c.kind}-next`}
                className="mt-1 h-5 w-5 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                disabled={busy}
              />
              <div className="min-w-0">
                <label htmlFor={`choice-${c.kind}`} className="text-sm font-semibold text-foreground">{c.title}</label>
                <p id={`choice-${c.kind}-next`} className="text-sm text-slate-700 dark:text-slate-300">{c.next}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {kind && (
        <form onSubmit={onSubmit} noValidate className="space-y-5" aria-label="Create your account">
          {formError && <FormAlert id="get-started-error">{formError}</FormAlert>}

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField id="gs-first" label="First name" autoComplete="given-name" value={firstName} onChange={e => setFirstName(e.target.value)} error={errors['firstName']} disabled={busy} required />
            <TextField id="gs-last" label="Last name" autoComplete="family-name" value={lastName} onChange={e => setLastName(e.target.value)} error={errors['lastName']} disabled={busy} required />
          </div>
          <TextField id="gs-email" label="Email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} error={errors['email']} disabled={busy} required />
          <TextField id="gs-org" label={ORG_LABEL[kind]} autoComplete="organization" value={organizationName} onChange={e => setOrganizationName(e.target.value)} error={errors['organizationName']} disabled={busy} required />

          {kind === 'solo_provider' && (
            <>
              <TextField id="gs-npi" label="NPI" inputMode="numeric" autoComplete="off" value={npiNumber} onChange={e => setNpiNumber(e.target.value)} error={errors['npiNumber']} hint="10 digits. We check it against the national NPI registry." disabled={busy} required />

              <fieldset className="space-y-4">
                <legend className="text-sm font-medium text-foreground">State licenses</legend>
                {errors['licenses'] && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{errors['licenses']}</p>}
                {licenses.map((l, i) => (
                  <div key={i} className="space-y-3 rounded-lg border border-border p-3">
                    <SelectField id={`gs-lic-${i}-state`} label={`License ${i + 1} state`} value={l.state} onChange={e => setLicense(i, { state: e.target.value })} error={errors[`licenses.${i}.state`]} disabled={busy} required>
                      <option value="">Choose a state</option>
                      {US_STATES.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
                    </SelectField>
                    <TextField id={`gs-lic-${i}-number`} label={`License ${i + 1} number`} autoComplete="off" value={l.licenseNumber} onChange={e => setLicense(i, { licenseNumber: e.target.value })} error={errors[`licenses.${i}.licenseNumber`]} disabled={busy} required />
                    <TextField id={`gs-lic-${i}-expires`} label={`License ${i + 1} expires`} type="date" value={l.expiresOn} onChange={e => setLicense(i, { expiresOn: e.target.value })} error={errors[`licenses.${i}.expiresOn`]} disabled={busy} required />
                    {i > 0 && (
                      <button type="button" className={BUTTON_SECONDARY} onClick={() => setLicenses(ls => ls.filter((_, j) => j !== i))} disabled={busy}>
                        Remove license {i + 1}
                      </button>
                    )}
                  </div>
                ))}
                {licenses.length < MAX_LICENSES && (
                  <button type="button" className={BUTTON_SECONDARY} onClick={() => setLicenses(ls => [...ls, { ...EMPTY_LICENSE }])} disabled={busy}>
                    Add another state license
                  </button>
                )}
              </fieldset>

              <TextField id="gs-dea" label="DEA number (optional)" autoComplete="off" value={deaNumber} onChange={e => setDeaNumber(e.target.value)} error={errors['deaNumber']} hint="Leave it empty if you do not have one." disabled={busy} />
            </>
          )}

          <TextField id="gs-password" label="Password" type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} error={errors['password']} hint={`At least ${MIN_PASSWORD} characters.`} disabled={busy} required />
          <TextField id="gs-confirm" label="Confirm password" type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} error={errors['confirm']} disabled={busy} required />

          {/* Honeypot: people never see or reach it. */}
          <div aria-hidden="true" className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden">
            <label htmlFor="gs-website">Website</label>
            <input id="gs-website" name="website" type="text" tabIndex={-1} autoComplete="off" value={website} onChange={e => setWebsite(e.target.value)} />
          </div>

          <button type="submit" className={`${BUTTON_PRIMARY} w-full`} disabled={busy}>
            {busy ? 'Creating your account…' : 'Create account'}
          </button>
          {kind === 'pharmacy' && (
            <p className="text-xs text-slate-600 dark:text-slate-300">Pharmacies set up two-step verification the first time they sign in.</p>
          )}
        </form>
      )}

      <p className="text-sm text-slate-700 dark:text-slate-300">
        Already have an account?{' '}
        <a href="/login" className="font-medium text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Sign in</a>
      </p>
    </section>
  )
}
