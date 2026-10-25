/**
 * @jest-environment node
 *
 * Sign-up squatting (M3): migration 20261024000006. The SQL ran on PGlite
 * (see the commit report); this pins what it must say.
 *
 *   - providers.npi_claimed, NOT NULL DEFAULT true; providers of clinics
 *     not approved are set unclaimed;
 *   - providers_npi_number_unique only over live CLAIMED rows (pending
 *     sign-ups may share an NPI; approval claims it), plus a plain index;
 *   - 'signup_deleted' joins the clinic onboarding events;
 *   - the down file refuses while it cannot hold, then restores both.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(process.cwd(), 'supabase', 'migrations')
const FILE = '20261024000006_npi_claimed_signup_deleted.sql'
const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8').replace(/\r\n/g, '\n') : '')
const flat = (s: string) => s.replace(/--.*$/gm, '').replace(/\s+/g, ' ').toLowerCase()
const code = flat(read(join(DIR, FILE)))
const down = flat(read(join(DIR, 'down', '20261024000006_down.sql')))

it('exists with a down migration, one transaction, the newest version, unique', () => {
  expect(code).toMatch(/^\s*begin;/)
  expect(code).toMatch(/select apply_pharmacy_admin_scope\(\); commit;\s*$/)
  expect(down).toMatch(/^\s*begin;.*commit;\s*$/)
  const versions = readdirSync(DIR).filter(f => /^\d{14}_.*\.sql$/.test(f)).map(f => f.slice(0, 14))
  expect(versions.filter(v => v === '20261024000006')).toHaveLength(1)
  // Numbered after A's 20261024000005 (L12) and after main's 20261024000002;
  // later migrations may follow it.
  const sorted = [...versions].sort()
  expect(sorted.indexOf('20261024000006')).toBeGreaterThan(sorted.indexOf('20261024000002'))
})

it('npi_claimed: not null, default true; providers of clinics not approved start unclaimed', () => {
  expect(code).toContain('alter table providers add column if not exists npi_claimed boolean not null default true')
  expect(code).toMatch(/update providers p set npi_claimed = false from clinics c where p\.clinic_id = c\.clinic_id and c\.onboarding_status is distinct from 'approved'/)
})

it('the NPI is unique among live claimed providers only', () => {
  expect(code).toContain('drop index if exists providers_npi_number_unique')
  expect(code).toContain('create unique index if not exists providers_npi_number_unique on providers (npi_number) where deleted_at is null and npi_claimed')
  expect(code).toContain('create index if not exists idx_providers_npi_number_live on providers (npi_number) where deleted_at is null')
})

it("'signup_deleted' joins the clinic onboarding events, keeping every earlier one", () => {
  for (const e of ['invite_created', 'invite_revoked', 'invite_resent', 'invite_accepted', 'submitted', 'approved', 'sent_back', 'self_signup', 'member_deactivated', 'member_reactivated', 'signup_deleted']) {
    expect(code).toContain(`'${e}'`)
  }
})

it('down: refuses while live providers share an NPI or a signup_deleted event exists, then restores', () => {
  expect(down).toMatch(/group by npi_number having count\(\*\) > 1/)
  expect(down).toMatch(/event = 'signup_deleted'/)
  expect(down).toContain('create unique index providers_npi_number_unique on providers (npi_number) where deleted_at is null;')
  expect(down).toContain('alter table providers drop column if exists npi_claimed')
  expect(down).not.toContain("'signup_deleted' )")
})
