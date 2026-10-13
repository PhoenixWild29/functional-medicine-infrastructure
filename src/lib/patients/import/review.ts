// ============================================================
// Reviewing an import before anything is written (Patient Intake PR 5)
// ============================================================
//
// Every row is normalised and checked, then compared with the clinic's
// active patients (and the file's other rows) for possible duplicates.
// Used by the validate route (shown to staff) and again by the import
// route (never trusting what the browser sends back). Server only: reads
// patients with the service-role client, always filtered to the caller's
// clinic.

import { findImportDuplicates, type ExistingPatient, type ImportDuplicate } from './duplicates'
import { normalizeImportRow, type ImportPatient, type RowError } from './validate'
import type { ColumnMapping } from './mapping'

export type RowStatus = 'ready' | 'error' | 'duplicate'

export interface RowResult {
  index: number
  status: RowStatus
  errors: RowError[]
  patient: ImportPatient | null
  duplicate?: ImportDuplicate
}

export interface ImportCounts {
  ready: number
  error: number
  duplicate: number
  total: number
}

type Db = { from: (table: string) => unknown }
type Q = {
  select: (c: string) => Q
  eq: (c: string, v: unknown) => Q
  is: (c: string, v: null) => Q
  in: (c: string, v: unknown[]) => Q
  then: Promise<{ data: unknown; error: { message: string } | null }>['then']
}

const DOB_CHUNK = 500

async function existingPatients(db: Db, clinicId: string, dobs: string[]): Promise<ExistingPatient[] | null> {
  const out: ExistingPatient[] = []
  for (let i = 0; i < dobs.length; i += DOB_CHUNK) {
    const { data, error } = await (db.from('patients') as Q)
      .select('patient_id, first_name, last_name, date_of_birth, phone_e164')
      .eq('clinic_id', clinicId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .in('date_of_birth', dobs.slice(i, i + DOB_CHUNK))
    if (error) {
      console.error('[patient-import] duplicate lookup failed:', error.message)
      return null
    }
    out.push(...((Array.isArray(data) ? data : []) as ExistingPatient[]))
  }
  return out
}

export function countRows(rows: ReadonlyArray<RowResult>): ImportCounts {
  return {
    ready: rows.filter(r => r.status === 'ready').length,
    error: rows.filter(r => r.status === 'error').length,
    duplicate: rows.filter(r => r.status === 'duplicate').length,
    total: rows.length,
  }
}

/** null when the duplicate check could not run: never treated as "no duplicates". */
export async function reviewImport(
  db: Db, clinicId: string, rows: ReadonlyArray<ReadonlyArray<string>>, mapping: ColumnMapping,
): Promise<{ rows: RowResult[]; counts: ImportCounts } | null> {
  const results: RowResult[] = rows.map((cells, index) => {
    const { patient, errors } = normalizeImportRow(cells, mapping)
    return { index, status: errors.length ? 'error' : 'ready', errors, patient }
  })

  const valid = results.filter((r): r is RowResult & { patient: ImportPatient } => r.patient !== null)
  const dobs = [...new Set(valid.map(r => r.patient.dateOfBirth))]
  const existing = dobs.length ? await existingPatients(db, clinicId, dobs) : []
  if (existing === null) return null

  const duplicates = findImportDuplicates(valid.map(r => ({ index: r.index, patient: r.patient })), existing)
  for (const r of results) {
    const d = duplicates.get(r.index)
    if (d) { r.status = 'duplicate'; r.duplicate = d }
  }
  return { rows: results, counts: countRows(results) }
}
