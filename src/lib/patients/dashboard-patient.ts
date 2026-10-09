// The patient fields a Dashboard row needs, from the orders → patients
// embed (an object for a many-to-one embed, or an array). One place, so the
// server render and the client refresh name a patient the same way.

import { isIntakePending, patientName, type NameablePatient } from './display'

type EmbeddedPatient = NameablePatient & { patient_id?: string | null; intake_status?: string | null }

export function dashboardPatient(embed: unknown): { patientId: string | null; patientName: string; patientIntakePending: boolean } {
  const p = (Array.isArray(embed) ? embed[0] : embed) as EmbeddedPatient | null | undefined
  if (!p) return { patientId: null, patientName: '—', patientIntakePending: false }
  return {
    patientId: p.patient_id ?? null,
    patientName: patientName(p, 'last-first'),
    patientIntakePending: isIntakePending(p),
  }
}
