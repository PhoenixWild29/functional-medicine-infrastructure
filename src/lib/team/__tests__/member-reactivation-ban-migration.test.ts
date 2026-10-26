/**
 * @jest-environment node
 *
 * L12 (Oct 24 security review): reactivating a team member lifts only the
 * ban deactivation set. Migration 20261024000005 replaces
 * set_clinic_member_active; its behaviour is checked against every
 * migration on PGlite (scripts/security/pglite-check/member-ban.mjs). This
 * pins the text: the old unconditional `banned_until = NULL` is gone, the
 * ban is recorded and compared, the signature and grants are unchanged,
 * and there is a down file.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(process.cwd(), 'supabase', 'migrations')
const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8').replace(/\r\n/g, '\n') : '')
const flat = (s: string) => s.replace(/--.*$/gm, '').replace(/\s+/g, ' ').toLowerCase()
const up = flat(read(join(DIR, '20261024000005_member_reactivation_ban.sql')))
const down = flat(read(join(DIR, 'down', '20261024000005_down.sql')))

it('exists with a down file, one transaction each', () => {
  expect(up).toMatch(/^\s*begin;.*commit;\s*$/)
  expect(down).toMatch(/^\s*begin;.*commit;\s*$/)
})

it('keeps the signature, SECURITY DEFINER, search_path and grants', () => {
  expect(up).toContain('create or replace function set_clinic_member_active( p_clinic_id uuid, p_user_id uuid, p_active boolean, p_actor uuid ) returns jsonb')
  expect(up).toContain('security definer set search_path = public, pg_catalog')
  expect(up).toContain('revoke execute on function set_clinic_member_active(uuid, uuid, boolean, uuid) from public, anon, authenticated')
  expect(up).toContain('grant execute on function set_clinic_member_active(uuid, uuid, boolean, uuid) to service_role')
  expect(up).toContain('pg_advisory_xact_lock')
  expect(up.trim().endsWith('select apply_pharmacy_admin_scope(); commit;')).toBe(true)
})

it('records the ban deactivation sets, and the one it replaced', () => {
  expect(up).toContain("'deactivation_banned_until', v_ban")
  expect(up).toContain("'banned_until_before_deactivation', v_banned")
})

it('reactivation lifts banned_until only while it is still that ban; never unconditionally', () => {
  expect(up).not.toMatch(/banned_until = null,/)
  expect(up).toMatch(/when banned_until is not null and banned_until = v_ours then case when v_before > now\(\) then v_before else null end else banned_until end/)
  // A member deactivated before this migration: deactivated_at + 100 years.
  expect(up).toContain("nullif(v_meta ->> 'deactivated_at', '')::timestamptz + interval '100 years'")
  expect(up).toContain("- 'deactivation_banned_until' - 'banned_until_before_deactivation'")
})

it('the down file restores the 20261021000001 function', () => {
  expect(down).toContain('create or replace function set_clinic_member_active(')
  expect(down).toMatch(/banned_until = null,/)
  expect(down).toContain('grant execute on function set_clinic_member_active(uuid, uuid, boolean, uuid) to service_role')
})
