/**
 * @jest-environment node
 *
 * Compliance C4: provider_state_licenses and provider_npi_verifications.
 *
 * No Postgres runner here (see f3-rls-filter.test.ts): this pins what the
 * SQL must say. The owner runs it on prod after merge.
 *
 *   - one license per provider per state, with number, expiry, who
 *     verified it, when, and from what source;
 *   - one NPI verification per provider: the NPI checked, the result, the
 *     name match, the taxonomy; verified_at set exactly when verified;
 *   - RLS: clinic users read their own clinic's providers' rows; only the
 *     clinic admin of that clinic writes;
 *   - no PHI columns;
 *   - demo providers licensed in the demo patients' states, so the demo
 *     keeps signing, and only where those providers exist.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations')
const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '')
const sql = read(join(MIGRATIONS, '20261008000001_prescriber_verification.sql'))
const down = read(join(MIGRATIONS, 'down', '20261008000001_down.sql'))
const flat = (t: string) => t.replace(/--.*$/gm, '').replace(/\s+/g, ' ').toLowerCase()
const code = flat(sql)

function tableBody(name: string): string {
  const start = code.indexOf(`create table if not exists ${name}`)
  return start < 0 ? '' : code.slice(start, code.indexOf(');', start))
}
const columns = (body: string) => [...body.matchAll(/(?:\(|, )\s*([a-z_]+) (uuid|text|char\(2\)|date|timestamptz|boolean)(?=[ ,)])/g)].map(m => m[1])

const CLINIC_OF_JWT = "(select provider_id from providers where clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::uuid)"
const IS_ADMIN = "(auth.jwt() -> 'user_metadata' ->> 'app_role') = 'clinic_admin'"

it('the migration and its down file exist, each in one transaction', () => {
  expect(sql).not.toBe('')
  expect(down).not.toBe('')
  for (const c of [code, flat(down)]) {
    expect(c).toMatch(/^\s*begin;/)
    expect(c).toMatch(/commit;\s*$/)
  }
})

describe('provider_state_licenses', () => {
  const t = tableBody('provider_state_licenses')

  it('has the agreed columns', () => {
    expect(columns(t)).toEqual([
      'license_id', 'provider_id', 'state', 'license_number', 'expires_on', 'verified_at', 'verified_by', 'source', 'created_at', 'updated_at',
    ])
  })

  it('one license per provider per state; deleted with the provider', () => {
    expect(t).toContain('unique (provider_id, state)')
    expect(t).toContain('references providers(provider_id) on delete cascade')
  })

  it('state is a two-letter code, the number a constrained token, the expiry required', () => {
    expect(t).toContain("check (state ~ '^[a-z]{2}$')")
    expect(t).toContain("check (license_number ~ '^[a-za-z0-9][a-za-z0-9 ./-]{0,39}$')")
    expect(t).toContain('expires_on date not null')
  })

  it('source is manual | state_board | import | demo_seed', () => {
    expect(t).toContain("check (source in ('manual', 'state_board', 'import', 'demo_seed'))")
  })
})

describe('provider_npi_verifications', () => {
  const t = tableBody('provider_npi_verifications')

  it('has the agreed columns, one row per provider', () => {
    expect(columns(t)).toEqual([
      'provider_id', 'npi', 'status', 'name_match', 'enumeration_type', 'taxonomy_code', 'taxonomy_desc',
      'registry_first_name', 'registry_last_name', 'reason', 'checked_at', 'checked_by', 'verified_at', 'source',
    ])
    expect(t).toContain('provider_id uuid not null primary key references providers(provider_id) on delete cascade')
  })

  it('statuses match the app; verified_at is set exactly when verified', () => {
    expect(t).toContain("check (status in ('verified', 'mismatch', 'not_found', 'unverified', 'invalid'))")
    expect(t).toContain("check ((status = 'verified') = (verified_at is not null))")
  })

  it('the NPI is ten digits; the enumeration type is NPI-1 or NPI-2', () => {
    expect(t).toContain("check (npi ~ '^[0-9]{10}$')")
    expect(t).toContain("enumeration_type in ('npi-1', 'npi-2')")
  })
})

it('carries no PHI: provider credentials only, no patient columns', () => {
  for (const t of [tableBody('provider_state_licenses'), tableBody('provider_npi_verifications')]) {
    expect(t).not.toMatch(/patient|birth|dob|phone|email|address|medication|jsonb/)
  }
})

describe('row level security', () => {
  it.each(['provider_state_licenses', 'provider_npi_verifications'])('%s: enabled; the clinic reads, only its admin writes', table => {
    expect(code).toContain(`alter table ${table} enable row level security;`)

    const select = code.slice(code.indexOf(`create policy ${table}_clinic_select`), code.indexOf(';', code.indexOf(`create policy ${table}_clinic_select`)))
    expect(select).toContain('for select to authenticated')
    expect(select).toContain(`using (provider_id in ${CLINIC_OF_JWT})`)

    const write = code.slice(code.indexOf(`create policy ${table}_admin_write`), code.indexOf(';', code.indexOf(`create policy ${table}_admin_write`)))
    expect(write).toContain('for all to authenticated')
    expect(write).toContain(`using (${IS_ADMIN} and provider_id in ${CLINIC_OF_JWT})`)
    expect(write).toContain(`with check (${IS_ADMIN} and provider_id in ${CLINIC_OF_JWT})`)

    // Only those two policies: nothing else opens the table.
    expect(code.match(new RegExp(`create policy \\w+ on ${table}\\b`, 'g'))).toHaveLength(2)
  })

  it('the policies can be re-run', () => {
    for (const p of ['provider_state_licenses_clinic_select', 'provider_state_licenses_admin_write', 'provider_npi_verifications_clinic_select', 'provider_npi_verifications_admin_write']) {
      expect(code.indexOf(`drop policy if exists ${p}`)).toBeGreaterThan(-1)
      expect(code.indexOf(`drop policy if exists ${p}`)).toBeLessThan(code.indexOf(`create policy ${p}`))
    }
  })
})

describe('demo credentials', () => {
  const SUNRISE = 'a1000000-0000-0000-0000-000000000001'
  const BLUE_CEDAR = 'a1000000-0000-0000-0000-000000000003'

  it('Sunrise providers Chen, Patel, Rodriguez and Fletcher: every Sunrise demo patient state', () => {
    for (const id of ['01', '03', '04', '05']) expect(code).toContain(`('a2000000-0000-0000-0000-0000000000${id}'::uuid)`)
    expect(code).toContain("(values ('tx'), ('ca'), ('ny'), ('fl'), ('wa'), ('co'), ('az'), ('il'), ('ga')) as s(state)")
    expect(code).toContain(`where p.clinic_id = '${SUNRISE}'`)
  })

  it('Blue Cedar provider Osei: NM', () => {
    expect(code).toContain("'nm', 'demo-nm-'")
    expect(code).toContain(`p.provider_id = 'a2000000-0000-0000-0000-000000000006' and p.clinic_id = '${BLUE_CEDAR}'`)
  })

  it('demo rows are marked demo_seed, never overwrite real ones, and say the NPI was not checked', () => {
    expect(code.match(/'demo_seed'/g)!.length).toBeGreaterThanOrEqual(3)
    expect(code.match(/on conflict \(provider_id, state\) do nothing/g)).toHaveLength(2)
    expect(code).toContain('on conflict (provider_id) do nothing')
    expect(code).toContain("'demo provider: fictional npi, not checked against nppes.'")
  })
})

it('the down file drops the policies, the trigger and both tables', () => {
  const d = flat(down)
  for (const p of ['provider_npi_verifications_admin_write', 'provider_npi_verifications_clinic_select', 'provider_state_licenses_admin_write', 'provider_state_licenses_clinic_select']) {
    expect(d).toContain(`drop policy if exists ${p}`)
  }
  expect(d).toContain('drop trigger if exists set_updated_at_provider_state_licenses on provider_state_licenses')
  expect(d).toContain('drop table if exists provider_npi_verifications;')
  expect(d).toContain('drop table if exists provider_state_licenses;')
})
