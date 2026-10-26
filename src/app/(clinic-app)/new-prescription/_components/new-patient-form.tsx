'use client'

// ============================================================
// + New patient (Patient Intake PR 2, face sheet fill PR 4)
// ============================================================
//
// Staff type the patient's mobile number (required) and, if they know
// them, first and last name and state. The patient completes the rest from
// a link on their phone. A likely duplicate asks "Is this the same
// patient?": staff pick the existing patient, or say it is someone new.
// Never merged.
//
// PR 4, "Drop a face sheet": staff drop or choose a PDF, PNG or JPG (up to
// 4 MB) or paste its text; POST /api/patients/face-sheet reads it and the
// values prefill this form, with the other details the sheet gave (date of
// birth, sex, email, address, allergies or NKDA, medications). Each field
// that came from the sheet says so in its label. Nothing is saved until
// staff click Add patient, which saves through POST /api/patients as
// before (same duplicate check, still pending, still the intake link).
// faceSheetAvailable comes from the server (lib/face-sheet/config): when
// false (no API key, or the flag off) the entry point is not rendered.
//
// WCAG 2.1 AA: labelled fields, errors announced and tied to the field
// (aria-invalid + aria-describedby), focus moved to what changed.

import { useEffect, useId, useRef, useState, type DragEvent } from 'react'
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
  /** From the server (lib/face-sheet/config): true only with the flag on and a key set. */
  faceSheetAvailable?: boolean
}

type Field =
  | 'phone' | 'firstName' | 'lastName' | 'state'
  | 'dateOfBirth' | 'sex' | 'email' | 'addressLine1' | 'addressLine2' | 'city' | 'zip' | 'allergies' | 'currentMedications'
const SERVER_FIELDS: readonly Field[] = ['phone', 'firstName', 'lastName', 'state', 'dateOfBirth', 'sex', 'email', 'addressLine1', 'addressLine2', 'city', 'zip', 'allergies', 'currentMedications']

/** What the face sheet read (lib/face-sheet/extract FaceSheetFields). */
interface SheetFields {
  firstName: string | null; lastName: string | null; dateOfBirth: string | null; sex: string | null
  mobile: string | null; email: string | null
  addressLine1: string | null; addressLine2: string | null; city: string | null; state: string | null; zip: string | null
  allergies: string[] | null; nkda: boolean | null; currentMedications: string | null
}

// 4 MB, as lib/face-sheet/config (Vercel refuses bodies over about 4.5 MB).
const MAX_SHEET_BYTES = 4 * 1024 * 1024
const SHEET_TYPES = ['application/pdf', 'image/png', 'image/jpeg']
const SHEET_EXT = /\.(pdf|png|jpe?g)$/i
const TOO_BIG = 'That file is over 4 MB. Choose a smaller file, or paste the text instead.'
const WRONG_TYPE = 'Choose a PDF, PNG or JPG file.'

function formatDob(iso: string | null): string {
  if (!iso) return 'no date of birth yet'
  const [y, m, d] = iso.split('-')
  return y && m && d ? `${m}/${d}/${y}` : iso
}

/** +15125550142 as (512) 555-0142, for staff to read and edit. */
function displayMobile(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164)
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164
}

export function NewPatientForm({ onCreated, onUseExisting, onCancel, faceSheetAvailable = false }: Props) {
  const uid = useId()
  const ids = {
    heading: `${uid}-heading`,
    phone: `${uid}-phone`, phoneHint: `${uid}-phone-hint`, phoneError: `${uid}-phone-error`,
    first: `${uid}-first`, last: `${uid}-last`, state: `${uid}-state`, fieldError: `${uid}-field-error`,
    dupHeading: `${uid}-dup-heading`,
    sheetFile: `${uid}-sheet-file`, sheetHint: `${uid}-sheet-hint`, sheetText: `${uid}-sheet-text`,
    dob: `${uid}-dob`, sex: `${uid}-sex`, email: `${uid}-email`, line1: `${uid}-line1`, line2: `${uid}-line2`, city: `${uid}-city`,
    zip: `${uid}-zip`, allergies: `${uid}-allergies`, allergiesHint: `${uid}-allergies-hint`, nkda: `${uid}-nkda`, meds: `${uid}-meds`,
  }

  const [phone, setPhone] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [state, setState] = useState('')
  // The details a face sheet adds (shown once one has been read).
  const [showDetails, setShowDetails] = useState(false)
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [sex, setSex] = useState('')
  const [email, setEmail] = useState('')
  const [addressLine1, setAddressLine1] = useState('')
  const [addressLine2, setAddressLine2] = useState('')
  const [city, setCity] = useState('')
  const [zip, setZip] = useState('')
  const [allergies, setAllergies] = useState('')
  const [nkda, setNkda] = useState(false)
  const [currentMedications, setCurrentMedications] = useState('')
  const [fromSheet, setFromSheet] = useState<ReadonlySet<string>>(new Set())

  const [busy, setBusy] = useState(false)
  const [fieldError, setFieldError] = useState<{ field: Field; message: string } | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<Candidate[] | null>(null)

  const [reading, setReading] = useState(false)
  const [sheetStatus, setSheetStatus] = useState<string | null>(null)
  const [sheetError, setSheetError] = useState<string | null>(null)
  const [pasting, setPasting] = useState(false)
  const [pasted, setPasted] = useState('')

  const phoneRef = useRef<HTMLInputElement>(null)
  const dupRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => { phoneRef.current?.focus() }, [])
  useEffect(() => { if (candidates) dupRef.current?.focus() }, [candidates])

  function applySheet(f: SheetFields, filled: string[]) {
    if (f.mobile) setPhone(displayMobile(f.mobile))
    if (f.firstName) setFirstName(f.firstName)
    if (f.lastName) setLastName(f.lastName)
    if (f.state) setState(f.state)
    if (f.dateOfBirth) setDateOfBirth(f.dateOfBirth)
    if (f.sex) setSex(f.sex)
    if (f.email) setEmail(f.email)
    if (f.addressLine1) setAddressLine1(f.addressLine1)
    if (f.addressLine2) setAddressLine2(f.addressLine2)
    if (f.city) setCity(f.city)
    if (f.zip) setZip(f.zip)
    if (f.allergies?.length) { setAllergies(f.allergies.join('\n')); setNkda(false) }
    else if (f.nkda) { setNkda(true); setAllergies('') }
    if (f.currentMedications) setCurrentMedications(f.currentMedications)
    setFromSheet(new Set(filled))
    setShowDetails(true)
    setSheetStatus(`Filled ${filled.length} field${filled.length === 1 ? '' : 's'} from the face sheet. Check each one before you add the patient.`)
  }

  async function readSheet(body: FormData | string) {
    setSheetError(null)
    setSheetStatus('Reading the face sheet…')
    setReading(true)
    try {
      const res = await fetch('/api/patients/face-sheet', typeof body === 'string'
        ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }
        : { method: 'POST', body })
      const data = await res.json().catch(() => ({})) as { fields?: SheetFields; filled?: string[]; error?: string }
      if (res.ok && data.fields && Array.isArray(data.filled)) {
        applySheet(data.fields, data.filled)
        return
      }
      setSheetStatus(null)
      setSheetError(data.error ?? 'The face sheet could not be read. Enter the details by hand.')
    } catch {
      setSheetStatus(null)
      setSheetError('The face sheet could not be read. Check your connection, or enter the details by hand.')
    } finally {
      setReading(false)
    }
  }

  function readFile(file: File | null | undefined) {
    if (!file) return
    setSheetStatus(null)
    if (file.size > MAX_SHEET_BYTES) { setSheetError(TOO_BIG); return }
    if (!SHEET_TYPES.includes(file.type) && !SHEET_EXT.test(file.name)) { setSheetError(WRONG_TYPE); return }
    const form = new FormData()
    form.append('file', file)
    void readSheet(form)
  }

  function onDrop(e: DragEvent<HTMLFieldSetElement>) {
    e.preventDefault()
    if (reading) return
    readFile(e.dataTransfer?.files?.[0])
  }

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
      if (showDetails) {
        for (const [key, value] of [
          ['dateOfBirth', dateOfBirth], ['sex', sex], ['email', email], ['addressLine1', addressLine1],
          ['addressLine2', addressLine2], ['city', city], ['zip', zip],
        ] as const) {
          if (value.trim()) payload[key] = value.trim()
        }
        const list = allergies.split(/[\n,;]/).map(a => a.trim()).filter(Boolean)
        if (list.length) payload['allergies'] = list
        payload['nkda'] = nkda
        if (currentMedications.trim()) payload['currentMedications'] = currentMedications.trim()
      }
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
      if (res.status === 400 && body.field && SERVER_FIELDS.includes(body.field as Field)) {
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
    `mt-1 w-full rounded-md border bg-background px-3 py-2 text-base text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring ${errorFor(f) ? 'border-red-700' : 'border-slate-500'}`
  /** "From face sheet" inside the label, so it is read out with the field. */
  const tag = (key: string) => fromSheet.has(key)
    ? <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-900">From face sheet</span>
    : null
  const labelClass = 'block text-sm font-medium text-foreground'
  const buttonSecondary = 'rounded-md border border-slate-500 bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60'
  const textareaClass = 'mt-1 w-full rounded-md border border-slate-500 bg-background px-3 py-2 text-base text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring'

  return (
    <section aria-labelledby={ids.heading} className="mt-3 rounded-md border border-border bg-background p-4">
      <h3 id={ids.heading} className="text-sm font-semibold text-foreground">New patient</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        The patient gets a link to fill in the rest on their phone. You can prescribe now; nothing is signed or charged until they finish.
      </p>

      {faceSheetAvailable && (
        <fieldset
          onDragOver={e => e.preventDefault()}
          onDrop={onDrop}
          aria-describedby={ids.sheetHint}
          className="mt-3 rounded-md border-2 border-dashed border-slate-400 p-3"
        >
          <legend className="px-1 text-sm font-semibold text-foreground">Drop a face sheet</legend>
          <p id={ids.sheetHint} className="text-xs text-muted-foreground">
            Drop it here, choose it, or paste its text: a PDF, PNG or JPG, up to 4 MB. It is read to fill this form and not kept. Check every field before you add the patient.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-md focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
              <label htmlFor={ids.sheetFile} className={`${buttonSecondary} cursor-pointer`}>Choose a face sheet file</label>
              <input
                id={ids.sheetFile}
                type="file"
                accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg"
                disabled={reading || busy}
                className="sr-only"
                onChange={e => { readFile(e.target.files?.[0]); e.target.value = '' }}
              />
            </span>
            <button type="button" className={buttonSecondary} disabled={reading || busy} onClick={() => setPasting(p => !p)} aria-expanded={pasting}>
              Paste text instead
            </button>
          </div>
          {pasting && (
            <div className="mt-3">
              <label htmlFor={ids.sheetText} className={labelClass}>Face sheet text</label>
              <textarea id={ids.sheetText} rows={5} value={pasted} onChange={e => setPasted(e.target.value)} className={textareaClass} />
              <button
                type="button"
                className={`mt-2 ${buttonSecondary}`}
                disabled={reading || busy || !pasted.trim()}
                onClick={() => void readSheet(JSON.stringify({ text: pasted.trim() }))}
              >
                Read the text
              </button>
            </div>
          )}
          <p role="status" className="mt-2 text-sm text-foreground">{sheetStatus ?? ''}</p>
          {sheetError && <p role="alert" className="mt-2 text-sm text-red-700">{sheetError}</p>}
        </fieldset>
      )}

      <form
        noValidate
        className="mt-3 grid gap-3 sm:grid-cols-2"
        onSubmit={e => { e.preventDefault(); void submit(false) }}
      >
        <div className="sm:col-span-2">
          <label htmlFor={ids.phone} className={labelClass}>Mobile number{tag('mobile')}</label>
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
          <label htmlFor={ids.first} className={labelClass}>First name (optional){tag('firstName')}</label>
          <input id={ids.first} type="text" autoComplete="off" value={firstName} onChange={e => setFirstName(e.target.value)}
            aria-invalid={errorFor('firstName') ? true : undefined} aria-describedby={describe('firstName')} className={inputClass('firstName')} />
        </div>
        <div>
          <label htmlFor={ids.last} className={labelClass}>Last name (optional){tag('lastName')}</label>
          <input id={ids.last} type="text" autoComplete="off" value={lastName} onChange={e => setLastName(e.target.value)}
            aria-invalid={errorFor('lastName') ? true : undefined} aria-describedby={describe('lastName')} className={inputClass('lastName')} />
        </div>
        <div>
          <label htmlFor={ids.state} className={labelClass}>State (optional){tag('state')}</label>
          <select id={ids.state} value={state} onChange={e => setState(e.target.value)}
            aria-invalid={errorFor('state') ? true : undefined} aria-describedby={describe('state')} className={inputClass('state')}>
            <option value="">Not known yet</option>
            {US_STATES.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
          </select>
        </div>

        {showDetails && (
          <>
            <div>
              <label htmlFor={ids.dob} className={labelClass}>Date of birth (optional){tag('dateOfBirth')}</label>
              <input id={ids.dob} type="date" value={dateOfBirth} onChange={e => setDateOfBirth(e.target.value)}
                aria-invalid={errorFor('dateOfBirth') ? true : undefined} aria-describedby={describe('dateOfBirth')} className={inputClass('dateOfBirth')} />
            </div>
            <div>
              <label htmlFor={ids.sex} className={labelClass}>Sex (optional){tag('sex')}</label>
              <select id={ids.sex} value={sex} onChange={e => setSex(e.target.value)}
                aria-invalid={errorFor('sex') ? true : undefined} aria-describedby={describe('sex')} className={inputClass('sex')}>
                <option value="">Not known yet</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
                <option value="unknown">Unknown</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label htmlFor={ids.email} className={labelClass}>Email (optional){tag('email')}</label>
              <input id={ids.email} type="email" autoComplete="off" value={email} onChange={e => setEmail(e.target.value)}
                aria-invalid={errorFor('email') ? true : undefined} aria-describedby={describe('email')} className={inputClass('email')} />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor={ids.line1} className={labelClass}>Address line 1 (optional){tag('addressLine1')}</label>
              <input id={ids.line1} type="text" autoComplete="off" value={addressLine1} onChange={e => setAddressLine1(e.target.value)}
                aria-invalid={errorFor('addressLine1') ? true : undefined} aria-describedby={describe('addressLine1')} className={inputClass('addressLine1')} />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor={ids.line2} className={labelClass}>Address line 2 (optional){tag('addressLine2')}</label>
              <input id={ids.line2} type="text" autoComplete="off" value={addressLine2} onChange={e => setAddressLine2(e.target.value)}
                aria-invalid={errorFor('addressLine2') ? true : undefined} aria-describedby={describe('addressLine2')} className={inputClass('addressLine2')} />
            </div>
            <div>
              <label htmlFor={ids.city} className={labelClass}>City (optional){tag('city')}</label>
              <input id={ids.city} type="text" autoComplete="off" value={city} onChange={e => setCity(e.target.value)}
                aria-invalid={errorFor('city') ? true : undefined} aria-describedby={describe('city')} className={inputClass('city')} />
            </div>
            <div>
              <label htmlFor={ids.zip} className={labelClass}>ZIP code (optional){tag('zip')}</label>
              <input id={ids.zip} type="text" inputMode="numeric" autoComplete="off" value={zip} onChange={e => setZip(e.target.value)}
                aria-invalid={errorFor('zip') ? true : undefined} aria-describedby={describe('zip')} className={inputClass('zip')} />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor={ids.allergies} className={labelClass}>Drug allergies (optional){tag('allergies')}</label>
              <p id={ids.allergiesHint} className="text-xs text-muted-foreground">One per line.</p>
              <textarea id={ids.allergies} rows={3} value={allergies} disabled={nkda} onChange={e => setAllergies(e.target.value)}
                aria-invalid={errorFor('allergies') ? true : undefined} aria-describedby={describe('allergies', ids.allergiesHint)} className={inputClass('allergies')} />
              <div className="mt-2 flex items-center gap-2">
                <input id={ids.nkda} type="checkbox" checked={nkda} onChange={e => { setNkda(e.target.checked); if (e.target.checked) setAllergies('') }}
                  className="h-5 w-5 rounded border-slate-500 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring" />
                <label htmlFor={ids.nkda} className="text-sm text-foreground">No known drug allergies{tag('nkda')}</label>
              </div>
            </div>
            <div className="sm:col-span-2">
              <label htmlFor={ids.meds} className={labelClass}>Current medications (optional){tag('currentMedications')}</label>
              <textarea id={ids.meds} rows={3} value={currentMedications} onChange={e => setCurrentMedications(e.target.value)}
                aria-invalid={errorFor('currentMedications') ? true : undefined} aria-describedby={describe('currentMedications')} className={inputClass('currentMedications')} />
            </div>
          </>
        )}

        {fieldError && fieldError.field !== 'phone' && (
          <p id={ids.fieldError} className="text-xs font-medium text-red-700 sm:col-span-2">{fieldError.message}</p>
        )}
        {formError && <p role="alert" className="text-sm text-red-700 sm:col-span-2">{formError}</p>}
        <div className="flex gap-2 sm:col-span-2">
          <button
            type="submit"
            disabled={busy || reading}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary-hover focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? 'Adding…' : 'Add patient'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-slate-500 px-4 py-2 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Cancel
          </button>
        </div>
        {fieldError?.field === 'phone' && <span className="sr-only" role="alert">{fieldError.message}</span>}
      </form>

      {candidates && (
        <section aria-labelledby={ids.dupHeading} className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3">
          <h4 id={ids.dupHeading} ref={dupRef} tabIndex={-1} className="text-sm font-semibold text-amber-950 focus-visible:outline-hidden">
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
                  className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary-hover focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
            className="mt-3 rounded-md border border-slate-500 bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60"
          >
            No, add a new patient
          </button>
        </section>
      )}
    </section>
  )
}
