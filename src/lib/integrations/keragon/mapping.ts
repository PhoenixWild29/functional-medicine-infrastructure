// ============================================================
// Keragon patient -> patients columns
// ============================================================
//
// Only the fields the EHR sent are mapped: an absent field never clears
// what the patient has. The mobile is stored as given and as E.164
// (withPhoneE164, as every phone write must). SMS consent is never
// mapped: sync cannot opt a patient in or out.

import { withPhoneE164 } from '@/lib/patients/phone'
import type { KeragonPatient } from './contract'

export interface PatientSyncFields {
  first_name?:    string
  last_name?:     string
  date_of_birth?: string
  sex?:           string
  phone?:         string
  phone_e164?:    string | null
  email?:         string
  address_line1?: string
  address_line2?: string
  city?:          string
  state?:         string
  zip?:           string
  allergies?:     string[]
  nkda?:          boolean
}

export type SyncField = keyof PatientSyncFields

/** The fields a patient fills in themselves at self-intake. */
export const SELF_INTAKE_FIELDS: ReadonlyArray<SyncField> = [
  'first_name', 'last_name', 'date_of_birth', 'sex', 'address_line1', 'address_line2', 'city', 'state', 'zip', 'allergies', 'nkda',
]

export function toPatientFields(p: KeragonPatient): PatientSyncFields {
  const out: PatientSyncFields = { first_name: p.firstName, last_name: p.lastName, date_of_birth: p.dateOfBirth }
  if (p.sex !== undefined) out.sex = p.sex
  if (p.mobile !== undefined) {
    const withE164 = withPhoneE164({ phone: p.mobile })
    // Stored as E.164 in both columns, so one mobile reads the same everywhere.
    out.phone = withE164.phone_e164 ?? p.mobile
    out.phone_e164 = withE164.phone_e164 ?? null
  }
  if (p.email !== undefined) out.email = p.email
  if (p.address) {
    if (p.address.line1 !== undefined) out.address_line1 = p.address.line1
    if (p.address.line2 !== undefined) out.address_line2 = p.address.line2
    if (p.address.city !== undefined) out.city = p.address.city
    if (p.address.state !== undefined) out.state = p.address.state
    if (p.address.zip !== undefined) out.zip = p.address.zip
  }
  if (p.allergies !== undefined) out.allergies = p.allergies
  if (p.noKnownDrugAllergies !== undefined) out.nkda = p.noKnownDrugAllergies
  return out
}
