// ============================================================
// Keragon inbound patient event: the JSON contract
// ============================================================
//
// What a clinic's EHR sends (through Keragon) to
// POST /api/integrations/keragon/patients. Documented in
// docs/integrations/keragon.md; samples in ./__fixtures__.
//
// {
//   "event_id":    "evt_...",            required, 1-128 of [A-Za-z0-9._:-], unique per connection
//   "event_type":  "patient.upsert",     required
//   "occurred_at": "2026-10-12T15:00:00Z" optional, ISO 8601
//   "patient": {
//     "external_patient_id": "EHR-123",  required, the patient's id in the EHR
//     "first_name", "last_name":          required
//     "date_of_birth": "YYYY-MM-DD",      required, a real past date
//     "sex": "female" | "male" | "unknown"            optional
//     "mobile": "+15125550147" or a US 10-digit number   one of mobile or email is required to create a patient
//     "email": "..."                                     (see above)
//     "address": { "line1", "line2", "city", "state" (2 letters), "zip" } optional
//     "allergies": ["..."]                             optional (replaces the list)
//     "no_known_drug_allergies": true | false          optional
//   }
// }
//
// A field that is absent or null is left as it is on the patient (sync
// never clears a field). Unknown fields are ignored. Nothing in the
// contract sets SMS consent.

import { toE164 } from '@/lib/patients/phone'
import { normalizeAllergies, MAX_ALLERGY_ENTRIES } from '@/lib/patients/allergies'

export const EVENT_TYPES = ['patient.upsert'] as const
export type KeragonEventType = typeof EVENT_TYPES[number]
export type Sex = 'female' | 'male' | 'unknown'

export interface KeragonAddress {
  line1?: string | undefined
  line2?: string | undefined
  city?:  string | undefined
  state?: string | undefined
  zip?:   string | undefined
}

export interface KeragonPatient {
  externalPatientId:     string
  firstName:             string
  lastName:              string
  dateOfBirth:           string
  sex?:                  Sex | undefined
  /** As sent; E.164 when mapped (toE164). */
  mobile?:               string | undefined
  email?:                string | undefined
  address?:              KeragonAddress | undefined
  allergies?:            string[] | undefined
  noKnownDrugAllergies?: boolean | undefined
}

export interface KeragonPatientEvent {
  eventId:     string
  eventType:   KeragonEventType
  occurredAt?: string | undefined
  patient:     KeragonPatient
}

export type ParseResult =
  | { ok: true; event: KeragonPatientEvent }
  | { ok: false; eventId: string | null; errors: Record<string, string> }

const EVENT_ID = /^[A-Za-z0-9._:-]{1,128}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const present = (v: unknown) => v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '')
const text = (v: unknown, max: number): string | null =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : null

function realPastDate(v: unknown, today: string): boolean {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v && v >= '1900-01-01' && v <= today
}

export function parsePatientEvent(body: unknown, now: Date = new Date()): ParseResult {
  if (!isObject(body)) return { ok: false, eventId: null, errors: { body: 'Send a JSON object.' } }
  const errors: Record<string, string> = {}
  const eventId = typeof body['event_id'] === 'string' && EVENT_ID.test(body['event_id']) ? body['event_id'] : null
  if (!eventId) errors['event_id'] = 'Required: 1 to 128 letters, digits or . _ : -'
  const eventType = body['event_type']
  if (!EVENT_TYPES.includes(eventType as KeragonEventType)) errors['event_type'] = `Must be one of: ${EVENT_TYPES.join(', ')}.`
  const occurredAt = typeof body['occurred_at'] === 'string' && !Number.isNaN(Date.parse(body['occurred_at'])) ? body['occurred_at'] : undefined

  const p = body['patient']
  if (!isObject(p)) {
    errors['patient'] = 'Required: an object.'
    return { ok: false, eventId, errors }
  }

  const externalPatientId = text(p['external_patient_id'], 129)
  if (!externalPatientId || externalPatientId.length > 128) errors['patient.external_patient_id'] = 'Required: the patient\'s id in the EHR, up to 128 characters.'
  const firstName = text(p['first_name'], 101)
  if (!firstName || firstName.length > 100) errors['patient.first_name'] = 'Required, up to 100 characters.'
  const lastName = text(p['last_name'], 101)
  if (!lastName || lastName.length > 100) errors['patient.last_name'] = 'Required, up to 100 characters.'
  const today = now.toISOString().slice(0, 10)
  if (!realPastDate(p['date_of_birth'], today)) errors['patient.date_of_birth'] = 'Required: a real date, YYYY-MM-DD, not in the future.'

  const patient: KeragonPatient = {
    externalPatientId: externalPatientId ?? '', firstName: firstName ?? '', lastName: lastName ?? '', dateOfBirth: String(p['date_of_birth'] ?? ''),
  }

  if (present(p['sex'])) {
    if (p['sex'] === 'female' || p['sex'] === 'male' || p['sex'] === 'unknown') patient.sex = p['sex']
    else errors['patient.sex'] = 'Must be female, male or unknown.'
  }
  if (present(p['mobile'])) {
    if (typeof p['mobile'] === 'string' && toE164(p['mobile'])) patient.mobile = p['mobile'].trim()
    else errors['patient.mobile'] = 'Must be a mobile number in E.164 (+15125550147) or a 10-digit US number.'
  }
  if (present(p['email'])) {
    const email = text(p['email'], 255)?.toLowerCase() ?? ''
    if (EMAIL.test(email) && email.length <= 254) patient.email = email
    else errors['patient.email'] = 'Must be an email address.'
  }
  if (present(p['address'])) {
    const a = p['address']
    if (!isObject(a)) {
      errors['patient.address'] = 'Must be an object.'
    } else {
      const address: KeragonAddress = {}
      for (const key of ['line1', 'line2', 'city'] as const) {
        if (!present(a[key])) continue
        const v = text(a[key], 201)
        if (v === null || v.length > 200) errors[`patient.address.${key}`] = 'Up to 200 characters.'
        else address[key] = v
      }
      if (present(a['state'])) {
        const v = text(a['state'], 3)?.toUpperCase() ?? ''
        if (/^[A-Z]{2}$/.test(v)) address.state = v
        else errors['patient.address.state'] = 'Must be a 2-letter state code.'
      }
      if (present(a['zip'])) {
        const v = text(a['zip'], 11) ?? ''
        if (/^\d{5}(-\d{4})?$/.test(v)) address.zip = v
        else errors['patient.address.zip'] = 'Must be a ZIP code (12345 or 12345-6789).'
      }
      if (Object.keys(address).length > 0) patient.address = address
    }
  }
  if (present(p['allergies'])) {
    const list = p['allergies']
    if (!Array.isArray(list) || !list.every(x => typeof x === 'string') || list.length > MAX_ALLERGY_ENTRIES) {
      errors['patient.allergies'] = `Must be a list of up to ${MAX_ALLERGY_ENTRIES} strings.`
    } else {
      patient.allergies = normalizeAllergies(list as string[])
    }
  }
  if (present(p['no_known_drug_allergies'])) {
    if (typeof p['no_known_drug_allergies'] === 'boolean') patient.noKnownDrugAllergies = p['no_known_drug_allergies']
    else errors['patient.no_known_drug_allergies'] = 'Must be true or false.'
  }

  if (Object.keys(errors).length > 0) return { ok: false, eventId, errors }
  return { ok: true, event: { eventId: eventId!, eventType: eventType as KeragonEventType, ...(occurredAt ? { occurredAt } : {}), patient } }
}
