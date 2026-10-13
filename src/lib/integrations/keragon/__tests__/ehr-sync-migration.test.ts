/**
 * @jest-environment node
 *
 * Patient Intake v1.1 PR 5b: the one migration (20261017000001).
 *
 * No Postgres runner here, so this pins what the SQL must say (as
 * self-intake-migration.test.ts does): small and additive; RLS on every
 * new table with the clinic from app_metadata, never user_metadata; anon
 * revoked, only the service role writes; the shared secret only as a
 * Vault id; replay refused by a unique (connection, event id); no PHI
 * column in the sync log; numbered after D's 20261016000001; and it ends
 * with apply_pharmacy_admin_scope() before COMMIT.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations')
const FILE = '20261017000001_ehr_sync_keragon.sql'
const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8').replace(/\r\n/g, '\n') : '')
const sql = read(join(MIGRATIONS, FILE))
const down = read(join(MIGRATIONS, 'down', '20261017000001_down.sql'))
const flat = (s: string) => s.replace(/--.*$/gm, '').replace(/\s+/g, ' ').toLowerCase()
const code = flat(sql)
const NEW_TABLES = ['ehr_connections', 'patient_external_ids', 'ehr_sync_events', 'patient_field_changes']

const tableBody = (t: string) => {
  const start = code.indexOf(`create table if not exists ${t} (`)
  return start < 0 ? '' : code.slice(start, code.indexOf(');', start))
}

it('exists with a down migration; one transaction; numbered 20261017000001', () => {
  expect(sql).not.toBe('')
  expect(down).not.toBe('')
  expect(code).toMatch(/^\s*begin;/)
  expect(code).toMatch(/commit;\s*$/)
  expect(flat(down)).toMatch(/^\s*begin;.*commit;\s*$/)
  expect(FILE > '20261016000001_~').toBe(true)
})

it('is additive: creates its own tables, alters and drops nothing that exists, deletes or updates no rows', () => {
  expect(code).not.toMatch(/\balter table (?!ehr_connections|patient_external_ids|ehr_sync_events|patient_field_changes)/)
  expect(code).not.toMatch(/\bdrop table\b/)
  expect(code).not.toMatch(/\bdrop column\b/)
  // Function bodies ($$ ... $$) are not run by the migration itself.
  expect(code.replace(/\$\$.*?\$\$/g, '')).not.toMatch(/\bdelete from\b|\bupdate \w+ set\b/)
  for (const t of NEW_TABLES) expect(tableBody(t)).not.toBe('')
})

it('ends with SELECT apply_pharmacy_admin_scope(); right before COMMIT', () => {
  expect(code).toMatch(/select apply_pharmacy_admin_scope\(\); commit;\s*$/)
})

describe('row level security', () => {
  it.each(NEW_TABLES)('%s: RLS on, anon revoked, writes revoked from authenticated', t => {
    expect(code).toContain(`alter table ${t} enable row level security`)
    expect(code).toMatch(new RegExp(`revoke all on [a-z_, ]*\\b${t}\\b[a-z_, ]* from anon`))
    expect(code).toMatch(new RegExp(`revoke insert, update, delete, truncate on [a-z_, ]*\\b${t}\\b[a-z_, ]* from authenticated`))
    expect(code).toMatch(new RegExp(`create policy \\w+ on ${t} for select to authenticated`))
  })

  it('no INSERT, UPDATE or DELETE policy: only the service role writes', () => {
    expect(code).not.toMatch(/create policy \w+ on \w+ for (insert|update|delete|all)/)
  })

  it('reads the clinic and role from app_metadata, never user_metadata', () => {
    expect(code).toContain("(auth.jwt() -> 'app_metadata' ->> 'clinic_id')::uuid")
    expect(code).not.toContain('user_metadata')
  })

  it('connections and the sync log: the clinic admin of the clinic, and ops', () => {
    for (const t of ['ehr_connections', 'ehr_sync_events']) {
      const policies = code.match(new RegExp(`create policy \\w+ on ${t} for select to authenticated using \\(([^;]+)\\);`, 'g'))!.join(' ')
      expect(policies).toContain("'app_role') = 'clinic_admin' and clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::uuid")
      expect(policies).toContain("'app_role') = 'ops_admin'")
    }
  })
})

describe('what is stored', () => {
  it('the shared secret only as a Vault id', () => {
    const t = tableBody('ehr_connections')
    expect(t).toContain('secret_vault_id uuid')
    expect(t).not.toMatch(/\bsecret text\b|shared_secret|secret_hash/)
  })

  it('one connection per clinic and provider', () => {
    expect(tableBody('ehr_connections')).toContain('unique (clinic_id, provider)')
  })

  it('external ids unique per clinic and system, and one per patient and system', () => {
    const t = tableBody('patient_external_ids')
    expect(t).toContain('unique (clinic_id, system, external_patient_id)')
    expect(t).toContain('unique (patient_id, system)')
  })

  it('a replayed event id on a connection is refused (unique)', () => {
    expect(code).toMatch(/create unique index if not exists \w+ on ehr_sync_events \(connection_id, event_id\)/)
  })

  it('the sync log has the five outcomes and no PHI columns', () => {
    const t = tableBody('ehr_sync_events')
    expect(t).toContain("status in ('received', 'applied', 'skipped', 'flagged', 'error')")
    expect(t).not.toMatch(/first_name|last_name|date_of_birth|phone|email|address|allerg|payload/)
  })
})
