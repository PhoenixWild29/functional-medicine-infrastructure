/**
 * @jest-environment node
 *
 * Compliance C2: the phi_access_log table.
 *
 * No Postgres runner here (see f3-rls-filter.test.ts): this pins what the
 * SQL must say. The owner runs it on prod after merge.
 *
 *   - append-only: explicit deny policies on UPDATE and DELETE (like
 *     sms_log, order_status_history), the privileges revoked, and a
 *     trigger that refuses UPDATE, DELETE and TRUNCATE for every role,
 *     the service role included (RLS does not bind it);
 *   - INSERT through the service role only;
 *   - only the clinic admin SELECTs, and only their own clinic's rows: a
 *     provider or MA (any clinic) reads nothing directly;
 *   - no PHI columns: ids, a role, keyed hashes, constrained codes;
 *   - indexes for the three questions: by clinic, by patient, by actor.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations')
const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '')
const sql = read(join(MIGRATIONS, '20261007000001_phi_access_log.sql'))
const down = read(join(MIGRATIONS, 'down', '20261007000001_down.sql'))
const flat = (t: string) => t.replace(/--.*$/gm, '').replace(/\s+/g, ' ').toLowerCase()
const code = flat(sql)

it('the migration and its down file exist, each in one transaction', () => {
  expect(sql).not.toBe('')
  expect(down).not.toBe('')
  for (const c of [code, flat(down)]) {
    expect(c).toMatch(/^\s*begin;/)
    expect(c).toMatch(/commit;\s*$/)
  }
})

describe('the table', () => {
  const table = code.slice(code.indexOf('create table if not exists phi_access_log'), code.indexOf(');', code.indexOf('create table if not exists phi_access_log')))

  it('has exactly the agreed columns', () => {
    const cols = [...table.matchAll(/(?:\(|, )\s*([a-z_]+) (uuid|timestamptz|text)\b/g)].map(m => m[1])
    expect(cols).toEqual([
      'id', 'occurred_at', 'actor_user_id', 'actor_role', 'actor_email_hash', 'clinic_id', 'patient_id', 'order_id',
      'action', 'resource', 'route', 'ip_hash', 'user_agent_hash',
    ])
  })

  it('carries no PHI: nothing that could hold a name, DOB, phone, drug or free text', () => {
    expect(table).not.toMatch(/name|birth|dob|phone|email text|medication|drug|note|detail|metadata|jsonb/)
  })

  it('actions are view | create | update | export | print | sign', () => {
    expect(table).toContain("check (action in ('view', 'create', 'update', 'export', 'print', 'sign'))")
  })

  it('resource and route are codes, not free text; the hashes are hex SHA-256', () => {
    expect(table).toContain("check (resource ~ '^[a-z_]{1,40}$')")
    // [A-Za-z0-9_/\[\]-], lower-cased here.
    expect(table).toContain("check (route ~ '^/[a-za-z0-9_/\\[\\]-]{0,200}$')")
    for (const c of ['actor_email_hash', 'ip_hash', 'user_agent_hash']) {
      expect(table).toContain(`${c} text check (${c} is null or ${c} ~ '^[0-9a-f]{64}$')`)
    }
  })

  it('has the three indexes', () => {
    expect(code).toMatch(/create index if not exists \w+ on phi_access_log \(clinic_id, occurred_at( desc)?\)/)
    expect(code).toMatch(/create index if not exists \w+ on phi_access_log \(patient_id, occurred_at( desc)?\)/)
    expect(code).toMatch(/create index if not exists \w+ on phi_access_log \(actor_user_id, occurred_at( desc)?\)/)
  })
})

describe('row level security', () => {
  it('is enabled', () => {
    expect(code).toContain('alter table phi_access_log enable row level security')
  })

  it('only the clinic admin SELECTs, and only their own clinic\'s rows', () => {
    expect(code).toContain(
      "create policy phi_access_log_clinic_admin_select on phi_access_log for select to authenticated using (clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::uuid and (auth.jwt() -> 'user_metadata' ->> 'app_role') = 'clinic_admin')",
    )
    // A provider or MA of the same clinic reads nothing: no policy names them.
    expect(code).not.toContain('phi_access_log_clinic_user_select')
    // No other SELECT policy widens it.
    expect(code.match(/for select/g)).toHaveLength(1)
  })

  it('INSERT only through the service role: denied to authenticated and anon', () => {
    expect(code).toContain('create policy phi_access_log_deny_insert on phi_access_log for insert to authenticated, anon with check (false)')
  })

  it('UPDATE and DELETE denied for everyone: explicit deny policies', () => {
    expect(code).toContain('create policy phi_access_log_deny_update on phi_access_log for update using (false)')
    expect(code).toContain('create policy phi_access_log_deny_delete on phi_access_log for delete using (false)')
  })

  it('and the privileges are revoked', () => {
    expect(code).toContain('revoke insert, update, delete, truncate on phi_access_log from anon, authenticated')
    expect(code).toContain('revoke update, delete, truncate on phi_access_log from service_role')
  })

  it('and a trigger refuses UPDATE, DELETE and TRUNCATE for every role, the service role included', () => {
    expect(code).toMatch(/create or replace function phi_access_log_append_only\(\) returns trigger/)
    expect(code).toContain("raise exception 'phi_access_log is append-only'")
    expect(code).toMatch(/create trigger phi_access_log_no_update_delete before update or delete on phi_access_log for each row execute function phi_access_log_append_only\(\)/)
    expect(code).toMatch(/create trigger phi_access_log_no_truncate before truncate on phi_access_log for each statement execute function phi_access_log_append_only\(\)/)
  })
})

describe('the down migration', () => {
  it('drops the table, its triggers and function', () => {
    const d = flat(down)
    expect(d).toContain('drop table if exists phi_access_log')
    for (const p of ['phi_access_log_clinic_admin_select', 'phi_access_log_deny_insert', 'phi_access_log_deny_update', 'phi_access_log_deny_delete']) {
      expect(d).toContain(`drop policy if exists ${p} on phi_access_log`)
    }
    expect(d).toContain('drop function if exists phi_access_log_append_only()')
  })
})
