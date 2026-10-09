'use client'

// ============================================================
// Patient intake flow (Patient Intake PR 2)
// ============================================================
//
// On the patient's phone, from the link their clinic sent:
//   1. Consent: privacy notice (required); texts (optional, exact wording,
//      versioned); what the license scan does and keeps.
//   2. Your details: scan the license barcode (in the browser, nothing
//      uploaded) or type them. New Hampshire licenses: typed only.
//   3. Shipping address: filled from the scan; confirm or edit.
//   4. Allergies (or no known drug allergies) and current medications.
//   5. Check and submit; then straight into payment when an order waits.
//
// Mobile first and WCAG 2.1 AA: one h1; each step's h2 takes focus; 16px
// inputs (no iOS zoom), 44px targets; errors announced (an alert summary)
// and tied to each field (aria-invalid + aria-describedby). Nothing the
// patient types is logged.

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { parseAamva, isNewHampshire } from '@/lib/intake/aamva'
import { ID_SCAN_PURPOSE, SMS_CONSENT_TEXT } from '@/lib/intake/consent'
import { normalizeAllergies } from '@/lib/patients/allergies'
import { US_STATES } from '@/lib/geo/us-states'
import { navigateTo } from '@/lib/browser/navigate'
import { LicenseScanner } from './license-scanner'

type Step = 'consent' | 'details' | 'address' | 'health' | 'review' | 'done'
type Sex = 'female' | 'male' | 'unknown' | ''

interface Answers {
  privacyNotice: boolean
  sms: boolean
  licenseState: string
  firstName: string
  lastName: string
  dateOfBirth: string
  sex: Sex
  line1: string
  line2: string
  city: string
  state: string
  zip: string
  allergyChoice: 'nkda' | 'allergies' | ''
  allergies: string
  currentMedications: string
}

const EMPTY: Answers = {
  privacyNotice: false, sms: false, licenseState: '',
  firstName: '', lastName: '', dateOfBirth: '', sex: '',
  line1: '', line2: '', city: '', state: '', zip: '',
  allergyChoice: '', allergies: '', currentMedications: '',
}

type Errors = Partial<Record<keyof Answers, string>>

const STEP_TITLES: Record<Step, string> = {
  consent: 'Before you start',
  details: 'Your details',
  address: 'Shipping address',
  health: 'Allergies and medications',
  review: 'Check and submit',
  done: 'Thank you',
}
const NUMBERED: Step[] = ['consent', 'details', 'address', 'health', 'review']

function realPastDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const [y, m, d] = v.split('-').map(Number) as [number, number, number]
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d && y >= 1900 && dt.getTime() <= Date.now()
}

function validate(step: Step, a: Answers): Errors {
  const e: Errors = {}
  if (step === 'consent' && !a.privacyNotice) e.privacyNotice = 'Please confirm you have read the privacy notice.'
  if (step === 'details') {
    if (!a.firstName.trim()) e.firstName = 'Enter your first name.'
    if (!a.lastName.trim()) e.lastName = 'Enter your last name.'
    if (!realPastDate(a.dateOfBirth)) e.dateOfBirth = 'Enter your date of birth.'
    if (!a.sex) e.sex = 'Choose one.'
  }
  if (step === 'address') {
    if (!a.line1.trim()) e.line1 = 'Enter your street address.'
    if (!a.city.trim()) e.city = 'Enter your city.'
    if (!/^[A-Z]{2}$/.test(a.state)) e.state = 'Choose your state.'
    if (!/^\d{5}(-\d{4})?$/.test(a.zip.trim())) e.zip = 'Enter a 5-digit ZIP code.'
  }
  if (step === 'health') {
    if (!a.allergyChoice) e.allergyChoice = 'Choose one.'
    if (a.allergyChoice === 'allergies' && normalizeAllergies(a.allergies).length === 0) e.allergies = 'List your allergies, one per line.'
  }
  return e
}

const input = (invalid: boolean) =>
  `mt-1 block w-full min-h-[44px] rounded-lg border bg-background px-3 py-2 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${invalid ? 'border-red-700' : 'border-slate-500'}`
const primaryButton =
  'min-h-[48px] w-full rounded-lg bg-primary px-4 py-3 text-base font-semibold text-primary-foreground hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60'
const secondaryButton =
  'min-h-[44px] w-full rounded-lg border border-slate-500 px-4 py-2 text-base font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'

export function IntakeFlow({ token, clinicName }: { token: string; clinicName: string }) {
  const uid = useId()
  const id = (k: string) => `${uid}-${k}`
  const [step, setStep] = useState<Step>('consent')
  const [a, setA] = useState<Answers>(EMPTY)
  const [errors, setErrors] = useState<Errors>({})
  const [detailsMode, setDetailsMode] = useState<'choose' | 'scan' | 'form'>('choose')
  const [scanMessage, setScanMessage] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const firstStep = useRef(true)

  // Focus the new step's heading (not on first load).
  useEffect(() => {
    if (firstStep.current) { firstStep.current = false; return }
    headingRef.current?.focus()
  }, [step])

  const set = <K extends keyof Answers>(k: K, v: Answers[K]) => {
    setA(prev => ({ ...prev, [k]: v }))
    if (errors[k]) setErrors(prev => ({ ...prev, [k]: undefined }))
  }

  const next = (to: Step) => {
    const e = validate(step, a)
    if (Object.values(e).some(Boolean)) { setErrors(e); return }
    setErrors({})
    setStep(to)
  }
  const back = (to: Step) => { setErrors({}); setSubmitError(null); setStep(to) }

  const onScanned = useCallback((text: string) => {
    const license = parseAamva(text)
    setDetailsMode('form')
    if (!license) {
      setScanMessage('We could not read that barcode as a driver’s license. Please type your details below.')
      return
    }
    if (isNewHampshire(license)) {
      setScanMessage('New Hampshire licenses cannot be scanned. Please type your details below.')
      return
    }
    setScanMessage(null)
    setA(prev => ({
      ...prev,
      firstName: license.firstName, lastName: license.lastName, dateOfBirth: license.dateOfBirth, sex: license.sex,
      line1: license.addressLine1, line2: license.addressLine2, city: license.city,
      state: US_STATES.some(s => s.code === license.state) ? license.state : prev.state,
      zip: license.zip.slice(0, 10),
    }))
  }, [])

  async function submit() {
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await fetch(`/api/intake/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          consent: { privacyNotice: a.privacyNotice, sms: a.sms },
          details: { firstName: a.firstName.trim(), lastName: a.lastName.trim(), dateOfBirth: a.dateOfBirth, sex: a.sex },
          address: { line1: a.line1.trim(), line2: a.line2.trim(), city: a.city.trim(), state: a.state, zip: a.zip.trim() },
          health: {
            nkda: a.allergyChoice === 'nkda',
            allergies: a.allergyChoice === 'allergies' ? normalizeAllergies(a.allergies) : [],
            currentMedications: a.currentMedications.trim(),
          },
        }),
      })
      const body = await res.json().catch(() => ({})) as { checkoutUrl?: string | null; error?: string }
      if (res.ok) {
        setCheckoutUrl(body.checkoutUrl ?? null)
        setStep('done')
        if (body.checkoutUrl) navigateTo(body.checkoutUrl)
        return
      }
      setSubmitError(
        res.status === 410 || res.status === 404
          ? 'This link has expired or was already used. Please ask your clinic to send you a new one.'
          : res.status === 400
          ? (body.error ?? 'Please check your answers.')
          : 'Your details could not be saved. Please try again.',
      )
    } catch {
      setSubmitError('Your details could not be saved. Check your connection and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const errorSummary = Object.values(errors).some(Boolean) && (
    <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      Please check the highlighted {Object.values(errors).filter(Boolean).length === 1 ? 'answer' : 'answers'}.
    </p>
  )
  const err = (k: keyof Answers) => errors[k]
  const desc = (k: keyof Answers, ...more: string[]) => [...more, err(k) ? id(`${k}-error`) : ''].filter(Boolean).join(' ') || undefined
  const fieldError = (k: keyof Answers) =>
    err(k) ? <p id={id(`${k}-error`)} className="mt-1 text-sm font-medium text-red-700">{err(k)}</p> : null

  const stepNumber = NUMBERED.indexOf(step)

  return (
    <main className="mx-auto min-h-screen max-w-md px-4 pb-12 pt-6">
      <h1 className="text-2xl font-semibold text-foreground">Complete your details</h1>
      <p className="mt-1 text-sm text-muted-foreground">{clinicName} asked you to complete your details. It takes about 3 minutes.</p>
      {stepNumber >= 0 && <p className="mt-3 text-sm text-muted-foreground">Step {stepNumber + 1} of {NUMBERED.length}</p>}

      <section aria-labelledby={id('step')} className="mt-2 space-y-4">
        <h2 id={id('step')} ref={headingRef} tabIndex={-1} className="text-xl font-semibold text-foreground focus-visible:outline-none">
          {STEP_TITLES[step]}
        </h2>

        {step === 'consent' && (
          <form noValidate className="space-y-4" onSubmit={e => { e.preventDefault(); next('details') }}>
            {errorSummary}
            <div className="rounded-lg border border-border p-3 text-sm text-foreground">
              <h3 className="font-semibold">Privacy notice</h3>
              <p className="mt-1">
                Your clinic and CompoundIQ use the details you give here to fill and ship your prescription and to take payment.
                They are protected health information under HIPAA: they are shared only with the pharmacy that fills your
                prescription and the services needed to do so, and never sold. You can ask your clinic for a copy of their
                full Notice of Privacy Practices.
              </p>
            </div>
            <div>
              <div className="flex items-start gap-3">
                <input
                  id={id('privacy')}
                  type="checkbox"
                  checked={a.privacyNotice}
                  onChange={e => set('privacyNotice', e.target.checked)}
                  aria-invalid={err('privacyNotice') ? true : undefined}
                  aria-describedby={desc('privacyNotice')}
                  className="mt-1 h-5 w-5 shrink-0 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                />
                <label htmlFor={id('privacy')} className="text-base text-foreground">I have read the privacy notice.</label>
              </div>
              {fieldError('privacyNotice')}
            </div>
            <div className="flex items-start gap-3">
              <input
                id={id('sms')}
                type="checkbox"
                checked={a.sms}
                onChange={e => set('sms', e.target.checked)}
                className="mt-1 h-5 w-5 shrink-0 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
              <label htmlFor={id('sms')} className="text-base text-foreground">{SMS_CONSENT_TEXT}</label>
            </div>
            <p className="text-sm text-muted-foreground">Texts are optional. If you leave this unticked, your clinic will reach you another way.</p>
            <div className="rounded-lg border border-border p-3 text-sm text-foreground">
              <h3 className="font-semibold">About scanning your license</h3>
              <p className="mt-1">{ID_SCAN_PURPOSE}</p>
            </div>
            <button type="submit" className={primaryButton}>Continue</button>
          </form>
        )}

        {step === 'details' && (
          <form noValidate className="space-y-4" onSubmit={e => { e.preventDefault(); next('address') }}>
            {errorSummary}
            {scanMessage && <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">{scanMessage}</p>}

            {detailsMode === 'choose' && (
              <div className="space-y-3">
                <div>
                  <label htmlFor={id('licenseState')} className="block text-base font-medium text-foreground">State that issued your license</label>
                  <select id={id('licenseState')} value={a.licenseState} onChange={e => set('licenseState', e.target.value)} className={input(false)}>
                    <option value="">Choose a state</option>
                    {US_STATES.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
                  </select>
                </div>
                {a.licenseState === 'NH' ? (
                  <p className="text-sm text-foreground">New Hampshire licenses cannot be scanned. Please type your details.</p>
                ) : (
                  <button type="button" onClick={() => { setScanMessage(null); setDetailsMode('scan') }} className={primaryButton}>Scan my license</button>
                )}
                <button type="button" onClick={() => setDetailsMode('form')} className={secondaryButton}>Type my details</button>
              </div>
            )}

            {detailsMode === 'scan' && (
              <LicenseScanner onScanned={onScanned} onCancel={() => setDetailsMode('form')} />
            )}

            {detailsMode === 'form' && (
              <>
                <div>
                  <label htmlFor={id('first')} className="block text-base font-medium text-foreground">First name</label>
                  <input id={id('first')} type="text" autoComplete="given-name" value={a.firstName} onChange={e => set('firstName', e.target.value)}
                    aria-invalid={err('firstName') ? true : undefined} aria-describedby={desc('firstName')} className={input(!!err('firstName'))} />
                  {fieldError('firstName')}
                </div>
                <div>
                  <label htmlFor={id('last')} className="block text-base font-medium text-foreground">Last name</label>
                  <input id={id('last')} type="text" autoComplete="family-name" value={a.lastName} onChange={e => set('lastName', e.target.value)}
                    aria-invalid={err('lastName') ? true : undefined} aria-describedby={desc('lastName')} className={input(!!err('lastName'))} />
                  {fieldError('lastName')}
                </div>
                <div>
                  <label htmlFor={id('dob')} className="block text-base font-medium text-foreground">Date of birth</label>
                  <input id={id('dob')} type="date" autoComplete="bday" value={a.dateOfBirth} onChange={e => set('dateOfBirth', e.target.value)}
                    aria-invalid={err('dateOfBirth') ? true : undefined} aria-describedby={desc('dateOfBirth')} className={input(!!err('dateOfBirth'))} />
                  {fieldError('dateOfBirth')}
                </div>
                <div role="radiogroup" aria-labelledby={id('sex-label')} aria-describedby={desc('sex')} aria-invalid={err('sex') ? true : undefined}>
                  <p id={id('sex-label')} className="text-base font-medium text-foreground">Sex</p>
                  <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {([['female', 'Female'], ['male', 'Male'], ['unknown', 'Prefer not to say']] as const).map(([value, label]) => (
                      <label key={value} className="flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-500 px-3 text-base text-foreground">
                        <input type="radio" name={id('sex')} value={value} checked={a.sex === value} onChange={() => set('sex', value)}
                          className="h-5 w-5 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                        {label}
                      </label>
                    ))}
                  </div>
                  {fieldError('sex')}
                </div>
              </>
            )}

            {detailsMode !== 'choose' && detailsMode !== 'scan' && <button type="submit" className={primaryButton}>Continue</button>}
            <button type="button" onClick={() => back('consent')} className={secondaryButton}>Back</button>
          </form>
        )}

        {step === 'address' && (
          <form noValidate className="space-y-4" onSubmit={e => { e.preventDefault(); next('health') }}>
            {errorSummary}
            <p className="text-sm text-muted-foreground">Where should your prescription be shipped? Check it, and change anything that is wrong.</p>
            <div>
              <label htmlFor={id('line1')} className="block text-base font-medium text-foreground">Street address</label>
              <input id={id('line1')} type="text" autoComplete="address-line1" value={a.line1} onChange={e => set('line1', e.target.value)}
                aria-invalid={err('line1') ? true : undefined} aria-describedby={desc('line1')} className={input(!!err('line1'))} />
              {fieldError('line1')}
            </div>
            <div>
              <label htmlFor={id('line2')} className="block text-base font-medium text-foreground">Apartment, suite or unit (optional)</label>
              <input id={id('line2')} type="text" autoComplete="address-line2" value={a.line2} onChange={e => set('line2', e.target.value)} className={input(false)} />
            </div>
            <div>
              <label htmlFor={id('city')} className="block text-base font-medium text-foreground">City</label>
              <input id={id('city')} type="text" autoComplete="address-level2" value={a.city} onChange={e => set('city', e.target.value)}
                aria-invalid={err('city') ? true : undefined} aria-describedby={desc('city')} className={input(!!err('city'))} />
              {fieldError('city')}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor={id('state')} className="block text-base font-medium text-foreground">State</label>
                <select id={id('state')} autoComplete="address-level1" value={a.state} onChange={e => set('state', e.target.value)}
                  aria-invalid={err('state') ? true : undefined} aria-describedby={desc('state')} className={input(!!err('state'))}>
                  <option value="">Choose</option>
                  {US_STATES.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
                </select>
                {fieldError('state')}
              </div>
              <div>
                <label htmlFor={id('zip')} className="block text-base font-medium text-foreground">ZIP code</label>
                <input id={id('zip')} type="text" inputMode="numeric" autoComplete="postal-code" value={a.zip} onChange={e => set('zip', e.target.value)}
                  aria-invalid={err('zip') ? true : undefined} aria-describedby={desc('zip')} className={input(!!err('zip'))} />
                {fieldError('zip')}
              </div>
            </div>
            <button type="submit" className={primaryButton}>Continue</button>
            <button type="button" onClick={() => back('details')} className={secondaryButton}>Back</button>
          </form>
        )}

        {step === 'health' && (
          <form noValidate className="space-y-4" onSubmit={e => { e.preventDefault(); next('review') }}>
            {errorSummary}
            <div role="radiogroup" aria-labelledby={id('allergy-label')} aria-describedby={desc('allergyChoice')} aria-invalid={err('allergyChoice') ? true : undefined}>
              <p id={id('allergy-label')} className="text-base font-medium text-foreground">Do you have any drug allergies?</p>
              <div className="mt-1 space-y-2">
                {([['nkda', 'No known drug allergies'], ['allergies', 'I have allergies']] as const).map(([value, label]) => (
                  <label key={value} className="flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-500 px-3 text-base text-foreground">
                    <input type="radio" name={id('allergyChoice')} value={value} checked={a.allergyChoice === value} onChange={() => set('allergyChoice', value)}
                      className="h-5 w-5 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                    {label}
                  </label>
                ))}
              </div>
              {fieldError('allergyChoice')}
            </div>
            {a.allergyChoice === 'allergies' && (
              <div>
                <label htmlFor={id('allergies')} className="block text-base font-medium text-foreground">Your allergies, one per line</label>
                <textarea id={id('allergies')} rows={3} value={a.allergies} onChange={e => set('allergies', e.target.value)}
                  aria-invalid={err('allergies') ? true : undefined} aria-describedby={desc('allergies')} className={input(!!err('allergies'))} />
                {fieldError('allergies')}
              </div>
            )}
            <div>
              <label htmlFor={id('meds')} className="block text-base font-medium text-foreground">Current medications (optional)</label>
              <p id={id('meds-hint')} className="text-sm text-muted-foreground">Prescriptions, supplements and anything else you take regularly.</p>
              <textarea id={id('meds')} rows={3} value={a.currentMedications} onChange={e => set('currentMedications', e.target.value)}
                aria-describedby={id('meds-hint')} className={input(false)} />
            </div>
            <button type="submit" className={primaryButton}>Continue</button>
            <button type="button" onClick={() => back('address')} className={secondaryButton}>Back</button>
          </form>
        )}

        {step === 'review' && (
          <div className="space-y-4">
            <dl className="space-y-3 rounded-lg border border-border p-3 text-base">
              <div><dt className="text-sm text-muted-foreground">Name</dt><dd className="text-foreground">{a.firstName} {a.lastName}</dd></div>
              <div><dt className="text-sm text-muted-foreground">Date of birth</dt><dd className="text-foreground">{a.dateOfBirth}</dd></div>
              <div>
                <dt className="text-sm text-muted-foreground">Shipping address</dt>
                <dd className="text-foreground">{a.line1}{a.line2 ? `, ${a.line2}` : ''}, {a.city}, {a.state} {a.zip}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">Allergies</dt>
                <dd className="text-foreground">{a.allergyChoice === 'nkda' ? 'No known drug allergies' : normalizeAllergies(a.allergies).join(', ')}</dd>
              </div>
              <div><dt className="text-sm text-muted-foreground">Texts</dt><dd className="text-foreground">{a.sms ? 'Yes' : 'No'}</dd></div>
            </dl>
            {submitError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{submitError}</p>}
            <button type="button" onClick={() => void submit()} disabled={submitting} className={primaryButton}>
              {submitting ? 'Sending…' : 'Submit'}
            </button>
            <button type="button" onClick={() => back('health')} className={secondaryButton}>Back</button>
          </div>
        )}

        {step === 'done' && (
          <div className="space-y-4">
            <p className="text-base text-foreground">Your details were sent to {clinicName}.</p>
            {checkoutUrl ? (
              <a href={checkoutUrl} className={`${primaryButton} block text-center`}>Continue to payment</a>
            ) : (
              <p className="text-base text-muted-foreground">Your clinic will send you a link to pay once your prescription is ready.</p>
            )}
          </div>
        )}
      </section>
    </main>
  )
}
