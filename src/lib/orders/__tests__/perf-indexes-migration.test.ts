/**
 * @jest-environment node
 *
 * C-2026-10-25-11: one index migration for the hot reads on orders, which
 * had no index on clinic_id, provider_id, status, created_at or (outside
 * drafts) updated_at. Each index names the query it serves (see the
 * migration's header). Static checks only: never run against a shared
 * database here.
 */

import fs from 'node:fs'
import path from 'node:path'

const MIGRATIONS = path.resolve(__dirname, '../../../../supabase/migrations')
const VERSION = '20261024000008'
const file = () => fs.readdirSync(MIGRATIONS).find(f => f.startsWith(`${VERSION}_`))
const sql = () => fs.readFileSync(path.join(MIGRATIONS, file()!), 'utf8')
const code = (s: string) => s.split('\n').filter(l => !/^\s*--/.test(l)).join('\n').replace(/\s+/g, ' ').toLowerCase()
const down = () => fs.readFileSync(path.join(MIGRATIONS, 'down', `${VERSION}_down.sql`), 'utf8')

const INDEXES: Array<[string, string]> = [
  ['idx_orders_clinic_updated',   'on orders (clinic_id, updated_at desc) where deleted_at is null'],
  ['idx_orders_clinic_created',   'on orders (clinic_id, created_at) where deleted_at is null'],
  ['idx_orders_provider_created', 'on orders (provider_id, created_at desc) where deleted_at is null'],
  ['idx_orders_status_updated',   'on orders (status, updated_at) where deleted_at is null'],
  ['idx_orders_updated',          'on orders (updated_at desc) where deleted_at is null'],
]

it(`is version ${VERSION}, unique, with a down file`, () => {
  expect(file()).toBe(`${VERSION}_perf_indexes.sql`)
  const versions = fs.readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).map(f => f.split('_')[0]!)
  expect(versions.filter(v => v === VERSION)).toHaveLength(1)
  expect(fs.existsSync(path.join(MIGRATIONS, 'down', `${VERSION}_down.sql`))).toBe(true)
})

it.each(INDEXES)('creates %s if it does not exist', (name, def) => {
  expect(code(sql())).toContain(`create index if not exists ${name} ${def};`)
})

it('only creates indexes: no table, column, policy or data change', () => {
  const statements = code(sql()).split(';').map(s => s.trim()).filter(Boolean)
  expect(statements.filter(s => s !== 'begin' && s !== 'commit').every(s => s.startsWith('create index if not exists '))).toBe(true)
  expect(statements.length).toBe(INDEXES.length + 2)
})

it('is one transaction (no CONCURRENTLY, which supabase db push cannot run in a transaction)', () => {
  const c = code(sql())
  expect(c).toMatch(/^\s*begin;/)
  expect(c).toMatch(/commit;\s*$/)
  expect(c).not.toContain('concurrently')
})

it('each index names the query it serves in the header', () => {
  for (const [name] of INDEXES) expect(sql()).toMatch(new RegExp(`--[^\\n]*${name}`))
})

it('the down file drops exactly these indexes, in one transaction', () => {
  const c = code(down())
  expect(c).toMatch(/^\s*begin;/)
  expect(c).toMatch(/commit;\s*$/)
  for (const [name] of INDEXES) expect(c).toContain(`drop index if exists ${name};`)
  expect(c.split(';').map(s => s.trim()).filter(s => s.startsWith('drop')).length).toBe(INDEXES.length)
})
