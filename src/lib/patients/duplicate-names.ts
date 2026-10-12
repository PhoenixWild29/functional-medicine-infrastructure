// ============================================================
// Names for "Possible duplicate of <name>" (Patient Intake PR 2)
// ============================================================
//
// The flag's columns are selected plainly (POSSIBLE_DUPLICATE_COLUMNS);
// the other patients' names come from this one clinic-scoped read. Never
// a PostgREST self-embed on patients: possible_duplicate_of references
// patients itself, so an embed through it can be ambiguous (PGRST201) and
// fail the whole query it sits in (duplicate-names.test.ts guards this).
//
// Plain module: the server pages, the API route and the dashboard's
// browser refresh all use it, each with its own client (RLS keeps a clinic
// user to their clinic; the clinic filter is also explicit).

import type { NameablePatient } from './display'

export const POSSIBLE_DUPLICATE_COLUMNS = 'possible_duplicate_of, possible_duplicate_dismissed_at'

type Db = { from: (table: string) => unknown }
type Q = {
  select: (c: string) => Q
  eq: (c: string, v: unknown) => Q
  in: (c: string, v: unknown[]) => Q
  then: Promise<{ data: unknown; error: { message: string } | null }>['then']
}

/** The other patients' names, by id. A read failure gives no names (the flag still shows). */
export async function loadDuplicateNames(db: Db, clinicId: string, ids: ReadonlyArray<string>): Promise<Map<string, NameablePatient>> {
  const unique = [...new Set(ids.filter(Boolean))]
  if (unique.length === 0) return new Map()
  const { data, error } = await (db.from('patients') as Q)
    .select('patient_id, first_name, last_name, phone')
    .eq('clinic_id', clinicId)
    .in('patient_id', unique)
  if (error) {
    console.error('[duplicate-names] read failed:', error.message)
    return new Map()
  }
  const rows = (Array.isArray(data) ? data : []) as Array<NameablePatient & { patient_id: string }>
  const entries: Array<[string, NameablePatient]> = rows.map(r => [
    r.patient_id,
    { first_name: r.first_name ?? null, last_name: r.last_name ?? null, phone: r.phone ?? null },
  ])
  return new Map(entries)
}

/** The ids of open flags among rows (flagged and not dismissed). */
export function openDuplicateIds(rows: ReadonlyArray<{ possible_duplicate_of?: string | null; possible_duplicate_dismissed_at?: string | null } | null | undefined>): string[] {
  return rows.flatMap(r => (r?.possible_duplicate_of && !r.possible_duplicate_dismissed_at ? [r.possible_duplicate_of] : []))
}
