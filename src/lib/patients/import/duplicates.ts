// ============================================================
// Possible duplicates in a patient import (Patient Intake PR 5)
// ============================================================
//
// The intake rules (src/lib/patients/duplicates.ts): the same mobile and
// date of birth, or the same first and last name (any case) and date of
// birth. Against the clinic's active patients, and between rows of the
// same file (a later row is flagged against the earlier one). A mobile
// match is preferred. Never merged: staff decide per row. Plain module.

import { patientName, type NameablePatient } from '@/lib/patients/display'
import type { DuplicateMatch } from '@/lib/patients/duplicates'
import type { ImportPatient } from './validate'

export interface ExistingPatient extends NameablePatient {
  patient_id: string
  date_of_birth: string | null
  phone_e164: string | null
}

export type ImportDuplicate =
  | { kind: 'existing'; patientId: string; name: string; matchedOn: DuplicateMatch }
  | { kind: 'file'; otherRow: number; name: string; matchedOn: DuplicateMatch }

const key = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

type Candidate = Pick<ImportPatient, 'firstName' | 'lastName' | 'dateOfBirth' | 'phone'>

export function findImportDuplicates(
  rows: ReadonlyArray<{ index: number; patient: Candidate }>,
  existing: ReadonlyArray<ExistingPatient>,
): Map<number, ImportDuplicate> {
  const byMobile = new Map<string, ExistingPatient>()
  const byName = new Map<string, ExistingPatient>()
  for (const e of existing) {
    if (!e.date_of_birth) continue
    if (e.phone_e164 && !byMobile.has(`${e.phone_e164}|${e.date_of_birth}`)) byMobile.set(`${e.phone_e164}|${e.date_of_birth}`, e)
    const nk = `${key(e.first_name)}|${key(e.last_name)}|${e.date_of_birth}`
    if (key(e.first_name) && key(e.last_name) && !byName.has(nk)) byName.set(nk, e)
  }

  const out = new Map<number, ImportDuplicate>()
  const seenMobile = new Map<string, number>()
  const seenName = new Map<string, number>()
  for (const { index, patient: p } of rows) {
    const mk = p.phone ? `${p.phone}|${p.dateOfBirth}` : null
    const nk = `${key(p.firstName)}|${key(p.lastName)}|${p.dateOfBirth}`

    const existingMatch = (mk && byMobile.get(mk)) ? { e: byMobile.get(mk)!, on: 'mobile_and_date_of_birth' as const }
      : byName.get(nk) ? { e: byName.get(nk)!, on: 'name_and_date_of_birth' as const } : null
    if (existingMatch) {
      out.set(index, { kind: 'existing', patientId: existingMatch.e.patient_id, name: patientName(existingMatch.e), matchedOn: existingMatch.on })
    } else {
      const fileMatch = (mk && seenMobile.has(mk)) ? { row: seenMobile.get(mk)!, on: 'mobile_and_date_of_birth' as const }
        : seenName.has(nk) ? { row: seenName.get(nk)!, on: 'name_and_date_of_birth' as const } : null
      if (fileMatch) out.set(index, { kind: 'file', otherRow: fileMatch.row, name: `${p.firstName} ${p.lastName}`, matchedOn: fileMatch.on })
    }
    if (mk && !seenMobile.has(mk)) seenMobile.set(mk, index)
    if (!seenName.has(nk)) seenName.set(nk, index)
  }
  return out
}
