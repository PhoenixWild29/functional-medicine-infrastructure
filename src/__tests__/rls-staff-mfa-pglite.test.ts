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

import type { PGlite } from '@electric-sql/pglite'
import { migratedDb, asUser } from './helpers/pglite-migrated'
import { STAFF_MFA_PHI_TABLES } from '@/lib/auth/staff-mfa-rls'

jest.setTimeout(600_000)

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

let db: PGlite

beforeAll(async () => {
  db = await migratedDb()
  await db.exec(`
    INSERT INTO dosage_forms (dosage_form_id, name) VALUES ('d0000000-0000-4000-8000-000000000001', 'Form');
    INSERT INTO routes_of_administration (route_id, name, abbreviation, sig_prefix) VALUES ('d0000000-0000-4000-8000-000000000002', 'Route', 'RT', 'Take');
    INSERT INTO formulations (formulation_id, name, dosage_form_id, route_id) VALUES ('d0000000-0000-4000-8000-000000000003', 'Formulation', 'd0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002');
    INSERT INTO clinics (clinic_id, name, stripe_connect_status) VALUES ('${CLINIC}', 'Sunrise', 'ACTIVE');
    INSERT INTO pharmacies (pharmacy_id, name, slug, integration_tier) VALUES ('${PHARMACY}', 'Strive', 'strive', 'TIER_4_FAX');
    INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES
      ('${USERS.provider}', 'dr@test', '{"app_role":"provider","clinic_id":"${CLINIC}"}');
    INSERT INTO providers (provider_id, clinic_id, first_name, last_name, npi_number, license_state, license_number, user_id) VALUES
      ('a2000000-0000-4000-8000-000000000001', '${CLINIC}', 'Sarah', 'Chen', '1234567890', 'TX', 'TX-1', '${USERS.provider}');
    INSERT INTO patients (patient_id, clinic_id, first_name, last_name, date_of_birth, phone, phone_e164) VALUES
      ('a3000000-0000-4000-8000-000000000001', '${CLINIC}', 'Alex', 'Demo', '1985-06-15', '+15125550100', '+15125550100');
    INSERT INTO orders (order_id, patient_id, provider_id, clinic_id, pharmacy_id, formulation_id, status, quantity) VALUES
      ('d1000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', '${CLINIC}', '${PHARMACY}', 'd0000000-0000-4000-8000-000000000003', 'DRAFT', 1);
  `)
})

afterAll(async () => { await db?.close() })

const claims = (role: StaffRole | null, aal: 'aal1' | 'aal2') => ({
  sub: role ? USERS[role] : 'a0000000-0000-4000-8000-0000000000ff',
  role: 'authenticated',
  aal,
  app_metadata: role === null ? {} : role === 'ops_admin' ? { app_role: role } : role === 'pharmacy_admin' ? { app_role: role, pharmacy_id: PHARMACY } : { app_role: role, clinic_id: CLINIC },
})

const setSwitch = (on: boolean) => db.exec(`UPDATE public.security_settings SET require_staff_mfa = ${on} WHERE id = 1`)
const count = async (role: StaffRole | null, aal: 'aal1' | 'aal2', table: string) =>
  (await asUser<{ n: number }>(db, claims(role, aal), `SELECT count(*)::int AS n FROM public.${table}`))[0]!.n
const satisfied = async (role: StaffRole | null, aal: 'aal1' | 'aal2') =>
  (await asUser<{ ok: boolean }>(db, claims(role, aal), 'SELECT public.staff_mfa_satisfied() AS ok'))[0]!.ok

describe('the switch is off (the default, as REQUIRE_MFA is today)', () => {
  beforeAll(() => setSwitch(false))

  it.each(['clinic_admin', 'medical_assistant', 'provider', 'ops_admin'] as const)('%s reads PHI at aal1 and at aal2', async role => {
    expect(await count(role, 'aal1', 'orders')).toBe(1)
    expect(await count(role, 'aal2', 'orders')).toBe(1)
  })

  it('patients: clinic roles read at aal1 and aal2', async () => {
    expect(await count('clinic_admin', 'aal1', 'patients')).toBe(1)
    expect(await count('clinic_admin', 'aal2', 'patients')).toBe(1)
  })

  it('pharmacy_admin is always required: not satisfied at aal1, satisfied at aal2', async () => {
    expect(await satisfied('pharmacy_admin', 'aal1')).toBe(false)
    expect(await satisfied('pharmacy_admin', 'aal2')).toBe(true)
    expect(await count('pharmacy_admin', 'aal1', 'orders')).toBe(0)
  })
})

describe('the switch is on (MFA required for every staff role)', () => {
  beforeAll(() => setSwitch(true))
  afterAll(() => setSwitch(false))

  it.each(['clinic_admin', 'medical_assistant', 'provider', 'ops_admin'] as const)('%s reads 0 rows at aal1 and its rows at aal2', async role => {
    expect(await count(role, 'aal1', 'orders')).toBe(0)
    expect(await count(role, 'aal2', 'orders')).toBe(1)
  })

  it('every PHI table: 0 rows at aal1, and the patient row back at aal2', async () => {
    // Some PHI tables are not granted to authenticated at all (permission
    // denied): that is no rows too.
    for (const t of STAFF_MFA_PHI_TABLES) {
      const n = await count('ops_admin', 'aal1', t).catch((e: Error) => (/permission denied/.test(e.message) ? 0 : Promise.reject(e)))
      expect([t, n]).toEqual([t, 0])
    }
    expect(await count('clinic_admin', 'aal1', 'patients')).toBe(0)
    expect(await count('clinic_admin', 'aal2', 'patients')).toBe(1)
  })

  it('a staff session with no aal claim is aal1', async () => {
    const rows = await asUser<{ n: number }>(db, { sub: USERS.clinic_admin, role: 'authenticated', app_metadata: { app_role: 'clinic_admin', clinic_id: CLINIC } }, 'SELECT count(*)::int AS n FROM public.orders')
    expect(rows[0]!.n).toBe(0)
  })

  it('writes are covered too (FOR ALL): an aal1 update changes nothing', async () => {
    const rows = await asUser<{ patient_id: string }>(db, claims('clinic_admin', 'aal1'), `UPDATE public.patients SET last_name = 'Changed' RETURNING patient_id`)
    expect(rows).toHaveLength(0)
  })

  it('a JWT with no staff role is left to the other policies', async () => {
    expect(await satisfied(null, 'aal1')).toBe(true)
  })

  it('the service role (token pages, crons, webhooks) is not affected', async () => {
    await db.exec('BEGIN')
    try {
      await db.exec('SET LOCAL ROLE service_role')
      const { rows } = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM public.orders')
      expect(rows[0]!.n).toBe(1)
    } finally {
      await db.exec('ROLLBACK')
    }
  })
})

describe('the settings row', () => {
  it('is readable and writable by no API role; staff_mfa_satisfied reads it on their behalf', async () => {
    for (const role of ['clinic_admin', 'ops_admin'] as const) {
      await expect(asUser(db, claims(role, 'aal2'), 'SELECT * FROM public.security_settings')).rejects.toThrow(/permission denied/)
      await expect(asUser(db, claims(role, 'aal2'), 'UPDATE public.security_settings SET require_staff_mfa = false')).rejects.toThrow(/permission denied/)
    }
  })

  it('a missing row fails closed: every staff role is required', async () => {
    await db.exec('BEGIN')
    try {
      await db.exec('DELETE FROM public.security_settings')
      await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims('clinic_admin', 'aal1'))])
      await db.exec('SET LOCAL ROLE authenticated')
      const { rows } = await db.query<{ ok: boolean }>('SELECT public.staff_mfa_satisfied() AS ok')
      expect(rows[0]!.ok).toBe(false)
    } finally {
      await db.exec('ROLLBACK')
    }
  })
})

describe('the policy', () => {
  it('is on every listed PHI table, RESTRICTIVE, for authenticated, for all commands', async () => {
    const { rows } = await db.query<{ tablename: string; permissive: string; roles: string[]; cmd: string }>(
      `SELECT tablename, permissive, roles, cmd FROM pg_policies WHERE schemaname = 'public' AND policyname = 'staff_mfa_aal2' ORDER BY tablename`)
    expect(rows.map(r => r.tablename).sort()).toEqual([...STAFF_MFA_PHI_TABLES].sort())
    for (const r of rows) {
      expect(r.permissive).toBe('RESTRICTIVE')
      expect(String(r.roles)).toContain('authenticated')
      expect(r.cmd).toBe('ALL')
    }
  })

  it('the down migration removes the policies, the function and the table', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    await db.exec('BEGIN')
    try {
      await db.exec(readFileSync(join(process.cwd(), 'supabase', 'migrations', 'down', '20261024000012_down.sql'), 'utf8').replace(/^\s*BEGIN;|COMMIT;\s*$/gm, ''))
      const left = await db.query(`SELECT 1 FROM pg_policies WHERE policyname = 'staff_mfa_aal2'`)
      expect(left.rows).toHaveLength(0)
      const fn = await db.query(`SELECT to_regprocedure('public.staff_mfa_satisfied()') AS f, to_regclass('public.security_settings') AS t`)
      expect(fn.rows[0]).toEqual({ f: null, t: null })
      // and the clinic reads again at aal1 with no switch at all
      await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims('clinic_admin', 'aal1'))])
      await db.exec('SET LOCAL ROLE authenticated')
      const { rows } = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM public.orders')
      expect(rows[0]!.n).toBe(1)
    } finally {
      await db.exec('ROLLBACK')
    }
  })
})
