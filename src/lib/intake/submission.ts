// ============================================================
// A patient's self-intake submission, checked (Patient Intake PR 2/3)
// ============================================================
//
// What the intake page sends, validated the same way for a patient's own
// intake link (/api/intake/[token]) and a clinic's sign-up link
// (/api/join/[token]). Each failure names its field and says what to fix.
// Plain module: no logging, nothing the patient typed leaves it.

import { normalizeAllergies } from '@/lib/patients/allergies'

const MAX = { name: 100, line: 200, city: 100, meds: 2000, allergy: 200, allergies: 50 }

export type SubmissionFail = { field: string; error: string }

export interface IntakeSubmission {
  sms: boolean
  firstName: string; lastName: string; dateOfBirth: string; sex: 'female' | 'male' | 'unknown'
  line1: string; line2: string | null; city: string; state: string; zip: string
  nkda: boolean; allergies: string[]; currentMedications: string | null
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim().replace(/\s+/g, ' ')
  return t && t.length <= max ? t : null
}

function realPastDate(v: unknown): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  const [y, m, d] = v.split('-').map(Number) as [number, number, number]
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  if (y < 1900 || dt.getTime() > Date.now()) return null
  return v
}

export function validateIntakeSubmission(body: unknown): IntakeSubmission | SubmissionFail {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, Record<string, unknown> | undefined>
  const consent = b['consent'] ?? {}
  const details = b['details'] ?? {}
  const address = b['address'] ?? {}
  const health = b['health'] ?? {}

  if (consent['privacyNotice'] !== true) return { field: 'consent.privacyNotice', error: 'Please confirm you have read the privacy notice.' }

  const firstName = str(details['firstName'], MAX.name)
  if (!firstName) return { field: 'details.firstName', error: 'Enter your first name.' }
  const lastName = str(details['lastName'], MAX.name)
  if (!lastName) return { field: 'details.lastName', error: 'Enter your last name.' }
  const dateOfBirth = realPastDate(details['dateOfBirth'])
  if (!dateOfBirth) return { field: 'details.dateOfBirth', error: 'Enter your date of birth.' }
  const sex = details['sex']
  if (sex !== 'female' && sex !== 'male' && sex !== 'unknown') return { field: 'details.sex', error: 'Choose one.' }

  const line1 = str(address['line1'], MAX.line)
  if (!line1) return { field: 'address.line1', error: 'Enter your street address.' }
  const line2Raw = address['line2']
  const line2 = line2Raw === undefined || line2Raw === null || line2Raw === '' ? null : str(line2Raw, MAX.line)
  if (line2Raw && !line2) return { field: 'address.line2', error: 'That address line is too long.' }
  const city = str(address['city'], MAX.city)
  if (!city) return { field: 'address.city', error: 'Enter your city.' }
  const state = typeof address['state'] === 'string' ? address['state'].trim().toUpperCase() : ''
  if (!/^[A-Z]{2}$/.test(state)) return { field: 'address.state', error: 'Choose your state.' }
  const zip = typeof address['zip'] === 'string' ? address['zip'].trim() : ''
  if (!/^\d{5}(-\d{4})?$/.test(zip)) return { field: 'address.zip', error: 'Enter a 5-digit ZIP code.' }

  const nkda = health['nkda'] === true
  const rawAllergies = Array.isArray(health['allergies']) ? health['allergies'] : []
  if (rawAllergies.length > MAX.allergies || rawAllergies.some(a => typeof a !== 'string' || a.length > MAX.allergy)) {
    return { field: 'health.allergies', error: 'Check your list of allergies.' }
  }
  const allergies = normalizeAllergies(rawAllergies as string[])
  if (nkda && allergies.length > 0) return { field: 'health.allergies', error: 'Choose either no known drug allergies or list your allergies.' }
  if (!nkda && allergies.length === 0) return { field: 'health.allergies', error: 'List your allergies, or choose no known drug allergies.' }
  const medsRaw = health['currentMedications']
  if (medsRaw !== undefined && medsRaw !== null && typeof medsRaw !== 'string') return { field: 'health.currentMedications', error: 'Check your medications.' }
  const meds = typeof medsRaw === 'string' ? medsRaw.trim() : ''
  if (meds.length > MAX.meds) return { field: 'health.currentMedications', error: 'That list is too long.' }

  return {
    sms: consent['sms'] === true,
    firstName, lastName, dateOfBirth, sex,
    line1, line2, city, state, zip,
    nkda, allergies, currentMedications: meds || null,
  }
}
