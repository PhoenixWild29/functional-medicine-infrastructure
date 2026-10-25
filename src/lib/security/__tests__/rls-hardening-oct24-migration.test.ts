/**
 * @jest-environment node
 *
 * Security review, Oct 24: migration 20261024000001 (after 20261021000001).
 * No Postgres runner here: this pins what the SQL must say.
 *
 *   - clinics: the clinic_user UPDATE policy is dropped and INSERT, UPDATE,
 *     DELETE and TRUNCATE are revoked from anon and authenticated. With self
 *     sign-up any visitor gets a clinic_admin JWT for a new, unapproved
 *     clinic; that policy let them PATCH their own row through PostgREST
 *     (anon key + their JWT) to is_active true, onboarding_status
 *     'approved' and any stripe_connect_account_id, skipping ops review.
 *     The app writes clinics only with the service role. SELECT is kept.
 *   - clinic_signup_links: authenticated loses INSERT, UPDATE, DELETE and
 *     TRUNCATE (RLS already refused the row writes; TRUNCATE ignores RLS).
 *   - clinic_team_members and set_clinic_member_active (SECURITY DEFINER)
 *     resolve pg_catalog before public.
 *   - SELECT apply_pharmacy_admin_scope(); last before COMMIT; a down file.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations')
const FILE = '20261024000001_rls_hardening.sql'
const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8').replace(/\r\n/g, '\n') : '')
const flat = (s: string) => s.replace(/--.*$/gm, '').replace(/\s+/g, ' ').toLowerCase().trim()
const code = flat(read(join(MIGRATIONS, FILE)))
const down = flat(read(join(MIGRATIONS, 'down', '20261024000001_down.sql')))

it('exists after 20261021000001, with a down file, each in one transaction', () => {
  expect(code).not.toBe('')
  expect(down).not.toBe('')
  const files = readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()
  expect(files.indexOf(FILE)).toBe(files.indexOf('20261021000001_team_invites.sql') + 1)
  for (const sql of [code, down]) {
    expect(sql.startsWith('begin;')).toBe(true)
    expect(sql.endsWith('commit;')).toBe(true)
  }
})

it('clinics: the clinic_user UPDATE policy is dropped; writes revoked from anon and authenticated; reads kept', () => {
  expect(code).toContain('drop policy if exists clinics_clinic_user_update on public.clinics;')
  expect(code).toContain('revoke insert, update, delete, truncate on public.clinics from anon, authenticated;')
  expect(code).not.toMatch(/revoke[^;]*select[^;]*on public\.clinics/)
  expect(code).not.toMatch(/create policy[^;]*on public\.clinics/)
})

it('clinic_signup_links: authenticated loses every write grant', () => {
  expect(code).toContain('revoke insert, update, delete, truncate on public.clinic_signup_links from authenticated;')
})

it('the two SECURITY DEFINER team functions resolve pg_catalog first', () => {
  expect(code).toContain('alter function public.clinic_team_members(uuid) set search_path = pg_catalog, public;')
  expect(code).toContain('alter function public.set_clinic_member_active(uuid, uuid, boolean, uuid) set search_path = pg_catalog, public;')
})

it('apply_pharmacy_admin_scope() is the last statement before COMMIT', () => {
  expect(code).toMatch(/select apply_pharmacy_admin_scope\(\); commit;$/)
})

it('the down file restores the policy (app_metadata), the grants and the old search_path', () => {
  expect(down).toContain("create policy clinics_clinic_user_update on public.clinics for update to authenticated using (clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::uuid);")
  expect(down).toContain('grant insert, update, delete, truncate on public.clinics to anon, authenticated;')
  expect(down).toContain('grant insert, update, delete, truncate on public.clinic_signup_links to authenticated;')
  expect(down).toContain('alter function public.clinic_team_members(uuid) set search_path = public, pg_catalog;')
  expect(down).toContain('alter function public.set_clinic_member_active(uuid, uuid, boolean, uuid) set search_path = public, pg_catalog;')
  expect(down).not.toContain('user_metadata')
})

