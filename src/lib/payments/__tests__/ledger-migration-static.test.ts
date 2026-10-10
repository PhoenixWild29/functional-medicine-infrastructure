/**
 * @jest-environment node
 *
 * Payments ledger migration (20261016000001, after A's 20261015000001):
 *   - four tables: ledger_entries, pharmacy_payables, payable_events,
 *     reconciliation_runs
 *   - RLS on each; reads for ops_admin via app_metadata only; no write
 *     policy (service-role writes)
 *   - append-only triggers on the ledger, the payable audit log and the
 *     reconciliation runs
 *   - the ledger is idempotent on (source_event_id, line_key)
 *   - ends with apply_pharmacy_admin_scope() when that function exists
 *   - ships with a down file that drops what it adds
 * The new tables are never retention targets.
 */

import fs from 'fs'
import path from 'path'
import { NEVER_RETENTION_TARGETS } from '@/lib/retention/policies'

const ROOT = path.resolve(__dirname, '..', '..', '..', '..')
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations')
const VERSION = '20261016000001'
const TABLES = ['ledger_entries', 'pharmacy_payables', 'payable_events', 'reconciliation_runs']
const APPEND_ONLY = ['ledger_entries', 'payable_events', 'reconciliation_runs']

const statements = (sql: string) => sql.split('\n').filter(l => !/^\s*--/.test(l)).join('\n')
const up = () => {
  const f = fs.readdirSync(MIGRATIONS).filter(n => n.startsWith(`${VERSION}_`))
  expect(f).toHaveLength(1)
  return statements(fs.readFileSync(path.join(MIGRATIONS, f[0]!), 'utf8'))
}
const down = () => statements(fs.readFileSync(path.join(MIGRATIONS, 'down', `${VERSION}_down.sql`), 'utf8'))

it(`is version ${VERSION} and has a down file`, () => {
  expect(fs.existsSync(path.join(MIGRATIONS, 'down', `${VERSION}_down.sql`))).toBe(true)
  expect(up()).toBeTruthy()
})

it('no two migrations share a version', () => {
  const v = fs.readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).map(f => f.split('_')[0]!)
  expect(v.filter((x, i) => v.indexOf(x) !== i)).toEqual([])
})

it.each(TABLES)('%s: created, RLS on, ops-only reads via app_metadata, no write policy', t => {
  const sql = up()
  expect(sql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS (public\\.)?${t}\\b`))
  expect(sql).toMatch(new RegExp(`ALTER TABLE (public\\.)?${t} ENABLE ROW LEVEL SECURITY`))
  const policies = [...sql.matchAll(new RegExp(`CREATE POLICY[^;]*ON (public\\.)?${t}\\b[^;]*;`, 'g'))].map(m => m[0])
  expect(policies.length).toBeGreaterThan(0)
  for (const p of policies) {
    expect(p).toMatch(/FOR SELECT/)
    expect(p).toMatch(/app_metadata/)
    expect(p).toMatch(/ops_admin/)
    expect(p).not.toMatch(/user_metadata/)
  }
})

it('the ledger records party, amount, currency, type, Stripe object id, status and time', () => {
  const sql = up()
  const ledger = sql.slice(sql.search(/CREATE TABLE IF NOT EXISTS (public\.)?ledger_entries/))
  for (const col of ['party', 'amount_cents', 'currency', 'entry_type', 'stripe_object_id', 'status', 'created_at', 'source_event_id', 'line_key', 'order_id', 'payment_group_id']) {
    expect(ledger).toMatch(new RegExp(`\\b${col}\\b`))
  }
  for (const t of ['charge', 'platform_fee', 'clinic_transfer', 'pharmacy_payable', 'refund', 'dispute', 'reversal']) expect(ledger).toContain(`'${t}'`)
  for (const p of ['platform', 'clinic', 'pharmacy']) expect(ledger).toContain(`'${p}'`)
  expect(sql).toMatch(/UNIQUE\s*\(\s*source_event_id\s*,\s*line_key\s*\)/)
})

it('payables carry owed / scheduled / paid / void, one per order', () => {
  const sql = up()
  for (const s of ['owed', 'scheduled', 'paid', 'void']) expect(sql).toContain(`'${s}'`)
  expect(sql).toMatch(/pharmacy_payables[\s\S]*order_id\s+UUID\s+NOT NULL UNIQUE/)
})

it.each(APPEND_ONLY)('%s is append-only by trigger', t => {
  expect(up()).toMatch(new RegExp(`CREATE TRIGGER \\w+\\s+BEFORE UPDATE OR DELETE ON (public\\.)?${t}\\b`))
})

it('ends by applying the pharmacy admin scope when it exists', () => {
  const sql = up().trimEnd()
  const tail = sql.slice(sql.lastIndexOf('DO $$'))
  expect(tail).toMatch(/apply_pharmacy_admin_scope\(\)/)
})

it('the down file drops every table it adds', () => {
  for (const t of TABLES) expect(down()).toMatch(new RegExp(`DROP TABLE IF EXISTS (public\\.)?${t}\\b`))
})

it('the new tables are never retention targets', () => {
  for (const t of TABLES) expect(NEVER_RETENTION_TARGETS as readonly string[]).toContain(t)
})
