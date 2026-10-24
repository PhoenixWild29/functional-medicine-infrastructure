/**
 * @jest-environment node
 *
 * Security review L5: migration 20261024000004 (after 20261024000003, the
 * fax viewer's phi_access_log.fax_id). No Postgres runner here: this pins
 * what the SQL must say; the behaviour was proved on PGlite (report).
 *
 *   - orders, patients, providers, payment_groups,
 *     provider_npi_verifications, provider_state_licenses: the user write
 *     policies are dropped and INSERT, UPDATE, DELETE and TRUNCATE are
 *     revoked from anon and authenticated. Every app write to these tables
 *     uses the service role (traced writer by writer, Oct 24), so the app is
 *     unchanged; a user JWT (any stranger's, since self sign-up) can no
 *     longer write them through PostgREST past the API's approval guard
 *     and signing checks.
 *   - Every SELECT policy stays. The two *_admin_write policies were FOR
 *     ALL; reads stay covered by *_clinic_select.
 *   - SELECT apply_pharmacy_admin_scope(); last before COMMIT; a down file.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations')
const FILE = '20261024000004_rls_user_write_lockdown.sql'
const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8').replace(/\r\n/g, '\n') : '')
const flat = (s: string) => s.replace(/--.*$/gm, '').replace(/\s+/g, ' ').toLowerCase().trim()
const code = flat(read(join(MIGRATIONS, FILE)))
const down = flat(read(join(MIGRATIONS, 'down', '20261024000004_down.sql')))

const POLICIES: Array<[string, string]> = [
  ['orders', 'orders_clinic_user_insert'],
  ['orders', 'orders_clinic_user_update'],
  ['patients', 'patients_clinic_user_insert'],
  ['patients', 'patients_clinic_user_update'],
  ['providers', 'providers_clinic_user_insert'],
  ['providers', 'providers_clinic_user_update'],
  ['payment_groups', 'payment_groups_clinic_user_insert'],
  ['payment_groups', 'payment_groups_clinic_user_update'],
  ['provider_npi_verifications', 'provider_npi_verifications_admin_write'],
  ['provider_state_licenses', 'provider_state_licenses_admin_write'],
]
const TABLES = [...new Set(POLICIES.map(([t]) => t))]

it('exists, with a down file, each in one transaction', () => {
  expect(code).not.toBe('')
  expect(down).not.toBe('')
  for (const sql of [code, down]) {
    expect(sql.startsWith('begin;')).toBe(true)
    expect(sql.endsWith('commit;')).toBe(true)
  }
})

it.each(POLICIES)('%s: %s is dropped', (table, policy) => {
  expect(code).toContain(`drop policy if exists ${policy} on public.${table};`)
})

it.each(TABLES)('%s: writes revoked from anon and authenticated; no SELECT revoked or policy created', table => {
  expect(code).toContain(`revoke insert, update, delete, truncate on public.${table} from anon, authenticated;`)
  expect(code).not.toMatch(new RegExp(`revoke[^;]*select[^;]*on public\\.${table}\\b`))
  expect(code).not.toMatch(new RegExp(`create policy[^;]*on public\\.${table}\\b`))
})

it('no SELECT policy is touched', () => {
  expect(code).not.toMatch(/drop policy if exists \w*select\w*/)
})

it('apply_pharmacy_admin_scope() is the last statement before COMMIT', () => {
  expect(code).toMatch(/select apply_pharmacy_admin_scope\(\); commit;$/)
})

it('the down file restores each policy (app_metadata, never user_metadata) and the grants', () => {
  for (const [table, policy] of POLICIES) expect(down).toContain(`create policy ${policy} on public.${table}`)
  for (const table of TABLES) expect(down).toContain(`grant insert, update, delete, truncate on public.${table} to anon, authenticated;`)
  expect(down).not.toContain('user_metadata')
})
