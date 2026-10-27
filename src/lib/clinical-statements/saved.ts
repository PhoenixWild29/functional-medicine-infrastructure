// ============================================================
// Saved clinical difference statements (coverage gap 6)
// ============================================================
//
// Gina Rooks, 2026-09-11: GLP-1s "need clinical difference statements
// (patient-specific reason for compound versus commercial product)... for
// example, Glycine added to help maintain muscle mass. These are some
// that Strive uses". The standard 503A reasons are a picklist on the
// formulation (formulations.clinical_difference_options); a statement a
// provider types under "Other (describe)" can now be saved, for the
// practice or for one patient, for that formulation, and picked next
// time. Nothing is ever pre-selected (Sam has not decided pre-selection).
//
// Stored in saved_clinical_statements (migration 20261024000009). Pure:
// validation and ordering, shared by the route and the tests.

import { z } from 'zod'
import { UUID_RE } from '@/lib/api/input'
import { SAVED_STATEMENT_MAX, SAVED_STATEMENT_MIN } from './limits'

export { SAVED_STATEMENT_MAX, SAVED_STATEMENT_MIN }

const LENGTH_ERROR = `statement must be ${SAVED_STATEMENT_MIN} to ${SAVED_STATEMENT_MAX} characters`

// Any 8-4-4-4-12 hex id (lib/api/input UUID_RE), not zod's RFC z.uuid():
// the seeded demo and E2E ids (a3000000-0000-0000-..., aaaaaaaa-0000-...)
// are not RFC v4, and must work (C's review, 2026-10-25).
const anyUuid = (error: string) => z.string({ error }).regex(UUID_RE, { error })

const bodySchema = z.strictObject({
  formulation_id: anyUuid('formulation_id must be a UUID'),
  statement:      z.string({ error: LENGTH_ERROR }).trim().min(SAVED_STATEMENT_MIN, { error: LENGTH_ERROR }).max(SAVED_STATEMENT_MAX, { error: LENGTH_ERROR }),
  patient_id:     anyUuid('patient_id must be a UUID').nullish(),
})

export interface SavedStatementBody {
  formulation_id: string
  statement:      string
  patient_id:     string | null
}

/** POST /api/clinical-statements body: unknown fields refused, the statement trimmed and bounded. */
export function parseSavedStatementBody(raw: unknown): { ok: true; value: SavedStatementBody } | { ok: false; error: string } {
  const r = bodySchema.safeParse(raw)
  if (!r.success) {
    const issue = r.error.issues[0]
    const message = issue?.code === 'unrecognized_keys' ? 'body has fields that are not accepted'
      : issue?.code === 'invalid_type' && issue.path.length === 0 ? 'body must be an object'
      : issue?.message ?? 'invalid body'
    return { ok: false, error: message }
  }
  return { ok: true, value: { formulation_id: r.data.formulation_id, statement: r.data.statement, patient_id: r.data.patient_id ?? null } }
}

/** True for any 8-4-4-4-12 hex id, seeded or random. */
export function isAnyUuid(v: string | null | undefined): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}

export interface SavedStatementRow {
  statement_id: string
  statement:    string
  patient_id:   string | null
  created_at:   string
}

/**
 * The statements a caller sees: this patient's first, then the
 * practice's, newest first within each. Another patient's are dropped
 * (the query already excludes them; this is the second check).
 */
export function visibleStatements<T extends SavedStatementRow>(rows: ReadonlyArray<T>, patientId: string | null): T[] {
  const newest = (a: T, b: T) => b.created_at.localeCompare(a.created_at)
  const mine = patientId ? rows.filter(r => r.patient_id === patientId).sort(newest) : []
  const practice = rows.filter(r => r.patient_id == null).sort(newest)
  return [...mine, ...practice]
}
