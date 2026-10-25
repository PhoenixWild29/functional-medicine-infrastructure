/**
 * @jest-environment node
 *
 * Coverage gap 6 (Gina Rooks, 2026-09-11: clinical difference statements
 * "like Strive's list", e.g. "Glycine added to help maintain muscle
 * mass"): a provider can save a statement they typed, for the practice
 * or for one patient, for that formulation, and pick it next time.
 * Nothing is pre-selected.
 *
 * Pure rules (lib/clinical-statements/saved.ts) and the migration's shape
 * (20261024000009_saved_clinical_statements.sql).
 */

import fs from 'node:fs'
import path from 'node:path'
import {
  SAVED_STATEMENT_MAX,
  SAVED_STATEMENT_MIN,
  isAnyUuid,
  parseSavedStatementBody,
  visibleStatements,
} from '../saved'
import { isClinicStaffRole } from '@/lib/auth/claims'
import { MIN_OTHER_REASON_LENGTH } from '@/lib/orders/rx-details'

const FORM = 'a7000000-0000-4000-8000-000000000001'
const PAT  = 'a3000000-0000-4000-8000-000000000001'
const LONG = 'Glycine added to help maintain muscle mass'

describe('parseSavedStatementBody', () => {
  it('accepts a formulation, a statement and an optional patient; trims the statement', () => {
    expect(parseSavedStatementBody({ formulation_id: FORM, statement: `  ${LONG}  ` }))
      .toEqual({ ok: true, value: { formulation_id: FORM, statement: LONG, patient_id: null } })
    expect(parseSavedStatementBody({ formulation_id: FORM, statement: LONG, patient_id: PAT }))
      .toEqual({ ok: true, value: { formulation_id: FORM, statement: LONG, patient_id: PAT } })
  })

  it('bounds the statement: at least the "Other" minimum, at most 500 characters', () => {
    expect(SAVED_STATEMENT_MIN).toBe(MIN_OTHER_REASON_LENGTH)
    expect(SAVED_STATEMENT_MAX).toBe(500)
    expect(parseSavedStatementBody({ formulation_id: FORM, statement: 'too short' }))
      .toEqual({ ok: false, error: `statement must be ${SAVED_STATEMENT_MIN} to ${SAVED_STATEMENT_MAX} characters` })
    expect(parseSavedStatementBody({ formulation_id: FORM, statement: 'x'.repeat(501) }).ok).toBe(false)
    expect(parseSavedStatementBody({ formulation_id: FORM, statement: 'x'.repeat(500) }).ok).toBe(true)
  })

  it('refuses a missing or malformed id, unknown fields and a non-object body', () => {
    expect(parseSavedStatementBody({ statement: LONG })).toEqual({ ok: false, error: 'formulation_id must be a UUID' })
    expect(parseSavedStatementBody({ formulation_id: 'nope', statement: LONG })).toEqual({ ok: false, error: 'formulation_id must be a UUID' })
    expect(parseSavedStatementBody({ formulation_id: FORM, statement: LONG, patient_id: 'x' })).toEqual({ ok: false, error: 'patient_id must be a UUID' })
    expect(parseSavedStatementBody({ formulation_id: FORM, statement: LONG, clinic_id: FORM }).ok).toBe(false)
    expect(parseSavedStatementBody(null).ok).toBe(false)
    expect(parseSavedStatementBody('x').ok).toBe(false)
  })
})

describe('visibleStatements', () => {
  const row = (id: string, patient: string | null, created: string) => ({ statement_id: id, statement: `Statement ${id} long enough to keep`, patient_id: patient, created_at: created })

  it("this patient's statements first, then the practice's; newest first within each; another patient's never", () => {
    const rows = [
      row('p1', null, '2026-10-01T00:00:00Z'),
      row('mine-old', PAT, '2026-10-02T00:00:00Z'),
      row('other', 'a3000000-0000-4000-8000-000000000099', '2026-10-05T00:00:00Z'),
      row('p2', null, '2026-10-04T00:00:00Z'),
      row('mine-new', PAT, '2026-10-03T00:00:00Z'),
    ]
    expect(visibleStatements(rows, PAT).map(r => r.statement_id)).toEqual(['mine-new', 'mine-old', 'p2', 'p1'])
  })

  it('no patient in context: the practice statements only', () => {
    expect(visibleStatements([row('p1', null, '2026-10-01T00:00:00Z'), row('mine', PAT, '2026-10-02T00:00:00Z')], null).map(r => r.statement_id)).toEqual(['p1'])
  })
})

describe('who may save', () => {
  it('follows favorites: every clinic staff role (isClinicStaffRole); not ops or pharmacy', () => {
    for (const role of ['clinic_admin', 'provider', 'medical_assistant']) expect(isClinicStaffRole(role)).toBe(true)
    for (const role of ['ops_admin', 'pharmacy_admin', undefined]) expect(isClinicStaffRole(role)).toBe(false)
  })
})

// C's review: zod's z.uuid() refused the seeded demo and E2E ids (not RFC v4).
describe('seeded ids are ids (any 8-4-4-4-12 hex)', () => {
  const DEMO_PATIENT = 'a3000000-0000-0000-0000-000000000004'
  const E2E_FORMULATION = 'aaaaaaaa-0000-0000-0000-000000000032'

  it('accepts the demo patient and E2E formulation ids in the body', () => {
    expect(parseSavedStatementBody({ formulation_id: E2E_FORMULATION, statement: LONG, patient_id: DEMO_PATIENT }))
      .toEqual({ ok: true, value: { formulation_id: E2E_FORMULATION, statement: LONG, patient_id: DEMO_PATIENT } })
  })

  it('isAnyUuid: seeded and random ids yes; anything else no', () => {
    for (const id of [DEMO_PATIENT, E2E_FORMULATION, 'f0000000-0000-0000-0000-00000000005e', FORM]) expect(isAnyUuid(id)).toBe(true)
    for (const id of ['nope', '', null, 'a3000000-0000-0000-0000-00000000000', 'g3000000-0000-0000-0000-000000000004']) expect(isAnyUuid(id)).toBe(false)
  })
})

describe('migration 20261024000009_saved_clinical_statements', () => {
  const MIGRATIONS = path.join(process.cwd(), 'supabase', 'migrations')
  const VERSION = '20261024000009'
  const up = () => fs.readFileSync(path.join(MIGRATIONS, `${VERSION}_saved_clinical_statements.sql`), 'utf8')

  it('exists once, with a down file', () => {
    const versions = fs.readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).map(f => f.split('_')[0]!)
    expect(versions.filter(v => v === VERSION)).toHaveLength(1)
    expect(fs.existsSync(path.join(MIGRATIONS, 'down', `${VERSION}_down.sql`))).toBe(true)
  })

  it('creates the table, scoped to a clinic and a formulation, an optional patient, a bounded statement', () => {
    const sql = up()
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS saved_clinical_statements/)
    expect(sql).toMatch(/clinic_id\s+UUID\s+NOT NULL REFERENCES clinics\(clinic_id\)/)
    expect(sql).toMatch(/formulation_id\s+UUID\s+NOT NULL REFERENCES formulations\(formulation_id\)/)
    expect(sql).toMatch(/patient_id\s+UUID\s+REFERENCES patients\(patient_id\)/)
    expect(sql).toMatch(/char_length\(statement\) BETWEEN 20 AND 500/)
  })

  it('RLS on; reads for its clinic roles and ops_admin from app_metadata only; no write grant to users', () => {
    const sql = up()
    expect(sql).toMatch(/ALTER TABLE saved_clinical_statements ENABLE ROW LEVEL SECURITY/)
    const policies = [...sql.matchAll(/CREATE POLICY[^;]*ON saved_clinical_statements[^;]*;/g)].map(m => m[0])
    expect(policies.length).toBe(2)
    for (const p of policies) {
      expect(p).toMatch(/FOR SELECT TO authenticated/)
      expect(p).toMatch(/app_metadata/)
      expect(p).not.toMatch(/user_metadata/)
    }
    expect(policies.some(p => /'clinic_admin', 'provider', 'medical_assistant'/.test(p) && /app_metadata' ->> 'clinic_id'/.test(p))).toBe(true)
    expect(policies.some(p => /'ops_admin'/.test(p))).toBe(true)
    expect(sql).toMatch(/REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON saved_clinical_statements FROM anon, authenticated/)
  })

  it('ends with apply_pharmacy_admin_scope() as the last statement before COMMIT', () => {
    const sql = up().replace(/--[^\n]*/g, '').trim()
    expect(sql).toMatch(/SELECT apply_pharmacy_admin_scope\(\);\s*COMMIT;$/)
  })
})
