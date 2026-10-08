/**
 * @jest-environment node
 *
 * Compliance C10, retention PR 1: the database side.
 *
 * No Postgres runner here (see phi-access-log-migration.test.ts): this pins
 * what the SQL must say. The owner runs it on each database after merge.
 *
 *   - retention_runs: one row per policy per run, append-only for every
 *     role (privileges revoked and triggers, like phi_access_log);
 *   - legal_holds: a clinic or a patient exempt from every retention job;
 *     a hold is released, never edited or deleted;
 *   - epcs_audit_log becomes append-only. The one change let through is
 *     the ON DELETE SET NULL of order_id (an unsigned draft deleted);
 *     new rows carry keyed hashes of the IP and user agent;
 *   - a signed order (locked_at set) cannot be deleted by any role;
 *   - indexes for the retention age scans;
 *   - nothing in it deletes, updates or truncates data, and it never
 *     touches phi_access_log.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations')
const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '')
const sql = read(join(MIGRATIONS, '20261011000001_retention_foundations.sql'))
const down = read(join(MIGRATIONS, 'down', '20261011000001_down.sql'))
const flat = (t: string) => t.replace(/--.*$/gm, '').replace(/\s+/g, ' ').toLowerCase()
const code = flat(sql)

/** The text of one CREATE TABLE statement. */
function table(name: string): string {
  const start = code.indexOf(`create table if not exists ${name} (`)
  return start < 0 ? '' : code.slice(start, code.indexOf(');', start))
}

it('the migration and its down file exist, each in one transaction', () => {
  expect(sql).not.toBe('')
  expect(down).not.toBe('')
  for (const c of [code, flat(down)]) {
    expect(c).toMatch(/^\s*begin;/)
    expect(c).toMatch(/commit;\s*$/)
  }
})

it('deletes, updates and truncates no data, and never touches phi_access_log', () => {
  // Statements only: "before truncate on", "on delete set null" are not data changes.
  expect(code).not.toMatch(/(^|;)\s*delete from\b/)
  expect(code).not.toMatch(/(^|;)\s*truncate\b/)
  expect(code).not.toMatch(/(^|;)\s*update [a-z_]+ set\b/)
  expect(code).not.toContain('phi_access_log')
  expect(flat(down)).not.toContain('phi_access_log')
})

describe('retention_runs', () => {
  const t = table('retention_runs')
  it('records the policy, the mode, the cutoff and the counts; no row contents', () => {
    expect(t).not.toBe('')
    for (const col of ['run_id uuid not null', 'policy text not null', 'mode text not null', 'cutoff timestamptz not null', 'rows_matched integer not null', 'rows_affected integer not null', 'oldest_at timestamptz', 'newest_at timestamptz', 'error text', 'started_at timestamptz not null', 'finished_at timestamptz not null']) {
      expect(t).toContain(col)
    }
    expect(t).toMatch(/mode in \('dry_run', ?'live'\)/)
    // A dry run affects nothing.
    expect(t).toMatch(/mode = 'live' or rows_affected = 0/)
    expect(t).not.toMatch(/patient_id|order_id|payload/)
  })

  it('is append-only for every role, the service role included', () => {
    expect(code).toContain('alter table retention_runs enable row level security')
    expect(code).toContain('revoke insert, update, delete, truncate on retention_runs from anon, authenticated')
    expect(code).toContain('revoke update, delete, truncate on retention_runs from service_role')
    expect(code).toMatch(/create trigger retention_runs_no_update_delete before update or delete on retention_runs for each row execute function retention_append_only\(\)/)
    expect(code).toMatch(/create trigger retention_runs_no_truncate before truncate on retention_runs for each statement execute function retention_append_only\(\)/)
  })
})

describe('legal_holds', () => {
  const t = table('legal_holds')
  it('a clinic or a patient, with a reason and who set it; released, never deleted', () => {
    expect(t).not.toBe('')
    expect(t).toMatch(/scope in \('clinic', ?'patient'\)/)
    for (const col of ['target_id uuid not null', 'reason text not null', 'set_by text not null', 'set_at timestamptz not null', 'released_at timestamptz', 'released_by text']) {
      expect(t).toContain(col)
    }
    expect(code).toContain('alter table legal_holds enable row level security')
    expect(code).toContain('revoke insert, update, delete, truncate on legal_holds from anon, authenticated')
    expect(code).toContain('revoke delete, truncate on legal_holds from service_role')
    expect(code).toMatch(/create trigger legal_holds_release_only before update or delete on legal_holds/)
    expect(code).toMatch(/create trigger legal_holds_no_truncate before truncate on legal_holds/)
  })

  it('an update may only release a hold that is not yet released', () => {
    const fn = code.slice(code.indexOf('create or replace function legal_holds_release_only()'), code.indexOf('$$;', code.indexOf('create or replace function legal_holds_release_only()')))
    expect(fn).toContain("tg_op = 'delete'")
    expect(fn).toContain('old.released_at is null')
    expect(fn).toContain('new.released_at is not null')
    expect(fn).toMatch(/\(to_jsonb\(new\) - 'released_at' - 'released_by'\) = \(to_jsonb\(old\) - 'released_at' - 'released_by'\)/)
  })
})

describe('epcs_audit_log', () => {
  it('is append-only, except the ON DELETE SET NULL of order_id', () => {
    const fn = code.slice(code.indexOf('create or replace function epcs_audit_log_append_only()'), code.indexOf('$$;', code.indexOf('create or replace function epcs_audit_log_append_only()')))
    expect(fn).toContain("tg_op = 'update'")
    expect(fn).toContain('old.order_id is not null and new.order_id is null')
    expect(fn).toMatch(/\(to_jsonb\(new\) - 'order_id'\) = \(to_jsonb\(old\) - 'order_id'\)/)
    expect(fn).toContain("raise exception 'epcs_audit_log is append-only")
    expect(code).toMatch(/create trigger epcs_audit_log_no_update_delete before update or delete on epcs_audit_log for each row execute function epcs_audit_log_append_only\(\)/)
    expect(code).toMatch(/create trigger epcs_audit_log_no_truncate before truncate on epcs_audit_log for each statement execute function epcs_audit_log_append_only\(\)/)
    expect(code).toContain('revoke update, delete, truncate on epcs_audit_log from anon, authenticated, service_role')
  })

  it('new rows carry keyed hashes of the IP and user agent (64 hex), the raw columns stay for old rows', () => {
    expect(code).toMatch(/alter table epcs_audit_log add column if not exists ip_hash text/)
    expect(code).toMatch(/alter table epcs_audit_log add column if not exists user_agent_hash text/)
    expect(code).toMatch(/ip_hash is null or ip_hash ~ '\^\[0-9a-f\]\{64\}\$'/)
    expect(code).toMatch(/user_agent_hash is null or user_agent_hash ~ '\^\[0-9a-f\]\{64\}\$'/)
    expect(code).not.toMatch(/drop column (if exists )?(ip_address|user_agent)\b/)
  })
})

describe('signed orders', () => {
  it('a row with locked_at set cannot be deleted by any role; orders cannot be truncated', () => {
    expect(code).toMatch(/create trigger orders_no_delete_signed before delete on orders for each row when \(old\.locked_at is not null\) execute function orders_refuse_signed_delete\(\)/)
    expect(code).toMatch(/create trigger orders_no_truncate before truncate on orders for each statement execute function orders_refuse_signed_delete\(\)/)
    expect(code).toContain("raise exception 'a signed order cannot be deleted")
  })
})

it('indexes for the age scans', () => {
  expect(code).toMatch(/create index if not exists idx_webhook_events_processed_at on webhook_events \(processed_at\)/)
  expect(code).toMatch(/create index if not exists idx_pharmacy_webhook_events_processed_at on pharmacy_webhook_events \(processed_at\)/)
  expect(code).toMatch(/create index if not exists idx_sms_log_created_at on sms_log \(created_at\)/)
  expect(code).toMatch(/create index if not exists idx_orders_draft_updated_at on orders \(updated_at\) where status = 'draft' and locked_at is null/)
})

it('the down file removes what this adds and nothing else', () => {
  const d = flat(down)
  for (const s of [
    'drop table if exists retention_runs', 'drop table if exists legal_holds',
    'drop trigger if exists epcs_audit_log_no_update_delete on epcs_audit_log', 'drop trigger if exists epcs_audit_log_no_truncate on epcs_audit_log',
    'drop trigger if exists orders_no_delete_signed on orders', 'drop trigger if exists orders_no_truncate on orders',
    'drop index if exists idx_orders_draft_updated_at',
  ]) expect(d).toContain(s)
  expect(d).not.toMatch(/drop table if exists (orders|epcs_audit_log)\b/)
})
