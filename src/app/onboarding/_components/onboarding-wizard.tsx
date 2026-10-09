'use client'

// ============================================================
// Clinic onboarding wizard
// ============================================================
//
// Practice → providers → staff → BAA → terms → payouts → review. Progress
// is stored server-side, so the admin can leave and resume anywhere; the
// wizard opens at the first step that is not complete. Every save goes
// to an API route that re-checks the caller and the clinic's state, then
// the page refreshes from the server. Once submitted (or approved) the
// wizard is read-only.
//
// Accessibility (WCAG 2.1 AA, as #206): one <main>, a labelled step
// navigation with aria-current="step", focus moves to the step heading
// when the step changes, every field labelled with its error tied to it,
// focus rings on every control. Mobile first: the step list stacks above
// the panel and becomes a sidebar from md up.

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { ONBOARDING_STEPS, STEP_LABELS, firstOpenStep, isEditable, canSubmit, type StepKey, type StepStatus } from '@/lib/onboarding/steps'
import { AGREEMENTS, DRAFT_BANNER, type AgreementKey } from '@/lib/onboarding/agreement-texts'
import type { OnboardingState } from '@/lib/onboarding/state'
import { US_STATES } from '@/lib/providers/states'
import { StripeStatusSection } from '@/app/(clinic-app)/settings/_components/stripe-status-section'
import { TextField, SelectField, CheckboxField, FormAlert, InviteLink, BUTTON_PRIMARY, BUTTON_SECONDARY, BUTTON_DANGER } from '@/components/onboarding/fields'

const STATES = [...US_STATES].sort()
const STATUS_TEXT: Record<StepStatus, string> = { complete: 'Complete', in_progress: 'In progress', not_started: 'Not started' }

type Errors = Record<string, string>

async function send(url: string, method: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json().catch(() => ({})) as Record<string, unknown>
    return { ok: res.ok, data }
  } catch {
    return { ok: false, data: { error: 'Network error. Check your connection and try again.' } }
  }
}

export function OnboardingWizard({ state, initialStep }: { state: OnboardingState; initialStep?: StepKey }) {
  const router = useRouter()
  const [step, setStep] = useState<StepKey>(initialStep ?? firstOpenStep(state.steps))
  const headingRef = useRef<HTMLHeadingElement>(null)
  const firstRender = useRef(true)
  const readOnly = !isEditable(state.clinic.onboardingStatus)

  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return }
    headingRef.current?.focus()
  }, [step])

  const go = (s: StepKey) => setStep(s)
  const next = () => {
    const i = ONBOARDING_STEPS.indexOf(step)
    if (i < ONBOARDING_STEPS.length - 1) setStep(ONBOARDING_STEPS[i + 1]!)
  }
  const refresh = () => router.refresh()

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Set up {state.clinic.name}</h1>
        <p className="mt-1 text-sm text-slate-700">Your progress is saved as you go. You can leave and come back at any time.</p>
      </div>

      <div className="mb-6 space-y-3">
        {state.clinic.onboardingStatus === 'changes_requested' && (
          <FormAlert tone="warning">
            <p className="font-semibold">CompoundIQ asked for changes</p>
            {state.clinic.reviewNote && <p className="mt-1 whitespace-pre-line">{state.clinic.reviewNote}</p>}
            <p className="mt-1">Make the changes, then submit again from Review and submit.</p>
          </FormAlert>
        )}
        {state.clinic.onboardingStatus === 'submitted' && (
          <FormAlert tone="info">Submitted. CompoundIQ is reviewing your clinic; you will be able to send orders once it is approved.</FormAlert>
        )}
        {state.clinic.onboardingStatus === 'approved' && (
          <FormAlert tone="success">
            Your clinic is approved. <a href="/dashboard" className="font-semibold underline underline-offset-2">Go to the dashboard</a>.
          </FormAlert>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-[16rem_1fr]">
        <nav aria-label="Onboarding steps">
          <ol className="space-y-1">
            {ONBOARDING_STEPS.map((s, i) => (
              <li key={s}>
                <button
                  type="button"
                  onClick={() => go(s)}
                  aria-current={s === step ? 'step' : undefined}
                  className={`flex w-full min-h-[44px] items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${s === step ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted'}`}
                >
                  <span><span className="sr-only">Step {i + 1}: </span>{STEP_LABELS[s]}</span>
                  <span className={`text-xs ${s === step ? 'text-primary-foreground' : state.steps[s] === 'complete' ? 'text-emerald-800' : 'text-slate-600'}`}>
                    {STATUS_TEXT[state.steps[s]]}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <section aria-labelledby="step-heading" className="rounded-lg border border-border bg-card p-4 sm:p-6">
          <h2 id="step-heading" ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-foreground focus-visible:outline-none">
            {STEP_LABELS[step]}
          </h2>
          <div className="mt-4">
            {step === 'practice'  && <PracticeStep state={state} readOnly={readOnly} onSaved={() => { refresh(); next() }} />}
            {step === 'providers' && <ProvidersStep state={state} readOnly={readOnly} onChanged={refresh} onDone={() => { refresh(); next() }} />}
            {step === 'staff'     && <StaffStep state={state} readOnly={readOnly} onChanged={refresh} onDone={() => { refresh(); next() }} />}
            {step === 'baa'       && <AgreementStep agreement="baa" state={state} readOnly={readOnly} onAccepted={() => { refresh(); next() }} />}
            {step === 'terms'     && <AgreementStep agreement="terms" state={state} readOnly={readOnly} onAccepted={() => { refresh(); next() }} />}
            {step === 'payouts'   && <PayoutsStep state={state} readOnly={readOnly} onDone={() => { refresh(); next() }} />}
            {step === 'review'    && <ReviewStep state={state} readOnly={readOnly} onGo={go} onSubmitted={refresh} />}
          </div>
        </section>
      </div>
    </main>
  )
}

// ── Practice ─────────────────────────────────────────────────

function PracticeStep({ state, readOnly, onSaved }: { state: OnboardingState; readOnly: boolean; onSaved: () => void }) {
  const c = state.clinic
  const [v, setV] = useState({
    legalName: c.legalName ?? '', dbaName: c.dbaName ?? '', addressLine1: c.addressLine1 ?? '', addressLine2: c.addressLine2 ?? '',
    city: c.city ?? '', state: c.state ?? '', postalCode: c.postalCode ?? '', phone: c.phone ?? '', practiceNpi: c.practiceNpi ?? '',
    taxIdLast4: c.taxIdLast4 ?? '', absorbShipping: c.absorbShipping,
  })
  const [errors, setErrors] = useState<Errors>({})
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV(prev => ({ ...prev, [k]: e.target.value }))

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    const r = await send('/api/onboarding/practice', 'PUT', v)
    setBusy(false)
    if (!r.ok) {
      setErrors((r.data['errors'] as Errors | undefined) ?? {})
      setMsg((r.data['error'] as string | undefined) ?? 'The practice details could not be saved.')
      return
    }
    setErrors({})
    onSaved()
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <p className="text-sm text-slate-700">Your practice as it should appear on prescriptions and payouts. We ask for the last 4 digits of the tax ID only.</p>
      {msg && <FormAlert>{msg}</FormAlert>}
      <fieldset disabled={readOnly || busy} className="grid gap-4 sm:grid-cols-2">
        <legend className="sr-only">Practice details</legend>
        <div className="sm:col-span-2"><TextField id="p-legal" label="Legal name" autoComplete="organization" value={v.legalName} onChange={set('legalName')} error={errors['legalName']} required /></div>
        <div className="sm:col-span-2"><TextField id="p-dba" label="DBA (optional)" value={v.dbaName} onChange={set('dbaName')} error={errors['dbaName']} hint="The name patients know you by, if different." /></div>
        <div className="sm:col-span-2"><TextField id="p-addr1" label="Address line 1" autoComplete="address-line1" value={v.addressLine1} onChange={set('addressLine1')} error={errors['addressLine1']} required /></div>
        <div className="sm:col-span-2"><TextField id="p-addr2" label="Address line 2 (optional)" autoComplete="address-line2" value={v.addressLine2} onChange={set('addressLine2')} error={errors['addressLine2']} /></div>
        <TextField id="p-city" label="City" autoComplete="address-level2" value={v.city} onChange={set('city')} error={errors['city']} required />
        <SelectField id="p-state" label="State" autoComplete="address-level1" value={v.state} onChange={set('state')} error={errors['state']} required>
          <option value="">Choose a state</option>
          {STATES.map(s => <option key={s} value={s}>{s}</option>)}
        </SelectField>
        <TextField id="p-zip" label="ZIP code" autoComplete="postal-code" inputMode="numeric" value={v.postalCode} onChange={set('postalCode')} error={errors['postalCode']} required />
        <TextField id="p-phone" label="Phone" type="tel" autoComplete="tel" value={v.phone} onChange={set('phone')} error={errors['phone']} required />
        <TextField id="p-npi" label="Practice NPI (Type 2, optional)" inputMode="numeric" value={v.practiceNpi} onChange={set('practiceNpi')} error={errors['practiceNpi']} hint="The organization NPI, if the practice has one." />
        <TextField id="p-tax" label="Tax ID (last 4 digits)" inputMode="numeric" maxLength={4} autoComplete="off" value={v.taxIdLast4} onChange={set('taxIdLast4')} error={errors['taxIdLast4']} hint="Only the last 4 digits. Never enter the whole number." required />
        <div className="sm:col-span-2">
          <CheckboxField id="p-ship" label="The clinic pays for shipping" hint="If unchecked, shipping is added to the patient's payment." checked={v.absorbShipping} onChange={e => setV(prev => ({ ...prev, absorbShipping: e.target.checked }))} />
        </div>
      </fieldset>
      {!readOnly && <button type="submit" className={BUTTON_PRIMARY} disabled={busy}>{busy ? 'Saving…' : 'Save and continue'}</button>}
    </form>
  )
}

// ── Providers ────────────────────────────────────────────────

const EMPTY_PROVIDER = { firstName: '', lastName: '', email: '', npiNumber: '', licenseState: '', licenseNumber: '', licenseExpiresOn: '' }

function ProvidersStep({ state, readOnly, onChanged, onDone }: { state: OnboardingState; readOnly: boolean; onChanged: () => void; onDone: () => void }) {
  const [v, setV] = useState(EMPTY_PROVIDER)
  const [errors, setErrors] = useState<Errors>({})
  const [msg, setMsg] = useState<string | null>(null)
  const [link, setLink] = useState<{ link: string; email: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV(prev => ({ ...prev, [k]: e.target.value }))

  async function add(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setMsg(null); setLink(null)
    const r = await send('/api/onboarding/providers', 'POST', v)
    setBusy(false)
    if (!r.ok) {
      setErrors((r.data['errors'] as Errors | undefined) ?? {})
      setMsg((r.data['error'] as string | undefined) ?? 'The provider could not be added.')
      return
    }
    setErrors({})
    if (typeof r.data['link'] === 'string') setLink({ link: r.data['link'], email: v.email.trim().toLowerCase() })
    else if (typeof r.data['error'] === 'string') setMsg(r.data['error'])
    setV(EMPTY_PROVIDER)
    onChanged()
  }

  async function finish() {
    setBusy(true); setMsg(null)
    const r = await send('/api/onboarding/steps', 'POST', { step: 'providers' })
    setBusy(false)
    if (!r.ok) { setMsg((r.data['error'] as string | undefined) ?? 'This step could not be completed.'); return }
    onDone()
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-700">
        Add each prescriber with their NPI and a state license. We check the NPI against the national registry, and invite each provider by email to create their own account.
      </p>
      {msg && <FormAlert>{msg}</FormAlert>}
      {link && <InviteLink link={link.link} email={link.email} subject="Your CompoundIQ provider invite" idPrefix="provider-invite" />}

      {state.providers.length > 0 ? (
        <ul className="space-y-4" aria-label="Providers">
          {state.providers.map(p => <ProviderCard key={p.providerId} provider={p} readOnly={readOnly} onChanged={onChanged} />)}
        </ul>
      ) : (
        <p className="text-sm text-slate-700">No providers yet.</p>
      )}

      {!readOnly && (
        <form onSubmit={add} noValidate className="space-y-4 rounded-lg border border-border p-4">
          <h3 className="text-base font-semibold text-foreground">Add a provider</h3>
          <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
            <legend className="sr-only">New provider</legend>
            <TextField id="np-first" label="First name" autoComplete="off" value={v.firstName} onChange={set('firstName')} error={errors['firstName']} required />
            <TextField id="np-last" label="Last name" autoComplete="off" value={v.lastName} onChange={set('lastName')} error={errors['lastName']} required />
            <div className="sm:col-span-2"><TextField id="np-email" label="Email" type="email" autoComplete="off" value={v.email} onChange={set('email')} error={errors['email']} hint="Their invite goes to this address." required /></div>
            <TextField id="np-npi" label="NPI" inputMode="numeric" value={v.npiNumber} onChange={set('npiNumber')} error={errors['npiNumber']} required />
            <SelectField id="np-state" label="License state" value={v.licenseState} onChange={set('licenseState')} error={errors['licenseState']} required>
              <option value="">Choose a state</option>
              {STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </SelectField>
            <TextField id="np-lic" label="License number" value={v.licenseNumber} onChange={set('licenseNumber')} error={errors['licenseNumber']} required />
            <TextField id="np-exp" label="License expiry date" type="date" value={v.licenseExpiresOn} onChange={set('licenseExpiresOn')} error={errors['licenseExpiresOn']} required />
          </fieldset>
          <button type="submit" className={BUTTON_SECONDARY} disabled={busy}>{busy ? 'Adding…' : 'Add provider and create invite'}</button>
        </form>
      )}

      {!readOnly && <button type="button" className={BUTTON_PRIMARY} onClick={finish} disabled={busy}>Continue</button>}
    </div>
  )
}

function ProviderCard({ provider: p, readOnly, onChanged }: { provider: OnboardingState['providers'][number]; readOnly: boolean; onChanged: () => void }) {
  const [lic, setLic] = useState({ state: '', licenseNumber: '', expiresOn: '' })
  const [msg, setMsg] = useState<string | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const base = `prov-${p.providerId}`

  async function addLicense(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setMsg(null)
    const r = await send(`/api/providers/${p.providerId}/licenses`, 'PUT', lic)
    setBusy(false)
    if (!r.ok) { setMsg((r.data['error'] as string | undefined) ?? 'The license could not be saved.'); return }
    setLic({ state: '', licenseNumber: '', expiresOn: '' })
    onChanged()
  }

  async function invite(action: 'resend' | 'revoke') {
    if (!p.invite) return
    setBusy(true); setMsg(null); setLink(null)
    const r = await send(`/api/onboarding/invites/${p.invite.inviteId}`, 'POST', { action })
    setBusy(false)
    if (!r.ok) { setMsg((r.data['error'] as string | undefined) ?? 'The invite could not be updated.'); return }
    if (typeof r.data['link'] === 'string') setLink(r.data['link'])
    onChanged()
  }

  return (
    <li className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-foreground">{p.firstName} {p.lastName}</h3>
        <span className="text-sm text-slate-700">NPI {p.npiNumber} · {npiLabel(p.npiStatus)}</span>
      </div>
      <p className="mt-1 text-sm text-slate-700">
        Licenses: {p.licenses.length ? p.licenses.map(l => `${l.state} ${l.licenseNumber} (expires ${l.expiresOn})`).join('; ') : 'none yet'}
      </p>
      <p className="mt-1 text-sm text-slate-700">
        Invite: {p.invite ? `${p.invite.email} · ${inviteLabel(p.invite.status)}` : 'none'}
      </p>
      {msg && <div className="mt-3"><FormAlert>{msg}</FormAlert></div>}
      {link && p.invite && <div className="mt-3"><InviteLink link={link} email={p.invite.email} subject="Your CompoundIQ provider invite" idPrefix={`${base}-invite`} /></div>}
      {!readOnly && p.invite && p.invite.status !== 'accepted' && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={BUTTON_SECONDARY} onClick={() => invite('resend')} disabled={busy}>Resend invite to {p.firstName} {p.lastName}</button>
          {p.invite.status === 'pending' && <button type="button" className={BUTTON_DANGER} onClick={() => invite('revoke')} disabled={busy}>Revoke invite for {p.firstName} {p.lastName}</button>}
        </div>
      )}
      {!readOnly && (
        <form onSubmit={addLicense} noValidate className="mt-4 grid gap-3 sm:grid-cols-[8rem_1fr_11rem_auto] sm:items-end">
          <SelectField id={`${base}-state`} label="State" value={lic.state} onChange={e => setLic(prev => ({ ...prev, state: e.target.value }))} disabled={busy}>
            <option value="">State</option>
            {STATES.map(s => <option key={s} value={s}>{s}</option>)}
          </SelectField>
          <TextField id={`${base}-num`} label="License number" value={lic.licenseNumber} onChange={e => setLic(prev => ({ ...prev, licenseNumber: e.target.value }))} disabled={busy} />
          <TextField id={`${base}-exp`} label="Expiry date" type="date" value={lic.expiresOn} onChange={e => setLic(prev => ({ ...prev, expiresOn: e.target.value }))} disabled={busy} />
          <button type="submit" className={BUTTON_SECONDARY} disabled={busy}>Add license for {p.firstName} {p.lastName}</button>
        </form>
      )}
    </li>
  )
}

function npiLabel(status: string | null): string {
  switch (status) {
    case 'verified':   return 'Verified in the NPI registry'
    case 'mismatch':   return 'Name does not match the registry'
    case 'not_found':  return 'Not found in the registry'
    case 'invalid':    return 'Invalid NPI'
    case 'unverified': return 'Registry check pending'
    default:           return 'Not checked yet'
  }
}

function inviteLabel(status: string): string {
  return ({ pending: 'Invite sent', accepted: 'Account created', revoked: 'Invite revoked', expired: 'Invite expired' } as Record<string, string>)[status] ?? status
}

// ── Staff ────────────────────────────────────────────────────

function StaffStep({ state, readOnly, onChanged, onDone }: { state: OnboardingState; readOnly: boolean; onChanged: () => void; onDone: () => void }) {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [msg, setMsg] = useState<string | null>(null)
  const [link, setLink] = useState<{ link: string; email: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function invite(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setMsg(null); setLink(null)
    const r = await send('/api/onboarding/staff', 'POST', { email })
    setBusy(false)
    if (!r.ok) {
      setError((r.data['errors'] as Errors | undefined)?.['email'])
      setMsg((r.data['error'] as string | undefined) ?? 'The invite could not be created.')
      return
    }
    setError(undefined)
    if (typeof r.data['link'] === 'string') setLink({ link: r.data['link'], email: email.trim().toLowerCase() })
    setEmail('')
    onChanged()
  }

  async function action(inviteId: string, act: 'resend' | 'revoke', to: string) {
    setBusy(true); setMsg(null); setLink(null)
    const r = await send(`/api/onboarding/invites/${inviteId}`, 'POST', { action: act })
    setBusy(false)
    if (!r.ok) { setMsg((r.data['error'] as string | undefined) ?? 'The invite could not be updated.'); return }
    if (typeof r.data['link'] === 'string') setLink({ link: r.data['link'], email: to })
    onChanged()
  }

  async function finish() {
    setBusy(true)
    const r = await send('/api/onboarding/steps', 'POST', { step: 'staff' })
    setBusy(false)
    if (!r.ok) { setMsg((r.data['error'] as string | undefined) ?? 'This step could not be completed.'); return }
    onDone()
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-700">Invite medical assistants who prepare orders for providers to sign. This step is optional.</p>
      {msg && <FormAlert>{msg}</FormAlert>}
      {link && <InviteLink link={link.link} email={link.email} subject="Your CompoundIQ invite" idPrefix="staff-invite" />}
      {state.staff.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border" aria-label="Staff invites">
          {state.staff.map(s => (
            <li key={s.inviteId} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <span className="text-sm text-foreground">{s.email} <span className="text-slate-700">· {inviteLabel(s.status)}</span></span>
              {!readOnly && s.status !== 'accepted' && (
                <span className="flex flex-wrap gap-2">
                  <button type="button" className={BUTTON_SECONDARY} onClick={() => action(s.inviteId, 'resend', s.email)} disabled={busy}>Resend invite to {s.email}</button>
                  {s.status === 'pending' && <button type="button" className={BUTTON_DANGER} onClick={() => action(s.inviteId, 'revoke', s.email)} disabled={busy}>Revoke invite for {s.email}</button>}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && (
        <form onSubmit={invite} noValidate className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1"><TextField id="staff-email" label="Medical assistant email" type="email" autoComplete="off" value={email} onChange={e => setEmail(e.target.value)} error={error} disabled={busy} /></div>
          <button type="submit" className={BUTTON_SECONDARY} disabled={busy}>Create invite</button>
        </form>
      )}
      {!readOnly && <button type="button" className={BUTTON_PRIMARY} onClick={finish} disabled={busy}>Continue</button>}
    </div>
  )
}

// ── BAA / terms ──────────────────────────────────────────────

function AgreementStep({ agreement, state, readOnly, onAccepted }: { agreement: AgreementKey; state: OnboardingState; readOnly: boolean; onAccepted: () => void }) {
  const a = AGREEMENTS[agreement]
  const accepted = state.acceptances[agreement]
  const current = accepted?.version === a.version
  const [signerName, setSignerName] = useState('')
  const [signerTitle, setSignerTitle] = useState('')
  const [agree, setAgree] = useState(false)
  const [errors, setErrors] = useState<Errors>({})
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const local: Errors = {}
    if (!signerName.trim()) local['signerName'] = 'Enter your full name.'
    if (!signerTitle.trim()) local['signerTitle'] = 'Enter your title.'
    if (!agree) local['agree'] = 'Confirm that you have read and agree.'
    setErrors(local)
    setMsg(null)
    if (Object.keys(local).length > 0) return
    setBusy(true)
    const r = await send('/api/onboarding/agreements', 'POST', { agreement, version: a.version, signerName: signerName.trim(), signerTitle: signerTitle.trim() })
    setBusy(false)
    if (!r.ok) {
      setErrors((r.data['errors'] as Errors | undefined) ?? {})
      setMsg((r.data['error'] as string | undefined) ?? 'Your acceptance could not be recorded.')
      return
    }
    onAccepted()
  }

  return (
    <div className="space-y-5">
      <FormAlert tone="warning"><strong className="font-semibold">{DRAFT_BANNER}.</strong> This {a.title} is a draft template and will be replaced by the final version.</FormAlert>
      <h3 className="text-base font-semibold text-foreground">{a.title} <span className="font-normal text-slate-700">(version {a.version})</span></h3>
      <div
        tabIndex={0}
        role="region"
        aria-label={`${a.title} text`}
        className="max-h-80 space-y-3 overflow-y-auto rounded-lg border border-slate-500 bg-background p-4 text-sm leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {a.text.split('\n\n').map((para, i) => <p key={i}>{para}</p>)}
      </div>

      {accepted && current ? (
        <FormAlert tone="success">
          Accepted by {accepted.signerName}, {accepted.signerTitle}, on {new Date(accepted.acceptedAt).toLocaleDateString('en-US', { dateStyle: 'long' })}.
        </FormAlert>
      ) : (
        <>
          {accepted && !current && <FormAlert tone="info">This agreement has changed since it was accepted. Please review and accept the current version.</FormAlert>}
          {msg && <FormAlert>{msg}</FormAlert>}
          {!readOnly && (
            <form onSubmit={onSubmit} noValidate className="space-y-4">
              <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
                <legend className="sr-only">Accept the {a.title}</legend>
                <TextField id={`${agreement}-name`} label="Signer name" autoComplete="name" value={signerName} onChange={e => setSignerName(e.target.value)} error={errors['signerName']} required />
                <TextField id={`${agreement}-title`} label="Title" autoComplete="organization-title" value={signerTitle} onChange={e => setSignerTitle(e.target.value)} error={errors['signerTitle']} required />
                <div className="sm:col-span-2 space-y-1">
                  <CheckboxField id={`${agreement}-agree`} label={`I have read the ${a.title} and agree to it on behalf of the practice.`} checked={agree} onChange={e => setAgree(e.target.checked)} aria-invalid={errors['agree'] ? true : undefined} aria-describedby={errors['agree'] ? `${agreement}-agree-error` : undefined} />
                  {errors['agree'] && <p id={`${agreement}-agree-error`} role="alert" className="text-sm text-red-700">{errors['agree']}</p>}
                </div>
              </fieldset>
              <button type="submit" className={BUTTON_PRIMARY} disabled={busy}>{busy ? 'Recording…' : `Accept the ${a.title}`}</button>
            </form>
          )}
        </>
      )}
    </div>
  )
}

// ── Payouts ──────────────────────────────────────────────────

function PayoutsStep({ state, readOnly, onDone }: { state: OnboardingState; readOnly: boolean; onDone: () => void }) {
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function finish() {
    setBusy(true)
    const r = await send('/api/onboarding/steps', 'POST', { step: 'payouts' })
    setBusy(false)
    if (!r.ok) { setMsg((r.data['error'] as string | undefined) ?? 'This step could not be completed.'); return }
    onDone()
  }
  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-700">
        Patient payments are paid out to the clinic through Stripe. You can submit before Stripe finishes verifying the account; orders can be sent once payouts are active.
      </p>
      {msg && <FormAlert>{msg}</FormAlert>}
      <StripeStatusSection stripeConnectStatus={state.clinic.stripeConnectStatus} stripeAccountId={state.clinic.stripeAccountId} isClinicAdmin={!readOnly} />
      {!readOnly && <button type="button" className={BUTTON_PRIMARY} onClick={finish} disabled={busy}>Continue</button>}
    </div>
  )
}

// ── Review ───────────────────────────────────────────────────

function ReviewStep({ state, readOnly, onGo, onSubmitted }: { state: OnboardingState; readOnly: boolean; onGo: (s: StepKey) => void; onSubmitted: () => void }) {
  const check = canSubmit(state.steps)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true); setMsg(null)
    const r = await send('/api/onboarding/submit', 'POST', {})
    setBusy(false)
    if (!r.ok) { setMsg((r.data['error'] as string | undefined) ?? 'Your onboarding could not be submitted.'); return }
    onSubmitted()
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-700">Check each step, then submit. CompoundIQ reviews every new clinic before it can send orders.</p>
      {msg && <FormAlert>{msg}</FormAlert>}
      <dl className="divide-y divide-border rounded-lg border border-border">
        {ONBOARDING_STEPS.filter(s => s !== 'review').map(s => (
          <div key={s} className="flex flex-wrap items-center justify-between gap-2 p-3">
            <dt className="text-sm font-medium text-foreground">{STEP_LABELS[s]}</dt>
            <dd className="flex items-center gap-3 text-sm">
              <span className={state.steps[s] === 'complete' ? 'text-emerald-800' : 'text-slate-700'}>{STATUS_TEXT[state.steps[s]]}</span>
              <button type="button" className="text-sm font-medium text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onGo(s)}>
                Open {STEP_LABELS[s]}
              </button>
            </dd>
          </div>
        ))}
      </dl>
      {!check.ok && (
        <FormAlert tone="info">Still to do before you can submit: {check.missing.map(s => STEP_LABELS[s]).join(', ')}.</FormAlert>
      )}
      {!readOnly && (
        <button type="button" className={BUTTON_PRIMARY} onClick={submit} disabled={busy || !check.ok}>
          {busy ? 'Submitting…' : 'Submit for review'}
        </button>
      )}
    </div>
  )
}
