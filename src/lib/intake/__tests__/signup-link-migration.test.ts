/**
 * @jest-environment node
 *
 * Patient Intake PR 3: migration 20261019000001 (after 20261018000001).
 * No Postgres runner here: this pins what the SQL must say.
 *
 *   - clinic_signup_links: the token's SHA-256 only (no token column), who
 *     made it and when, enabled on/off, revoked_at (and who), a use count.
 *     One active (not revoked) link per clinic.
 *   - RLS: clinic staff read their own clinic's row (app_metadata, never
 *     user_metadata); no INSERT/UPDATE/DELETE policy (the service role
 *     writes); anon gets nothing.
 *   - patients.source gains 'signup_link' (every existing value kept), and
 *     patients.signup_link_id records the link a patient came from.
 *   - signup_link_create_patient(...): under a lock on the link, refuses a
 *     link that is off or revoked, enforces the daily cap, creates the
 *     patient in the LINK's clinic (complete, signup_link) and counts the
 *     use. Executable by the service role only.
 *   - SELECT apply_pharmacy_admin_scope(); last before COMMIT; a down file
 *     that refuses while sign-up patients exist.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations')
const FILE = '20261019000001_clinic_signup_link.sql'
const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8').replace(/\r\n/g, '\n') : '')
const flat = (s: string) => s.replace(/--.*$/gm, '').replace(/\s+/g, ' ').toLowerCase()
const code = flat(read(join(MIGRATIONS, FILE)))
const down = flat(read(join(MIGRATIONS, 'down', '20261019000001_down.sql')))
const table = () => code.slice(code.indexOf('create table if not exists clinic_signup_links ('), code.indexOf(');', code.indexOf('create table if not exists clinic_signup_links (')))
const fn = () => {
  const at = code.indexOf('create or replace function signup_link_create_patient(')
  return at < 0 ? '' : code.slice(at, code.indexOf('$$;', at))
}

it('exists, with a down file, each in one transaction, numbered 20261019000001', () => {
  expect(code).not.toBe('')
  expect(down).not.toBe('')
  expect(code).toMatch(/^\s*begin;/)
  expect(down).toMatch(/^\s*begin;/)
  expect(readdirSync(MIGRATIONS).filter(f => f.startsWith('20261019000001_'))).toEqual([FILE])
})

it('clinic_signup_links: the token hash only, who and when, on/off, revoked, a use count', () => {
  const t = table()
  for (const col of [
    'link_id uuid not null', 'clinic_id uuid not null references clinics', "token_hash text not null", 'enabled boolean not null default true',
    'created_by uuid', 'created_at timestamptz not null default now()', 'revoked_at timestamptz', 'revoked_by uuid',
    'use_count integer not null default 0', 'last_used_at timestamptz',
  ]) expect(t).toContain(col)
  expect(t).toMatch(/check \(token_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/)
  expect(t).not.toMatch(/\btoken text\b/)
  expect(code).toMatch(/create unique index if not exists uq_signup_links_token_hash on clinic_signup_links \(token_hash\)/)
  expect(code).toMatch(/create unique index if not exists uq_signup_links_one_active_per_clinic on clinic_signup_links \(clinic_id\) where revoked_at is null/)
})

it('RLS: clinic staff read their own clinic’s link (app_metadata); no write policy; nothing for anon', () => {
  expect(code).toMatch(/alter table clinic_signup_links enable row level security/)
  expect(code).toMatch(/create policy signup_links_clinic_select on clinic_signup_links for select to authenticated using \(clinic_id = \(auth\.jwt\(\) -> 'app_metadata' ->> 'clinic_id'\)::uuid\)/)
  expect(code).not.toMatch(/on clinic_signup_links for (insert|update|delete|all)/)
  expect(code).not.toMatch(/to anon/)
  expect(code).toMatch(/revoke all on clinic_signup_links from anon/)
  expect(code).not.toMatch(/user_metadata/)
})

it("patients: source allows 'signup_link' (existing values kept), and signup_link_id", () => {
  expect(code).toMatch(/drop constraint if exists patients_source_check/)
  expect(code).toMatch(/add constraint patients_source_check check \(source in \('staff', ?'self_intake', ?'import', ?'ehr', ?'csv_import', ?'signup_link'\)\)/)
  expect(code).toMatch(/add column if not exists signup_link_id uuid references clinic_signup_links\(link_id\) on delete set null/)
  expect(code).toMatch(/create index if not exists idx_patients_signup_link_created on patients \(signup_link_id, created_at\) where signup_link_id is not null/)
})

it('signup_link_create_patient: locks the link, refuses off/revoked, enforces the cap, link’s clinic, counts the use', () => {
  const f = fn()
  expect(f).not.toBe('')
  expect(f).toMatch(/from clinic_signup_links where link_id = p_link_id for update/)
  expect(f).toMatch(/not v_link\.enabled or v_link\.revoked_at is not null/)
  expect(f).toContain("'inactive'")
  expect(f).toMatch(/signup_link_id = p_link_id and created_at > now\(\) - interval '24 hours'/)
  expect(f).toContain("'cap'")
  expect(f).toContain('insert into patients')
  expect(f).toContain('v_link.clinic_id')
  expect(f).not.toMatch(/p_patient->>'clinic_id'/)
  expect(f).toContain("'complete'")
  expect(f).toContain("'signup_link'")
  expect(f).toMatch(/update clinic_signup_links set use_count = use_count \+ 1/)
  expect(code).toContain('revoke all on function signup_link_create_patient(uuid, integer, jsonb) from public, anon, authenticated')
  expect(code).toContain('grant execute on function signup_link_create_patient(uuid, integer, jsonb) to service_role')
})

it('ends with apply_pharmacy_admin_scope() before COMMIT', () => {
  expect(code).toMatch(/select apply_pharmacy_admin_scope\(\); commit;\s*$/)
})

it('the down migration refuses while sign-up patients exist, then reverses everything', () => {
  expect(down).toMatch(/raise exception/)
  expect(down).toContain("source = 'signup_link'")
  expect(down).toContain('drop function if exists signup_link_create_patient(uuid, integer, jsonb)')
  expect(down).toContain('drop column if exists signup_link_id')
  expect(down).toContain('drop table if exists clinic_signup_links')
  expect(down).toMatch(/check \(source in \('staff', ?'self_intake', ?'import', ?'ehr', ?'csv_import'\)\)/)
})
