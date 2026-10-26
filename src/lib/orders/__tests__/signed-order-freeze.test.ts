/**
 * @jest-environment node
 *
 * HIPAA B5: once an order is signed (locked_at set), every clinical column
 * the signature binding covers, and the snapshot, identity and signature
 * columns, cannot change. prevent_snapshot_mutation in
 * 20261024000010_signed_order_freeze.sql enforces it; this test holds the
 * migration to the one list in code (lib/orders/signed-order-freeze, built
 * from lib/orders/signature-binding), checks the single exception (the ops
 * reroute's pharmacy_id), the down migration, and scans the app for any
 * update that would now be refused on a signed order.
 *
 * No Postgres here (see consent-intake-migration.test.ts): the SQL is
 * pinned statically. The trigger was also run against a local PGlite with
 * every migration applied (report in the commit).
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  FROZEN_ORDER_COLUMNS,
  REROUTE_FROM_STATUSES,
  REROUTE_MUTABLE_COLUMNS,
  SIGNED_ORDER_FROZEN_MESSAGE,
} from '../signed-order-freeze'
import { SIGNED_CONTENT_COLUMNS, SIGNED_ORDER_COLUMNS } from '../signature-binding'

const ROOT = process.cwd()
const MIGRATIONS = join(ROOT, 'supabase', 'migrations')
const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '')
const sql = read(join(MIGRATIONS, '20261024000010_signed_order_freeze.sql'))
const down = read(join(MIGRATIONS, 'down', '20261024000010_down.sql'))
const code = (s: string) => s.replace(/--.*$/gm, '').replace(/\s+/g, ' ').trim()

function functionBody(text: string): string {
  const start = text.search(/CREATE OR REPLACE FUNCTION prevent_snapshot_mutation\(\)/i)
  if (start < 0) return ''
  const end = text.indexOf('$$ LANGUAGE plpgsql', start)
  return text.slice(start, end < 0 ? undefined : end)
}

/** The frozen ARRAY[...] of the new function. */
function frozenArray(body: string): string[] {
  const m = /frozen\s+CONSTANT\s+text\[\]\s*:=\s*ARRAY\[([\s\S]*?)\]/i.exec(body)
  return m ? [...m[1]!.matchAll(/'([a-z0-9_]+)'/g)].map(x => x[1]!) : []
}

/** The old style: NEW.<col> IS DISTINCT FROM OLD.<col>. */
function distinctColumns(body: string): string[] {
  return [...body.matchAll(/NEW\.(\w+)\s+IS DISTINCT FROM OLD\.(\w+)/gi)].filter(m => m[1] === m[2]).map(m => m[1]!)
}

describe('the shared list', () => {
  it('the clinical columns are exactly the ones the signature binding covers', () => {
    expect([...SIGNED_CONTENT_COLUMNS]).toEqual([
      'patient_id', 'provider_npi_snapshot', 'pharmacy_snapshot', 'medication_snapshot', 'sig_mode', 'sig_text',
      'titration_steps', 'cycle_on_days', 'cycle_off_days', 'quantity', 'dispense_quantity', 'dispense_unit',
      'days_supply', 'refills', 'package_id', 'package_label', 'package_count', 'syringe_option',
      'substitution_allowed', 'shipping_type', 'clinical_difference', 'diagnosis_code', 'diagnosis_text',
      'special_instructions',
    ])
    for (const c of SIGNED_CONTENT_COLUMNS) expect(SIGNED_ORDER_COLUMNS.split(', ')).toContain(c)
    for (const c of SIGNED_CONTENT_COLUMNS) expect(FROZEN_ORDER_COLUMNS).toContain(c)
  })

  it('has no duplicates, and every column exists on orders', () => {
    expect(new Set(FROZEN_ORDER_COLUMNS).size).toBe(FROZEN_ORDER_COLUMNS.length)
    const types = read(join(ROOT, 'src', 'types', 'database.types.ts'))
    const ordersRow = types.slice(types.indexOf('      orders: {'), types.indexOf('Insert: {', types.indexOf('      orders: {')))
    for (const c of [...FROZEN_ORDER_COLUMNS, ...REROUTE_MUTABLE_COLUMNS]) expect(ordersRow).toMatch(new RegExp(`\\b${c}:`))
  })

  it('keeps every column the previous freeze (20261012000001) had', () => {
    const previous = distinctColumns(functionBody(read(join(MIGRATIONS, '20261012000001_compounding_status.sql'))))
    expect(previous).toHaveLength(16)
    for (const c of previous) expect(FROZEN_ORDER_COLUMNS).toContain(c)
  })

  it('adds what the evidence map named (B5)', () => {
    for (const c of ['sig_text', 'sig_mode', 'titration_steps', 'quantity', 'dispense_quantity', 'dispense_unit', 'days_supply', 'refills',
      'substitution_allowed', 'special_instructions', 'patient_id', 'provider_id', 'formulation_id', 'package_id', 'package_label',
      'package_count', 'shipping_fee']) {
      expect(FROZEN_ORDER_COLUMNS).toContain(c)
    }
  })
})

describe('the migration', () => {
  const body = functionBody(sql)

  it('exists with a down migration, in one transaction, and is the next free number', () => {
    expect(sql).not.toBe('')
    expect(down).not.toBe('')
    expect(code(sql)).toMatch(/^BEGIN;/)
    expect(code(sql)).toMatch(/COMMIT;$/)
    expect(code(down)).toMatch(/^BEGIN;/)
    expect(code(down)).toMatch(/COMMIT;$/)
    const later = readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql') && f > '20261024000010_signed_order_freeze.sql')
    expect(later).toEqual([])
  })

  it('freezes exactly the shared list', () => {
    expect(frozenArray(body).sort()).toEqual([...FROZEN_ORDER_COLUMNS].sort())
    expect(frozenArray(body)).toHaveLength(FROZEN_ORDER_COLUMNS.length)
  })

  it('acts only once locked_at is set, and names the column in the message', () => {
    expect(code(body)).toMatch(/IF OLD\.locked_at IS NOT NULL THEN/)
    expect(body).toContain(SIGNED_ORDER_FROZEN_MESSAGE)
    expect(code(body)).toMatch(/RAISE EXCEPTION '[^']*%[^']*', col/)
  })

  it('pharmacy_id changes only in the ops reroute: from a failed or rejected status to REROUTE_PENDING, reroute_count + 1', () => {
    const c = code(body)
    expect(c).toMatch(/NEW\.pharmacy_id IS DISTINCT FROM OLD\.pharmacy_id/)
    const statuses = /OLD\.status::text IN \(([^)]*)\)/.exec(c)?.[1]?.match(/'([A-Z_]+)'/g)?.map(s => s.slice(1, -1)) ?? []
    expect(statuses.sort()).toEqual([...REROUTE_FROM_STATUSES].sort())
    expect(c).toContain("NEW.status::text = 'REROUTE_PENDING'")
    expect(c).toContain('NEW.reroute_count = OLD.reroute_count + 1')
    expect(REROUTE_MUTABLE_COLUMNS).toEqual(['pharmacy_id'])
  })

  it('the ops reroute route uses the same statuses', () => {
    const route = read(join(ROOT, 'src', 'app', 'api', 'ops', 'orders', '[orderId]', 'action', 'route.ts'))
    expect(route).toMatch(/REROUTE_FROM_STATUSES/)
  })

  it('creates no table (so apply_pharmacy_admin_scope is not needed) and only replaces the function', () => {
    expect(code(sql)).not.toMatch(/CREATE TABLE/i)
    expect(code(sql)).not.toMatch(/DROP TRIGGER|CREATE TRIGGER/i)
  })

  it('the down migration restores the 20261012000001 function exactly', () => {
    const previous = functionBody(read(join(MIGRATIONS, '20261012000001_compounding_status.sql')))
    expect(code(functionBody(down))).toBe(code(previous))
  })
})

// ── Every app write to orders, against the freeze ────────────────────

interface Write { file: string; line: number; keys: string[]; draftOnly: boolean; text: string }

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { if (name !== '__tests__') walk(p, out) } else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

/** `.from('orders')` … `.update({ … })` within a few lines, with its keys and whether it is DRAFT-only. */
function orderWrites(): Write[] {
  const writes: Write[] = []
  for (const file of walk(join(ROOT, 'src'))) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/)
    lines.forEach((l, i) => {
      if (!l.includes(".from('orders')")) return
      const j = lines.slice(i, i + 8).findIndex(x => x.includes('.update('))
      if (j < 0) return
      const text = lines.slice(i + j, i + j + 14).join('\n')
      const call = text.slice(text.indexOf('.update('))
      const obj = /\.update\(\s*(\{[\s\S]*?\})\s*(?:as [A-Za-z]+\s*)?\)/.exec(call)?.[1] ?? ''
      const keys = [...obj.matchAll(/(\w+)\s*:/g)].map(m => m[1]!)
      writes.push({ file: relative(ROOT, file), line: i + j + 1, keys, draftOnly: /\.eq\('status', 'DRAFT'\)/.test(call), text: call })
    })
  }
  return writes
}

describe('no app write changes a frozen column on a signed order', () => {
  const writes = orderWrites()

  it('finds the order writes', () => {
    expect(writes.length).toBeGreaterThan(15)
  })

  it('every write that can reach a signed order touches no frozen column', () => {
    const frozen = new Set(FROZEN_ORDER_COLUMNS)
    // Signing itself sets locked_at on DRAFT rows (OLD.locked_at is NULL then).
    const offenders = writes
      .filter(w => !w.draftOnly)
      .filter(w => w.keys.some(k => frozen.has(k)))
      .map(w => `${w.file}:${w.line} ${w.keys.filter(k => frozen.has(k)).join(',')}`)
    expect(offenders).toEqual([])
  })

  it('casTransition patches touch no frozen column; only the reroute changes pharmacy_id', () => {
    const frozen = new Set(FROZEN_ORDER_COLUMNS)
    const offenders: string[] = []
    for (const file of walk(join(ROOT, 'src'))) {
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(/patch:\s*\{([\s\S]*?)\}\s*,\s*\n/g)) {
        const keys = [...m[1]!.matchAll(/(\w+)\s*:/g)].map(x => x[1]!)
        const bad = keys.filter(k => frozen.has(k))
        if (bad.length) offenders.push(`${relative(ROOT, file)} ${bad.join(',')}`)
        if (keys.includes('pharmacy_id')) expect(relative(ROOT, file)).toMatch(/ops[\\/]orders[\\/]\[orderId\][\\/]action[\\/]route\.ts$/)
      }
    }
    expect(offenders).toEqual([])
  })
})
