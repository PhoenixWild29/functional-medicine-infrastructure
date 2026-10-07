/**
 * @jest-environment node
 *
 * C5: the licensure rule reads a license's type and sterile scope and a
 * pharmacy's 503A / 503B status. pharmacy_state_licenses had neither, so a
 * migration adds them. This pins the columns the code relies on, their
 * allowed values, the migration's version, and that it ships with a down
 * file.
 *
 * Version: 20261009000001. C4 (#202) uses 20261008000001; two migrations
 * must never share a version, so this suite also checks the whole folder.
 *
 * Demo backfill: every pharmacy in this system is a seeded demo pharmacy,
 * and a NULL sterile scope blocks sterile products (the rule fails
 * closed). So the migration records, for the seeded demo pharmacies ONLY,
 * sterile_compounding = true on their existing active licenses and
 * facility_type = '503A', guarded by WHERE pharmacy_id IN (...), so it does
 * nothing on a database without them. The seed scripts do the same for
 * the rows they create. NULL still blocks everywhere else.
 */

import fs from 'fs'
import path from 'path'
import { DEMO_LICENSURE_PHARMACIES } from '@/lib/compliance/pharmacy-licensure'

const ROOT = path.resolve(__dirname, '..', '..')
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations')
const VERSION = '20261009000001'

const DEMO_IDS = [
  'a4000000-0000-0000-0000-000000000001',
  'a4000000-0000-0000-0000-000000000002',
  'a4000000-0000-0000-0000-000000000003',
  'a4000000-0000-0000-0000-000000000004',
  'a4000000-0000-0000-0000-000000000005',
]

function licensureMigration(): { file: string; up: string; down: string } {
  const files = fs.readdirSync(MIGRATIONS).filter(f => /_pharmacy_licensure_scope\.sql$/.test(f))
  expect(files).toHaveLength(1)
  const file = files[0]!
  const up = fs.readFileSync(path.join(MIGRATIONS, file), 'utf8')
  const downPath = path.join(MIGRATIONS, 'down', file.replace(/_pharmacy_licensure_scope\.sql$/, '_down.sql'))
  expect(fs.existsSync(downPath)).toBe(true)
  return { file, up, down: fs.readFileSync(downPath, 'utf8') }
}

/** The SQL with -- comments removed, so assertions read statements only. */
const statements = (sql: string) => sql.split('\n').filter(l => !/^\s*--/.test(l)).join('\n')

it(`is version ${VERSION}, after C4 (20261008000001)`, () => {
  expect(licensureMigration().file).toBe(`${VERSION}_pharmacy_licensure_scope.sql`)
  expect(fs.existsSync(path.join(MIGRATIONS, 'down', `${VERSION}_down.sql`))).toBe(true)
})

it('no two migrations share a version', () => {
  const versions = fs.readdirSync(MIGRATIONS)
    .filter(f => f.endsWith('.sql'))
    .map(f => f.split('_')[0]!)
  const dupes = versions.filter((v, i) => versions.indexOf(v) !== i)
  expect(dupes).toEqual([])
})

it('adds license_type and sterile_compounding to pharmacy_state_licenses', () => {
  const { up } = licensureMigration()
  expect(up).toMatch(/ALTER TABLE pharmacy_state_licenses[\s\S]*ADD COLUMN IF NOT EXISTS license_type TEXT/)
  expect(up).toMatch(/'resident_pharmacy'[\s\S]*'nonresident_pharmacy'[\s\S]*'outsourcing_facility'/)
  // NULL = not recorded; the app fails closed for sterile products.
  expect(up).toMatch(/ADD COLUMN IF NOT EXISTS sterile_compounding BOOLEAN(?!\s+NOT NULL)/)
})

it('adds facility_type (503A / 503B) to pharmacies', () => {
  const { up } = licensureMigration()
  expect(up).toMatch(/ALTER TABLE pharmacies[\s\S]*ADD COLUMN IF NOT EXISTS facility_type TEXT[\s\S]*'503A'[\s\S]*'503B'/)
})

it('the down file drops exactly what the up file adds', () => {
  const { down } = licensureMigration()
  for (const col of ['license_type', 'sterile_compounding', 'facility_type']) {
    expect(down).toMatch(new RegExp(`DROP COLUMN IF EXISTS ${col}`))
  }
})

describe('demo backfill (seeded demo pharmacies only)', () => {
  const { up } = licensureMigration()
  const sql = statements(up)

  it('the app and the migration name the same five demo pharmacies', () => {
    expect(DEMO_LICENSURE_PHARMACIES.map(p => p.id)).toEqual(DEMO_IDS)
  })

  it('names every demo pharmacy by id and name in a comment', () => {
    for (const p of DEMO_LICENSURE_PHARMACIES) {
      expect(up).toMatch(new RegExp(`--.*${p.id}.*${p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
    }
  })

  it('records sterile scope on their existing active licenses only, never overwriting a recorded value', () => {
    const m = /UPDATE pharmacy_state_licenses\s+SET sterile_compounding = true\s+WHERE ([\s\S]*?);/.exec(sql)
    expect(m).not.toBeNull()
    const where = m![1]!
    expect(where).toMatch(/pharmacy_id IN \(/)
    for (const id of DEMO_IDS) expect(where).toContain(`'${id}'`)
    expect(where).toMatch(/is_active/)
    expect(where).toMatch(/deleted_at IS NULL/)
    expect(where).toMatch(/sterile_compounding IS NULL/)
  })

  it("sets facility_type = '503A' on those pharmacies only, never overwriting a recorded value", () => {
    const m = /UPDATE pharmacies\s+SET facility_type = '503A'\s+WHERE ([\s\S]*?);/.exec(sql)
    expect(m).not.toBeNull()
    const where = m![1]!
    for (const id of DEMO_IDS) expect(where).toContain(`'${id}'`)
    expect(where).toMatch(/facility_type IS NULL/)
  })

  it('touches no other rows: no UPDATE without the demo id guard', () => {
    const updates = sql.match(/UPDATE\s+\w+[\s\S]*?;/g) ?? []
    expect(updates).toHaveLength(2)
    for (const u of updates) expect(u).toMatch(/pharmacy_id IN \(/)
  })
})

describe('seed scripts record the same demo scope', () => {
  it('scripts/seed-poc.ts: demo pharmacies are 503A and the TX license covers sterile compounding', () => {
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'seed-poc.ts'), 'utf8')
    expect(src).toMatch(/facility_type:\s*'503A'/)
    expect(src).toMatch(/from\('pharmacy_state_licenses'\)\.insert\(\{[\s\S]*?sterile_compounding:\s*true/)
  })

  it('scripts/demo-expansion-seed.sql: every inserted license records sterile scope, and the pharmacies are 503A', () => {
    const sql = statements(fs.readFileSync(path.join(ROOT, 'scripts', 'demo-expansion-seed.sql'), 'utf8'))
    const insert = /INSERT INTO pharmacy_state_licenses \(([^)]*)\)\s*VALUES([\s\S]*?);/.exec(sql)
    expect(insert).not.toBeNull()
    expect(insert![1]).toMatch(/sterile_compounding/)
    const rows = insert![2]!.match(/\('a4000000[^)]*\)/g) ?? []
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) expect(row).toMatch(/,\s*true,\s*true\)$/)
    expect(sql).toMatch(/UPDATE pharmacies\s+SET facility_type = '503A'\s+WHERE pharmacy_id IN \(/)
  })
})
