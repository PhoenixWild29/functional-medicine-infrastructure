/**
 * @jest-environment node
 *
 * HIPAA B3: MFA in RLS, on a real Postgres (PGlite) with every migration
 * applied (20261024000012_rls_require_aal2 included).
 *
 * A staff JWT at aal1 reads no PHI through PostgREST when MFA is required
 * for it; at aal2 it reads as before. pharmacy_admin is always required;
 * the other staff roles only when the database switch
 * (security_settings.require_staff_mfa) is on. A JWT with no staff role is
 * left to the other policies, and the service role (patients' token pages,
 * crons, webhooks) is not affected.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runPlan, type PlanStep, type StepResult } from './helpers/pglite-migrated'
import { STAFF_MFA_PHI_TABLES, STAFF_MFA_SWITCH_SQL } from '@/lib/auth/staff-mfa-rls'

jest.setTimeout(900_000)

const CLINIC = 'a1000000-0000-4000-8000-000000000001'
const PHARMACY = 'a4000000-0000-4000-8000-000000000001'
const USERS = {
  clinic_admin:      'a0000000-0000-4000-8000-0000000000a1',
  provider:          'a0000000-0000-4000-8000-0000000000a2',
  medical_assistant: 'a0000000-0000-4000-8000-0000000000a3',
  ops_admin:         'a0000000-0000-4000-8000-0000000000a4',
  pharmacy_admin:    'a0000000-0000-4000-8000-0000000000a5',
} as const
type StaffRole = keyof typeof USERS
const CLINIC_ROLES = ['clinic_admin', 'medical_assistant', 'provider', 'ops_admin'] as const

const SEED = `
  INSERT INTO dosage_forms (dosage_form_id, name) VALUES ('d0000000-0000-4000-8000-000000000001', 'Form');
  INSERT INTO routes_of_administration (route_id, name, abbreviation, sig_prefix) VALUES ('d0000000-0000-4000-8000-000000000002', 'Route', 'RT', 'Take');
  INSERT INTO formulations (formulation_id, name, dosage_form_id, route_id) VALUES ('d0000000-0000-4000-8000-000000000003', 'Formulation', 'd0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002');
  INSERT INTO clinics (clinic_id, name, stripe_connect_status) VALUES ('${CLINIC}', 'Sunrise', 'ACTIVE');
  INSERT INTO pharmacies (pharmacy_id, name, slug, integration_tier) VALUES ('${PHARMACY}', 'Strive', 'strive', 'TIER_4_FAX');
  INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ('${USERS.provider}', 'dr@test', '{"app_role":"provider","clinic_id":"${CLINIC}"}');
  INSERT INTO providers (provider_id, clinic_id, first_name, last_name, npi_number, license_state, license_number, user_id) VALUES
    ('a2000000-0000-4000-8000-000000000001', '${CLINIC}', 'Sarah', 'Chen', '1234567890', 'TX', 'TX-1', '${USERS.provider}');
  INSERT INTO patients (patient_id, clinic_id, first_name, last_name, date_of_birth, phone, phone_e164) VALUES
    ('a3000000-0000-4000-8000-000000000001', '${CLINIC}', 'Alex', 'Demo', '1985-06-15', '+15125550100', '+15125550100');
  INSERT INTO orders (order_id, patient_id, provider_id, clinic_id, pharmacy_id, formulation_id, status, quantity) VALUES
    ('d1000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', '${CLINIC}', '${PHARMACY}', 'd0000000-0000-4000-8000-000000000003', 'DRAFT', 1);
  SELECT 1;
`

const claims = (role: StaffRole | null, aal: 'aal1' | 'aal2' | null) => ({
  sub: role ? USERS[role] : 'a0000000-0000-4000-8000-0000000000ff',
  role: 'authenticated',
  ...(aal ? { aal } : {}),
  app_metadata: role === null ? {} : role === 'ops_admin' ? { app_role: role } : role === 'pharmacy_admin' ? { app_role: role, pharmacy_id: PHARMACY } : { app_role: role, clinic_id: CLINIC },
})
const countSql = (table: string) => `SELECT count(*)::int AS n FROM public.${table}`
const SATISFIED = 'SELECT public.staff_mfa_satisfied() AS ok'
const DOWN = readFileSync(join(process.cwd(), 'supabase', 'migrations', 'down', '20261024000012_down.sql'), 'utf8')
  .replace(/^\s*BEGIN;\s*$/m, '').replace(/^\s*COMMIT;\s*$/m, '')

const steps: PlanStep[] = [{ id: 'seed', sql: SEED, persist: true }]
const phase = (name: 'off' | 'on') => {
  steps.push({ id: `${name}:switch`, sql: name === 'on' ? STAFF_MFA_SWITCH_SQL.on.replace(/;$/, ' RETURNING id') : STAFF_MFA_SWITCH_SQL.off.replace(/;$/, ' RETURNING id'), persist: true })
  for (const role of CLINIC_ROLES) for (const aal of ['aal1', 'aal2'] as const) {
    steps.push({ id: `${name}:${role}:${aal}:orders`, claims: claims(role, aal), sql: countSql('orders') })
  }
  for (const aal of ['aal1', 'aal2'] as const) {
    steps.push({ id: `${name}:clinic_admin:${aal}:patients`, claims: claims('clinic_admin', aal), sql: countSql('patients') })
    steps.push({ id: `${name}:pharmacy_admin:${aal}:satisfied`, claims: claims('pharmacy_admin', aal), sql: SATISFIED })
  }
  steps.push({ id: `${name}:pharmacy_admin:aal1:orders`, claims: claims('pharmacy_admin', 'aal1'), sql: countSql('orders') })
}
phase('off')
phase('on')
for (const t of STAFF_MFA_PHI_TABLES) steps.push({ id: `on:ops_admin:aal1:${t}`, claims: claims('ops_admin', 'aal1'), sql: countSql(t) })
steps.push(
  { id: 'on:no-aal-claim', claims: claims('clinic_admin', null), sql: countSql('orders') },
  { id: 'on:update-aal1', claims: claims('clinic_admin', 'aal1'), sql: `UPDATE public.patients SET last_name = 'Changed' RETURNING patient_id` },
  { id: 'on:update-aal2', claims: claims('clinic_admin', 'aal2'), sql: `UPDATE public.patients SET last_name = 'Changed' RETURNING patient_id` },
  { id: 'on:non-staff', claims: claims(null, 'aal1'), sql: SATISFIED },
  { id: 'on:service-role', role: 'service_role', sql: countSql('orders') },
  { id: 'settings:select', claims: claims('ops_admin', 'aal2'), sql: 'SELECT * FROM public.security_settings' },
  { id: 'settings:update', claims: claims('ops_admin', 'aal2'), sql: 'UPDATE public.security_settings SET require_staff_mfa = false RETURNING id' },
  { id: 'settings:missing-row', pre: 'DELETE FROM public.security_settings', claims: claims('clinic_admin', 'aal1'), sql: SATISFIED },
  { id: 'policies', sql: `SELECT tablename, permissive, roles::text AS roles, cmd FROM pg_policies WHERE schemaname = 'public' AND policyname = 'staff_mfa_aal2' ORDER BY tablename` },
  { id: 'down:objects', pre: DOWN, sql: `SELECT (SELECT count(*)::int FROM pg_policies WHERE policyname = 'staff_mfa_aal2') AS policies, to_regprocedure('public.staff_mfa_satisfied()')::text AS fn, to_regclass('public.security_settings')::text AS tbl` },
  { id: 'down:aal1-reads', pre: DOWN, claims: claims('clinic_admin', 'aal1'), sql: countSql('orders') },
)

let results: Map<string, StepResult>
beforeAll(() => { results = runPlan(steps) })

const rows = (id: string) => {
  const r = results.get(id)
  if (!r) throw new Error(`no result for ${id}`)
  if (r.error) throw new Error(`${id}: ${r.error}`)
  return r.rows!
}
const n = (id: string) => Number(rows(id)[0]!['n'])
const ok = (id: string) => rows(id)[0]!['ok'] as boolean

it('the seed and the switch flips run', () => {
  expect(rows('seed')).toBeDefined()
  expect(rows('off:switch')).toEqual([{ id: 1 }])
  expect(rows('on:switch')).toEqual([{ id: 1 }])
})

describe('the switch is off (the default, as REQUIRE_MFA is today)', () => {
  it.each(CLINIC_ROLES)('%s reads PHI at aal1 and at aal2', role => {
    expect(n(`off:${role}:aal1:orders`)).toBe(1)
    expect(n(`off:${role}:aal2:orders`)).toBe(1)
  })

  it('patients: a clinic role reads at aal1 and at aal2', () => {
    expect(n('off:clinic_admin:aal1:patients')).toBe(1)
    expect(n('off:clinic_admin:aal2:patients')).toBe(1)
  })

  it('pharmacy_admin is always required: not satisfied at aal1, satisfied at aal2', () => {
    expect(ok('off:pharmacy_admin:aal1:satisfied')).toBe(false)
    expect(ok('off:pharmacy_admin:aal2:satisfied')).toBe(true)
    expect(n('off:pharmacy_admin:aal1:orders')).toBe(0)
  })
})

describe('the switch is on (MFA required for every staff role)', () => {
  it.each(CLINIC_ROLES)('%s reads 0 rows at aal1 and its rows at aal2', role => {
    expect(n(`on:${role}:aal1:orders`)).toBe(0)
    expect(n(`on:${role}:aal2:orders`)).toBe(1)
  })

  it('patients: 0 at aal1, the row at aal2', () => {
    expect(n('on:clinic_admin:aal1:patients')).toBe(0)
    expect(n('on:clinic_admin:aal2:patients')).toBe(1)
  })

  it('every PHI table: no rows at aal1 (or no grant at all)', () => {
    for (const t of STAFF_MFA_PHI_TABLES) {
      const r = results.get(`on:ops_admin:aal1:${t}`)!
      const seen = r.error ? (/permission denied/.test(r.error) ? 0 : r.error) : Number(r.rows![0]!['n'])
      expect([t, seen]).toEqual([t, 0])
    }
  })

  it('a staff session with no aal claim is aal1', () => {
    expect(n('on:no-aal-claim')).toBe(0)
  })

  it('writes are covered too (FOR ALL): an aal1 update changes nothing, an aal2 one does', () => {
    expect(rows('on:update-aal1')).toHaveLength(0)
    expect(rows('on:update-aal2')).toHaveLength(1)
  })

  it('pharmacy_admin stays required', () => {
    expect(ok('on:pharmacy_admin:aal1:satisfied')).toBe(false)
    expect(ok('on:pharmacy_admin:aal2:satisfied')).toBe(true)
  })

  it('a JWT with no staff role is left to the other policies', () => {
    expect(ok('on:non-staff')).toBe(true)
  })

  it('the service role (token pages, crons, webhooks) is not affected', () => {
    expect(n('on:service-role')).toBe(1)
  })
})

describe('the settings row', () => {
  it('no API role can read or write it', () => {
    expect(results.get('settings:select')!.error).toMatch(/permission denied/)
    expect(results.get('settings:update')!.error).toMatch(/permission denied/)
  })

  it('a missing row fails closed: every staff role is required', () => {
    expect(ok('settings:missing-row')).toBe(false)
  })
})

describe('the policy', () => {
  it('is on every listed PHI table, RESTRICTIVE, for authenticated, for all commands', () => {
    const p = rows('policies') as Array<{ tablename: string; permissive: string; roles: string; cmd: string }>
    expect(p.map(r => r.tablename).sort()).toEqual([...STAFF_MFA_PHI_TABLES].sort())
    for (const r of p) {
      expect(r.permissive).toBe('RESTRICTIVE')
      expect(r.roles).toContain('authenticated')
      expect(r.cmd).toBe('ALL')
    }
  })

  it('the down migration removes the policies, the functions and the table; aal1 reads again', () => {
    expect(rows('down:objects')).toEqual([{ policies: 0, fn: null, tbl: null }])
    expect(n('down:aal1-reads')).toBe(1)
  })
})
