/**
 * @jest-environment node
 *
 * Patient protocol choice, PR 1 (docs/design/patient-protocol-choice.md,
 * section 3): the data model migration, 20261024000002 (after the fax PHI
 * column, 20261024000001).
 *   - treatment_proposals, treatment_proposal_options, proposal_choice_items,
 *     treatment_proposal_events; orders.proposal_option_id (FK) and
 *     orders.proposal_required
 *   - RLS on every new table: clinic users of that clinic read, ops_admin
 *     reads, both from app_metadata only; no write policy (service role)
 *   - the events and the choice items are append-only by trigger
 *   - the event list covers how the link reached the patient (copied, QR,
 *     SMS: the plan link never depends on texting)
 *   - SELECT apply_pharmacy_admin_scope(); is the last statement before COMMIT
 *   - a down file that refuses while any proposal exists, then drops it all
 * The new tables are never retention targets.
 */

import fs from 'fs'
import path from 'path'
import { NEVER_RETENTION_TARGETS } from '@/lib/retention/policies'
import { PROPOSAL_EVENTS, PROPOSAL_STATUSES } from '../types'

const ROOT = path.resolve(__dirname, '..', '..', '..', '..')
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations')
const VERSION = '20261024000002'
const TABLES = ['treatment_proposals', 'treatment_proposal_options', 'proposal_choice_items', 'treatment_proposal_events']
const APPEND_ONLY = ['proposal_choice_items', 'treatment_proposal_events']

const statements = (sql: string) => sql.split('\n').filter(l => !/^\s*--/.test(l)).join('\n')
const up = () => {
  const f = fs.readdirSync(MIGRATIONS).filter(n => n.startsWith(`${VERSION}_`))
  expect(f).toHaveLength(1)
  return statements(fs.readFileSync(path.join(MIGRATIONS, f[0]!), 'utf8'))
}
const down = () => statements(fs.readFileSync(path.join(MIGRATIONS, 'down', `${VERSION}_down.sql`), 'utf8'))
const checkList = (sql: string, constraint: string) => {
  const m = new RegExp(`CONSTRAINT ${constraint} CHECK \\(\\w+ IN \\(([^)]*)\\)\\)`).exec(sql)
  expect(m).not.toBeNull()
  return [...m![1]!.matchAll(/'([a-z_]+)'/g)].map(x => x[1])
}

it(`is version ${VERSION}, unique, and has a down file`, () => {
  expect(up()).toBeTruthy()
  expect(fs.existsSync(path.join(MIGRATIONS, 'down', `${VERSION}_down.sql`))).toBe(true)
  const v = fs.readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).map(f => f.split('_')[0]!)
  expect(v.filter((x, i) => v.indexOf(x) !== i)).toEqual([])
})

it('sorts right after 20261024000001 (RLS hardening); later migrations (000003 ... 000009) may follow it', () => {
  const versions = fs.readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).map(f => f.split('_')[0]!).sort()
  const before = versions.filter(v => v < VERSION)
  expect(before[before.length - 1]).toBe('20261024000001')
  expect(versions.filter(v => v === VERSION)).toHaveLength(1)
})

it.each(TABLES)('%s: created, RLS on, reads for its clinic and ops_admin via app_metadata, no write policy', t => {
  const sql = up()
  expect(sql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS (public\\.)?${t}\\b`))
  expect(sql).toMatch(new RegExp(`ALTER TABLE (public\\.)?${t} ENABLE ROW LEVEL SECURITY`))
  const policies = [...sql.matchAll(new RegExp(`CREATE POLICY[^;]*ON (public\\.)?${t}\\b[^;]*;`, 'g'))].map(m => m[0])
  expect(policies.length).toBeGreaterThanOrEqual(2)
  for (const p of policies) {
    expect(p).toMatch(/FOR SELECT TO authenticated/)
    expect(p).toMatch(/app_metadata/)
    expect(p).not.toMatch(/user_metadata/)
  }
  expect(policies.some(p => /'ops_admin'/.test(p))).toBe(true)
  expect(policies.some(p => /app_metadata' ->> 'clinic_id'/.test(p) && /'clinic_admin'/.test(p) && /'provider'/.test(p) && /'medical_assistant'/.test(p))).toBe(true)
  expect(sql).toMatch(new RegExp(`REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON (public\\.)?${t} FROM anon, authenticated`))
})

it('treatment_proposals: the design columns, a status list, a SHA-256 token hash that is unique', () => {
  const sql = up()
  const t = sql.slice(sql.search(/CREATE TABLE IF NOT EXISTS (public\.)?treatment_proposals\b/))
  for (const col of ['proposal_id', 'clinic_id', 'patient_id', 'provider_id', 'created_by', 'status', 'token_hash', 'expires_at', 'sent_at',
    'first_viewed_at', 'chosen_option_id', 'chosen_at', 'signed_at', 'dob_failures', 'locked_at', 'created_at', 'updated_at']) {
    expect(t).toMatch(new RegExp(`\\b${col}\\b`))
  }
  expect(checkList(sql, 'chk_treatment_proposals_status')).toEqual([...PROPOSAL_STATUSES])
  expect(sql).toMatch(/token_hash ~ '\^\[0-9a-f\]\{64\}\$'/)
  expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS \w+ ON treatment_proposals \(token_hash\)/)
  expect(sql).toMatch(/dob_failures\s+INTEGER\s+NOT NULL DEFAULT 0/)
})

it('options: a label of at most 80 characters, a position, an optional protocol', () => {
  const sql = up()
  expect(sql).toMatch(/label\s+TEXT\s+NOT NULL[^,]*char_length\(label\) BETWEEN 1 AND 80/)
  expect(sql).toMatch(/protocol_id\s+UUID\s+REFERENCES protocol_templates\(protocol_id\)/)
  expect(sql).toMatch(/UNIQUE \(proposal_id, position\)/)
  expect(sql).toMatch(/chosen_option_id[\s\S]*REFERENCES treatment_proposal_options\(option_id\)/)
})

it('orders: proposal_option_id (FK) and proposal_required, both nullable and set together', () => {
  const sql = up()
  expect(sql).toMatch(/ALTER TABLE orders[\s\S]*ADD COLUMN IF NOT EXISTS proposal_option_id UUID REFERENCES treatment_proposal_options\(option_id\)/)
  expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS proposal_required BOOLEAN/)
  expect(sql).toMatch(/\(proposal_option_id IS NULL\) = \(proposal_required IS NULL\)/)
})

it('the events: the design list plus how the link reached the patient (copied, QR, SMS), in step with lib/proposals/types', () => {
  const events = checkList(up(), 'chk_treatment_proposal_events_event')
  expect(events).toEqual([...PROPOSAL_EVENTS])
  for (const e of ['sent', 'link_copied', 'qr_shown', 'sms_sent', 'viewed', 'dob_failed', 'chosen', 'rechosen', 'declined', 'signed', 'expired', 'cancelled']) {
    expect(events).toContain(e)
  }
})

it.each(APPEND_ONLY)('%s is append-only by trigger (rows and truncate)', t => {
  const sql = up()
  expect(sql).toMatch(new RegExp(`CREATE TRIGGER \\w+\\s+BEFORE UPDATE OR DELETE ON (public\\.)?${t}\\b`))
  expect(sql).toMatch(new RegExp(`CREATE TRIGGER \\w+\\s+BEFORE TRUNCATE ON (public\\.)?${t}\\b`))
  expect(sql).toMatch(new RegExp(`REVOKE UPDATE, DELETE, TRUNCATE ON (public\\.)?${t} FROM service_role`))
})

it('a proposal is never deleted (no role may delete or truncate it)', () => {
  expect(up()).toMatch(/REVOKE DELETE, TRUNCATE ON (public\.)?treatment_proposals FROM service_role/)
})

it('the last statement before COMMIT is SELECT apply_pharmacy_admin_scope();', () => {
  const body = up().replace(/\s+$/, '')
  expect(body).toMatch(/^BEGIN;/m)
  expect(body).toMatch(/COMMIT;$/)
  const before = body.slice(0, body.lastIndexOf('COMMIT;')).trim().split(/;\s*\n/).filter(Boolean)
  expect(before[before.length - 1]!.trim().replace(/;$/, '')).toBe('SELECT apply_pharmacy_admin_scope()')
})

it('the down file refuses while any proposal exists, then drops the columns and every table', () => {
  const d = down()
  expect(d).toMatch(/SELECT count\(\*\) INTO \w+ FROM treatment_proposals/)
  expect(d).toMatch(/RAISE EXCEPTION/)
  expect(d.indexOf('RAISE EXCEPTION')).toBeLessThan(d.indexOf('DROP TABLE'))
  expect(d).toMatch(/ALTER TABLE orders DROP COLUMN IF EXISTS proposal_option_id/)
  expect(d).toMatch(/ALTER TABLE orders DROP COLUMN IF EXISTS proposal_required/)
  for (const t of TABLES) expect(d).toMatch(new RegExp(`DROP TABLE IF EXISTS (public\\.)?${t}\\b`))
})

it('the new tables are never retention targets', () => {
  for (const t of TABLES) expect(NEVER_RETENTION_TARGETS as readonly string[]).toContain(t)
})
