/**
 * @jest-environment node
 *
 * Self sign-up: the one migration (20261020000001).
 *
 * No Postgres runner here, so this pins what the SQL must say: small and
 * additive. Where a clinic or a pharmacy application came from
 * (signup_source: invite | self_serve), and for a clinic what kind signed
 * up (signup_kind: clinic | solo_provider); 'self_signup' joins the
 * clinic onboarding event log's allowed events. No new table; no row
 * deleted. apply_pharmacy_admin_scope() last before COMMIT.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(process.cwd(), 'supabase', 'migrations')
const FILE = '20261020000001_self_serve_signup.sql'
const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8').replace(/\r\n/g, '\n') : '')
const flat = (s: string) => s.replace(/--.*$/gm, '').replace(/\s+/g, ' ').toLowerCase()
const code = flat(read(join(DIR, FILE)))
const down = flat(read(join(DIR, 'down', '20261020000001_down.sql')))

it('exists with a down migration, one transaction, sorting after 20261018000001', () => {
  expect(code).toMatch(/^\s*begin;/)
  expect(code).toMatch(/commit;\s*$/)
  expect(down).toMatch(/^\s*begin;.*commit;\s*$/)
  expect(FILE > '20261018000001_~').toBe(true)
})

it('ends with SELECT apply_pharmacy_admin_scope(); right before COMMIT', () => {
  expect(code).toMatch(/select apply_pharmacy_admin_scope\(\); commit;\s*$/)
})

it('records where a clinic came from and what kind signed up', () => {
  expect(code).toContain('alter table clinics add column if not exists signup_source text')
  expect(code).toContain("signup_source is null or signup_source in ('invite', 'self_serve')")
  expect(code).toContain('alter table clinics add column if not exists signup_kind text')
  expect(code).toContain("signup_kind is null or signup_kind in ('clinic', 'solo_provider')")
  // A kind only for a self sign-up.
  expect(code).toContain("signup_kind is null or signup_source = 'self_serve'")
})

it('records where a pharmacy application came from', () => {
  expect(code).toContain('alter table pharmacy_onboarding_applications add column if not exists signup_source text')
  expect(code).toContain("signup_source is null or signup_source in ('invite', 'self_serve')")
})

it("adds 'self_signup' to the clinic onboarding events, keeping every existing event", () => {
  expect(code).toContain('drop constraint if exists chk_onboarding_events_event')
  for (const e of ['invite_created', 'invite_revoked', 'invite_resent', 'invite_accepted', 'submitted', 'approved', 'sent_back', 'self_signup']) {
    expect(code).toContain(`'${e}'`)
  }
})

it('is additive: no table created or dropped, no row deleted or updated', () => {
  expect(code).not.toMatch(/create table|drop table|drop column|delete from|update \w+ set/)
})

it('the down migration removes the columns and restores the old event list', () => {
  expect(down).toContain('drop column if exists signup_source')
  expect(down).toContain('drop column if exists signup_kind')
  expect(down).toContain('chk_onboarding_events_event')
  expect(down).not.toContain("'self_signup'")
})
