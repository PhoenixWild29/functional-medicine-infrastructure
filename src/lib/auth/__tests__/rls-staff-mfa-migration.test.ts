/**
 * @jest-environment node
 *
 * HIPAA B3, statically: 20261024000012_rls_require_aal2.sql puts a
 * RESTRICTIVE aal2 policy on exactly the PHI tables in
 * lib/auth/staff-mfa-rls (STAFF_MFA_PHI_TABLES), with the app's rule made
 * stricter (lib/auth/mfa): pharmacy_admin always (the app no longer forces
 * it; see lib/auth/staff-mfa-rls), every other authenticated
 * JWT (staff role or not) when the database switch is on. The behaviour is tested on Postgres in
 * src/__tests__/rls-staff-mfa-pglite.test.ts.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { STAFF_MFA_PHI_TABLES, STAFF_MFA_SWITCH_SQL } from '../staff-mfa-rls'
import { MFA_ROLES } from '../mfa'

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations')
const FILE = '20261024000012_rls_require_aal2.sql'
const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '')
const sql = read(join(MIGRATIONS, FILE))
const down = read(join(MIGRATIONS, 'down', '20261024000012_down.sql'))
const code = (s: string) => s.replace(/--.*$/gm, '').replace(/\s+/g, ' ').trim()

const arrayIn = (body: string, name: string): string[] => {
  const m = new RegExp(`${name}\\s+CONSTANT\\s+text\\[\\]\\s*:=\\s*ARRAY\\[([\\s\\S]*?)\\]`, 'i').exec(body)
  return m ? [...m[1]!.matchAll(/'([a-z0-9_]+)'/g)].map(x => x[1]!) : []
}

it('exists with a down migration, runs in one transaction, and sorts after 20261024000011', () => {
  expect(sql).not.toBe('')
  expect(down).not.toBe('')
  for (const s of [sql, down]) {
    expect(code(s)).toMatch(/^BEGIN;/)
    expect(code(s)).toMatch(/COMMIT;$/)
  }
  const versions = readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()
  // Sorts after every migration before it (later ones may follow it).
  expect(versions.indexOf(FILE)).toBeGreaterThan(versions.indexOf('20261024000011_order_signing_snapshots.sql'))
  expect(versions).toContain('20261024000011_order_signing_snapshots.sql')
})

it('covers exactly the PHI tables of the shared list, each created by an earlier migration', () => {
  expect(arrayIn(sql, 'phi_tables').sort()).toEqual([...STAFF_MFA_PHI_TABLES].sort())
  const earlier = readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql') && f < FILE).map(f => read(join(MIGRATIONS, f))).join('\n')
  for (const t of STAFF_MFA_PHI_TABLES) {
    expect([t, new RegExp(`CREATE TABLE (IF NOT EXISTS )?(public\\.)?${t}\\b`, 'i').test(earlier)]).toEqual([t, true])
  }
  expect(STAFF_MFA_PHI_TABLES).toEqual(expect.arrayContaining(['patients', 'orders', 'order_status_history', 'adapter_submissions', 'phi_access_log', 'treatment_proposals']))
})

it('the policy is RESTRICTIVE, for authenticated, for all commands, on staff_mfa_satisfied()', () => {
  const c = code(sql)
  // Wrapped in a SELECT: an InitPlan, once per statement (B's review, F2).
  expect(c).toMatch(/CREATE POLICY staff_mfa_aal2 ON public\.%I AS RESTRICTIVE FOR ALL TO authenticated USING \(\(SELECT public\.staff_mfa_satisfied\(\)\)\) WITH CHECK \(\(SELECT public\.staff_mfa_satisfied\(\)\)\)/)
})

it("order_sla_deadlines is a PHI table (free-text resolution_notes; B's review, F3)", () => {
  expect(STAFF_MFA_PHI_TABLES).toContain('order_sla_deadlines')
})

it('the rule: aal2 passes, pharmacy_admin always, the switch for every other JWT (no exemption for a non-staff role)', () => {
  const c = code(sql)
  // The database still forces pharmacy_admin; the app does not (2026-10-30).
  // Harmless while the pharmacy portal reads no PHI table (staff-mfa-rls).
  const always = arrayIn(sql, 'always_roles')
  expect(always).toEqual(['pharmacy_admin'])
  expect(always.every(r => (MFA_ROLES as readonly string[]).includes(r))).toBe(true)
  // B's review, F1: no early exit for a JWT whose role is missing or unknown.
  expect(c).not.toMatch(/staff_roles/)
  expect(c).not.toMatch(/app_role IS NULL/)
  const body = /AS \$\$([\s\S]*?)\$\$/.exec(c)?.[1] ?? ''
  expect(body.match(/RETURN true;/g)).toHaveLength(1)
  expect(body.indexOf("(auth.jwt() ->> 'aal') = 'aal2'")).toBeLessThan(body.indexOf('RETURN true;'))
  expect(c).toContain("(auth.jwt() ->> 'aal') = 'aal2'")
  expect(c).toContain("auth.jwt() -> 'app_metadata' ->> 'app_role'")
  // A missing settings row requires MFA (fail closed).
  expect(c).toMatch(/coalesce\(\(SELECT s\.require_staff_mfa FROM public\.security_settings s WHERE s\.id = 1\), true\)/)
})

it('the switch is one row nobody but the owner can read or write, flipped with one statement', () => {
  const c = code(sql)
  expect(c).toMatch(/CREATE TABLE IF NOT EXISTS public\.security_settings/)
  expect(c).toMatch(/CHECK \(id = 1\)/)
  expect(c).toMatch(/require_staff_mfa boolean NOT NULL DEFAULT false/i)
  expect(c).toMatch(/ALTER TABLE public\.security_settings ENABLE ROW LEVEL SECURITY/)
  expect(c).toMatch(/REVOKE ALL ON public\.security_settings FROM PUBLIC, anon, authenticated/)
  expect(c).toMatch(/SECURITY DEFINER/)
  expect(STAFF_MFA_SWITCH_SQL.on).toBe('UPDATE public.security_settings SET require_staff_mfa = true, updated_at = now() WHERE id = 1;')
  expect(STAFF_MFA_SWITCH_SQL.off).toBe('UPDATE public.security_settings SET require_staff_mfa = false, updated_at = now() WHERE id = 1;')
})

it('creates a table, so apply_pharmacy_admin_scope() is the last statement before COMMIT', () => {
  expect(code(sql)).toMatch(/SELECT apply_pharmacy_admin_scope\(\); COMMIT;$/)
})

it('a later migration that adds a PHI table can re-apply it: apply_staff_mfa_scope() exists and is run', () => {
  const c = code(sql)
  expect(c).toMatch(/CREATE OR REPLACE FUNCTION public\.apply_staff_mfa_scope\(\)/)
  expect(c).toMatch(/SELECT public\.apply_staff_mfa_scope\(\);/)
})

it('the down migration drops the policies, the functions and the table', () => {
  const d = code(down)
  expect(d).toMatch(/DROP POLICY IF EXISTS staff_mfa_aal2/)
  expect(d).toMatch(/DROP FUNCTION IF EXISTS public\.apply_staff_mfa_scope\(\)/)
  expect(d).toMatch(/DROP FUNCTION IF EXISTS public\.staff_mfa_satisfied\(\)/)
  expect(d).toMatch(/DROP TABLE IF EXISTS public\.security_settings/)
})
