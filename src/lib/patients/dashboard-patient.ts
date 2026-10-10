// The patient fields a Dashboard row needs, from the orders → patients
// embed (an object for a many-to-one embed, or an array). One place, so the
// server render and the client refresh name a patient the same way.

import { isIntakePending, openPossibleDuplicate, patientName, type NameablePatient } from './display'

type EmbeddedPatient = NameablePatient & { patient_id?: string | null; intake_status?: string | null } & Parameters<typeof openPossibleDuplicate>[0]

export function dashboardPatient(embed: unknown): {
  patientId: string | null
  patientName: string
  patientIntakePending: boolean
  possibleDuplicate: { patientId: string; name: string } | null
} {
  const p = (Array.isArray(embed) ? embed[0] : embed) as EmbeddedPatient | null | undefined
  if (!p) return { patientId: null, patientName: '—', patientIntakePending: false, possibleDuplicate: null }
  return {
    patientId: p.patient_id ?? null,
    patientName: patientName(p, 'last-first'),
    patientIntakePending: isIntakePending(p),
    possibleDuplicate: openPossibleDuplicate(p),
  }
}
