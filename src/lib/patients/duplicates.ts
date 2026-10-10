// ============================================================
// Possible duplicate patients (Patient Intake PR 2)
// ============================================================
//
// When a patient completes intake, another active patient in the same
// clinic with the same mobile and date of birth, or the same first and
// last name and date of birth, may be the same person. The new patient is
// flagged for staff; nothing is ever merged. The check runs after the
// patient's details are saved, so it can never fail their submission.
// Logs carry ids only.

type Db = { from: (table: string) => unknown }
type Q = {
  select: (c: string) => Q
  update: (p: unknown) => Q
  eq: (c: string, v: unknown) => Q
  neq: (c: string, v: unknown) => Q
  is: (c: string, v: null) => Q
  or: (expr: string) => Q
  limit: (n: number) => Q
  then: Promise<{ data: unknown; error: { message: string } | null }>['then']
}

export type DuplicateMatch = 'mobile_and_date_of_birth' | 'name_and_date_of_birth'

/**
 * A literal ilike value inside a PostgREST or(): the LIKE wildcards
 * escaped, and double-quoted when it holds a character or() reserves.
 */
export function ilikeLiteral(v: string): string {
  const literal = v.replace(/[\\%_]/g, c => `\\${c}`)
  return /[,()"\\:]/.test(literal) ? `"${literal.replace(/["\\]/g, c => `\\${c}`)}"` : literal
}

export async function flagPossibleDuplicate(
  db: Db,
  p: { patientId: string; clinicId: string; phoneE164: string | null; firstName: string; lastName: string; dateOfBirth: string },
): Promise<DuplicateMatch | null> {
  const or = [`and(first_name.ilike.${ilikeLiteral(p.firstName)},last_name.ilike.${ilikeLiteral(p.lastName)})`]
  if (p.phoneE164) or.unshift(`phone_e164.eq.${p.phoneE164}`)

  const { data, error } = await (db.from('patients') as Q)
    .select('patient_id, phone_e164, first_name, last_name')
    .eq('clinic_id', p.clinicId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .eq('date_of_birth', p.dateOfBirth)
    .neq('patient_id', p.patientId)
    .or(or.join(','))
    .limit(5)
  if (error) {
    console.error('[duplicates] check could not run | patient=', p.patientId)
    return null
  }
  const rows = (Array.isArray(data) ? data : []) as Array<{ patient_id: string; phone_e164: string | null; first_name: string | null; last_name: string | null }>
  if (rows.length === 0) return null

  // Prefer a mobile match: it is the stronger signal.
  const byMobile = p.phoneE164 ? rows.find(r => r.phone_e164 === p.phoneE164) : undefined
  const match = byMobile ?? rows[0]!
  const matchedOn: DuplicateMatch = byMobile ? 'mobile_and_date_of_birth' : 'name_and_date_of_birth'

  const { error: flagError } = await (db.from('patients') as Q)
    .update({
      possible_duplicate_of: match.patient_id,
      possible_duplicate_matched_on: matchedOn,
      possible_duplicate_flagged_at: new Date().toISOString(),
      possible_duplicate_dismissed_at: null,
      possible_duplicate_dismissed_by: null,
    })
    .eq('patient_id', p.patientId)
    .eq('clinic_id', p.clinicId)
  if (flagError) {
    console.error('[duplicates] flag could not be written | patient=', p.patientId)
    return null
  }
  console.info(`[duplicates] flagged | patient=${p.patientId} | matched=${matchedOn}`)
  return matchedOn
}
