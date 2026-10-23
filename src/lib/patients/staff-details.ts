// ============================================================
// + New patient: the optional details staff may add (Patient Intake PR 4)
// ============================================================
//
// When staff fill + New patient from a face sheet, they review and edit
// these details before saving; POST /api/patients checks them here, the
// same way the patient's own intake does. Every one is optional: none
// changes the duplicate check, the 'pending' intake status or the intake
// link (the patient still confirms the privacy notice and texts there).
// Allergies are recorded only when staff gave a list or NKDA.
// Plain module: no logging, nothing typed leaves it.

import { MAX_ALLERGY_ENTRIES, normalizeAllergies } from './allergies'

export type DetailsFail = { field: string; error: string }

export interface StaffDetailColumns {
  date_of_birth?: string
  sex?: 'female' | 'male' | 'unknown'
  email?: string
  address_line1?: string
  address_line2?: string
  city?: string
  zip?: string
  allergies?: string[]
  nkda?: boolean
  allergies_updated_at?: string
  current_medications?: string
}

const MAX = { line: 200, city: 100, meds: 2000, email: 254 }
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const given = (v: unknown) => v !== undefined && v !== null && v !== ''

function realPastDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const [y, m, d] = v.split('-').map(Number) as [number, number, number]
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return false
  return y >= 1900 && dt.getTime() <= Date.now()
}

function line(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim().replace(/\s+/g, ' ')
  return t && t.length <= max ? t : null
}

export function staffDetails(body: Record<string, unknown>, now: Date = new Date()): { columns: StaffDetailColumns } | DetailsFail {
  const columns: StaffDetailColumns = {}

  if (given(body['dateOfBirth'])) {
    const v = body['dateOfBirth']
    if (typeof v !== 'string' || !realPastDate(v)) return { field: 'dateOfBirth', error: 'Enter a real date of birth.' }
    columns.date_of_birth = v
  }
  if (given(body['sex'])) {
    const v = body['sex']
    if (v !== 'female' && v !== 'male' && v !== 'unknown') return { field: 'sex', error: 'Choose one.' }
    columns.sex = v
  }
  if (given(body['email'])) {
    const v = typeof body['email'] === 'string' ? body['email'].trim().toLowerCase() : ''
    if (v.length > MAX.email || !EMAIL_RE.test(v)) return { field: 'email', error: 'Enter an email address, or leave it empty.' }
    columns.email = v
  }
  for (const [key, column, max, error] of [
    ['addressLine1', 'address_line1', MAX.line, 'That address line is too long.'],
    ['addressLine2', 'address_line2', MAX.line, 'That address line is too long.'],
    ['city', 'city', MAX.city, 'That city is too long.'],
  ] as const) {
    if (!given(body[key])) continue
    const v = line(body[key], max)
    if (!v) return { field: key, error }
    columns[column] = v
  }
  if (given(body['zip'])) {
    const v = typeof body['zip'] === 'string' ? body['zip'].trim() : ''
    if (!/^\d{5}(-\d{4})?$/.test(v)) return { field: 'zip', error: 'Enter a 5-digit ZIP code.' }
    columns.zip = v
  }

  const rawAllergies = body['allergies']
  if (rawAllergies !== undefined && rawAllergies !== null) {
    if (!Array.isArray(rawAllergies) || rawAllergies.length > MAX_ALLERGY_ENTRIES || rawAllergies.some(a => typeof a !== 'string')) {
      return { field: 'allergies', error: 'Check the list of allergies.' }
    }
  }
  const allergies = normalizeAllergies((rawAllergies ?? []) as string[])
  const nkda = body['nkda'] === true
  if (nkda && allergies.length > 0) return { field: 'allergies', error: 'Choose either no known drug allergies or list the allergies.' }
  if (nkda || allergies.length > 0) {
    columns.allergies = allergies
    columns.nkda = nkda
    columns.allergies_updated_at = now.toISOString()
  }

  if (given(body['currentMedications'])) {
    const v = typeof body['currentMedications'] === 'string' ? body['currentMedications'].trim() : ''
    if (!v || v.length > MAX.meds) return { field: 'currentMedications', error: 'That list is too long.' }
    columns.current_medications = v
  }

  return { columns }
}
