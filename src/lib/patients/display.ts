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
