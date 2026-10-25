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
import { MIN_OTHER_REASON_LENGTH } from '@/lib/orders/rx-details'

/** The same minimum as a typed "Other (describe)" reason. */
export const SAVED_STATEMENT_MIN = MIN_OTHER_REASON_LENGTH
/** The same maximum rxDetails.clinicalDifference accepts. */
export const SAVED_STATEMENT_MAX = 500

/** Who may save one: every clinic role, as favorites (any clinic member saves a favorite). */
export const STATEMENT_SAVE_ROLES: ReadonlySet<string> = new Set(['clinic_admin', 'provider', 'medical_assistant'])

const LENGTH_ERROR = `statement must be ${SAVED_STATEMENT_MIN} to ${SAVED_STATEMENT_MAX} characters`

const bodySchema = z.strictObject({
  formulation_id: z.uuid({ error: 'formulation_id must be a UUID' }),
  statement:      z.string({ error: LENGTH_ERROR }).trim().min(SAVED_STATEMENT_MIN, { error: LENGTH_ERROR }).max(SAVED_STATEMENT_MAX, { error: LENGTH_ERROR }),
  patient_id:     z.uuid({ error: 'patient_id must be a UUID' }).nullish(),
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

/** True for a well-formed UUID (query parameters). */
export function isUuid(v: string | null | undefined): v is string {
  return typeof v === 'string' && z.uuid().safeParse(v).success
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
