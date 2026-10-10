// ============================================================
// Naming a patient on staff screens (Patient Intake PR 2)
// ============================================================
//
// A patient added with only a mobile number has no name until they finish
// intake. Staff screens show "New patient (mobile ending 0123)" rather than
// a blank or "undefined". Plain module: client and server.

export interface NameablePatient {
  first_name?: string | null
  last_name?:  string | null
  phone?:      string | null
  phone_e164?: string | null
}

const clean = (s: string | null | undefined) => (typeof s === 'string' ? s.trim() : '')

export function mobileLast4(p: Pick<NameablePatient, 'phone' | 'phone_e164'>): string | null {
  const digits = (p.phone_e164 ?? p.phone ?? '').replace(/\D/g, '')
  return digits.length >= 4 ? digits.slice(-4) : null
}

export function patientName(p: NameablePatient, order: 'first-last' | 'last-first' = 'first-last'): string {
  const first = clean(p.first_name)
  const last = clean(p.last_name)
  if (first && last) return order === 'last-first' ? `${last}, ${first}` : `${first} ${last}`
  if (first || last) return first || last
  const last4 = mobileLast4(p)
  return last4 ? `New patient (mobile ending ${last4})` : 'New patient'
}

export type IntakeStatus = 'pending' | 'complete'

export function isIntakePending(p: { intake_status?: string | null }): boolean {
  return p.intake_status === 'pending'
}

export function intakeStatusLabel(status: IntakeStatus): string {
  return status === 'pending' ? 'Awaiting patient details' : 'Details complete'
}

/** The PostgREST embed of the other patient on a flagged patient. */
export const POSSIBLE_DUPLICATE_EMBED = 'possible_duplicate_of, possible_duplicate_dismissed_at, duplicate:patients!patients_possible_duplicate_of_fkey(first_name, last_name, phone)'

/**
 * Patient Intake PR 2: an open "possible duplicate" flag (set at intake,
 * not yet dismissed), with the other patient's name for staff. Null when
 * there is none.
 */
export function openPossibleDuplicate(p: {
  possible_duplicate_of?: string | null
  possible_duplicate_dismissed_at?: string | null
  duplicate?: NameablePatient | NameablePatient[] | null
}): { patientId: string; name: string } | null {
  if (!p.possible_duplicate_of || p.possible_duplicate_dismissed_at) return null
  const other = Array.isArray(p.duplicate) ? p.duplicate[0] : p.duplicate
  return { patientId: p.possible_duplicate_of, name: other ? patientName(other) : 'another patient' }
}
