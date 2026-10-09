'use client'

// ============================================================
// + New patient (Patient Intake PR 2)
// ============================================================
//
// Staff type the patient's mobile number (required) and, if they know
// them, first and last name and state. The patient completes the rest from
// a link on their phone. A likely duplicate asks "Is this the same
// patient?": staff pick the existing patient, or say it is someone new.
// Never merged.
//
// WCAG 2.1 AA: labelled fields, errors announced and tied to the field
// (aria-invalid + aria-describedby), focus moved to what changed.

import { useEffect, useId, useRef, useState } from 'react'
import { US_STATES } from '@/lib/geo/us-states'

export interface CreatedPatient {
  patient_id: string
  first_name: string | null
  last_name: string | null
  date_of_birth: string | null
  phone: string
  state: string | null
  sms_opt_in: boolean
  allergies: string[] | null
  nkda: boolean
  allergies_updated_at: string | null
  intake_status: string
}

export interface CreatedIntake {
  url: string
  expiresAt: string
  smsStatus: string
}

interface Candidate {
  patientId: string
  name: string
  dateOfBirth: string | null
  mobileLast4: string | null
  intakeStatus: 'pending' | 'complete'
  matchedOn: Array<'mobile' | 'name'>
}

interface Props {
  onCreated: (patient: CreatedPatient, intake: CreatedIntake | null) => void
  onUseExisting: (patientId: string) => void
  onCancel: () => void
}

type Field = 'phone' | 'firstName' | 'lastName' | 'state'

function formatDob(iso: string | null): string {
  if (!iso) return 'no date of birth yet'
  const [y, m, d] = iso.split('-')
  return y && m && d ? `${m}/${d}/${y}` : iso
}

export function NewPatientForm({ onCreated, onUseExisting, onCancel }: Props) {
  const uid = useId()
  const ids = {
    heading: `${uid}-heading`,
    phone: `${uid}-phone`, phoneHint: `${uid}-phone-hint`, phoneError: `${uid}-phone-error`,
    first: `${uid}-first`, last: `${uid}-last`, state: `${uid}-state`, fieldError: `${uid}-field-error`,
    dupHeading: `${uid}-dup-heading`,
  }

  const [phone, setPhone] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [state, setState] = useState('')
  const [busy, setBusy] = useState(false)
  const [fieldError, setFieldError] = useState<{ field: Field; message: string } | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<Candidate[] | null>(null)

  const phoneRef = useRef<HTMLInputElement>(null)
  const dupRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => { phoneRef.current?.focus() }, [])
  useEffect(() => { if (candidates) dupRef.current?.focus() }, [candidates])

  async function submit(confirmNew: boolean) {
    setFieldError(null)
    setFormError(null)
    if (!phone.trim()) {
      setFieldError({ field: 'phone', message: "Enter the patient's mobile number." })
      phoneRef.current?.focus()
      return
    }
    setBusy(true)
    try {
      const payload: Record<string, unknown> = { phone: phone.trim() }
      if (firstName.trim()) payload['firstName'] = firstName.trim()
      if (lastName.trim()) payload['lastName'] = lastName.trim()
      if (state) payload['state'] = state
      if (confirmNew) payload['confirmNew'] = true
      const res = await fetch('/api/patients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => ({})) as {
        patient?: CreatedPatient; intake?: CreatedIntake | null; code?: string; field?: string; error?: string; candidates?: Candidate[]
      }
      if (res.status === 201 && body.patient) {
        setCandidates(null)
        onCreated(body.patient, body.intake ?? null)
        return
      }
      if (res.status === 409 && body.code === 'POSSIBLE_DUPLICATE' && body.candidates?.length) {
        setCandidates(body.candidates)
        return
      }
      if (body.code === 'NOT_MOBILE') {
        setFieldError({ field: 'phone', message: 'This is a landline or internet phone number, which cannot receive texts. Enter a mobile number.' })
        phoneRef.current?.focus()
        return
      }
      if (res.status === 400 && body.field && ['phone', 'firstName', 'lastName', 'state'].includes(body.field)) {
        setFieldError({ field: body.field as Field, message: body.error ?? 'Check this field.' })
        return
      }
      setFormError(body.error ?? 'The patient could not be added. Try again.')
    } catch {
      setFormError('The patient could not be added. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  const errorFor = (f: Field) => (fieldError?.field === f ? fieldError.message : null)
  const describe = (f: Field, base?: string) =>
    [base, errorFor(f) ? (f === 'phone' ? ids.phoneError : ids.fieldError) : null].filter(Boolean).join(' ') || undefined
  const inputClass = (f: Field) =>
    `mt-1 w-full rounded-md border bg-background px-3 py-2 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${errorFor(f) ? 'border-red-700' : 'border-slate-500'}`

  return (
    <section aria-labelledby={ids.heading} className="mt-3 rounded-md border border-border bg-background p-4">
      <h3 id={ids.heading} className="text-sm font-semibold text-foreground">New patient</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        The patient gets a link to fill in the rest on their phone. You can prescribe now; nothing is signed or charged until they finish.
      </p>

      <form
        noValidate
        className="mt-3 grid gap-3 sm:grid-cols-2"
        onSubmit={e => { e.preventDefault(); void submit(false) }}
      >
        <div className="sm:col-span-2">
          <label htmlFor={ids.phone} className="block text-sm font-medium text-foreground">Mobile number</label>
          <p id={ids.phoneHint} className="text-xs text-muted-foreground">A mobile that can receive texts, with area code.</p>
          <input
            ref={phoneRef}
            id={ids.phone}
            type="tel"
            inputMode="tel"
            autoComplete="off"
            required
            value={phone}
            onChange={e => setPhone(e.target.value)}
            aria-invalid={errorFor('phone') ? true : undefined}
            aria-describedby={describe('phone', ids.phoneHint)}
            className={inputClass('phone')}
          />
          {errorFor('phone') && <p id={ids.phoneError} className="mt-1 text-xs font-medium text-red-700">{errorFor('phone')}</p>}
        </div>
        <div>
          <label htmlFor={ids.first} className="block text-sm font-medium text-foreground">First name (optional)</label>
          <input id={ids.first} type="text" autoComplete="off" value={firstName} onChange={e => setFirstName(e.target.value)}
            aria-invalid={errorFor('firstName') ? true : undefined} aria-describedby={describe('firstName')} className={inputClass('firstName')} />
        </div>
        <div>
          <label htmlFor={ids.last} className="block text-sm font-medium text-foreground">Last name (optional)</label>
          <input id={ids.last} type="text" autoComplete="off" value={lastName} onChange={e => setLastName(e.target.value)}
            aria-invalid={errorFor('lastName') ? true : undefined} aria-describedby={describe('lastName')} className={inputClass('lastName')} />
        </div>
        <div>
          <label htmlFor={ids.state} className="block text-sm font-medium text-foreground">State (optional)</label>
          <select id={ids.state} value={state} onChange={e => setState(e.target.value)}
            aria-invalid={errorFor('state') ? true : undefined} aria-describedby={describe('state')} className={inputClass('state')}>
            <option value="">Not known yet</option>
            {US_STATES.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
          </select>
        </div>
        {fieldError && fieldError.field !== 'phone' && (
          <p id={ids.fieldError} className="text-xs font-medium text-red-700 sm:col-span-2">{fieldError.message}</p>
        )}
        {formError && <p role="alert" className="text-sm text-red-700 sm:col-span-2">{formError}</p>}
        <div className="flex gap-2 sm:col-span-2">
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? 'Adding…' : 'Add patient'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-slate-500 px-4 py-2 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Cancel
          </button>
        </div>
        {fieldError?.field === 'phone' && <span className="sr-only" role="alert">{fieldError.message}</span>}
      </form>

      {candidates && (
        <section aria-labelledby={ids.dupHeading} className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3">
          <h4 id={ids.dupHeading} ref={dupRef} tabIndex={-1} className="text-sm font-semibold text-amber-950 focus-visible:outline-none">
            Is this the same patient?
          </h4>
          <p className="mt-1 text-xs text-amber-950">A patient in this clinic may be the same person. Patients are never merged: pick one, or add a new patient.</p>
          <ul className="mt-2 space-y-2">
            {candidates.map(c => (
              <li key={c.patientId} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-background px-3 py-2">
                <span className="text-sm text-foreground">
                  <span className="font-medium">{c.name}</span>
                  {', '}{formatDob(c.dateOfBirth)}
                  {c.mobileLast4 && <>, mobile ending {c.mobileLast4}</>}
                  {' '}({c.matchedOn.map(m => (m === 'mobile' ? 'same mobile' : 'same name')).join(', ')})
                </span>
                <button
                  type="button"
                  onClick={() => onUseExisting(c.patientId)}
                  className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  Use {c.name}
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit(true)}
            className="mt-3 rounded-md border border-slate-500 bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60"
          >
            No, add a new patient
          </button>
        </section>
      )}
    </section>
  )
}
