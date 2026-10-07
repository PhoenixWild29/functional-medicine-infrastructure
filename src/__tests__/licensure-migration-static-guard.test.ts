/**
 * @jest-environment node
 *
 * C5: the licensure rule reads a license's type and sterile scope and a
 * pharmacy's 503A / 503B status. pharmacy_state_licenses had neither, so a
 * migration adds them. This pins the columns the code relies on, their
 * allowed values, and that the migration ships with a down file.
 */

import fs from 'fs'
import path from 'path'

const MIGRATIONS = path.resolve(__dirname, '..', '..', 'supabase', 'migrations')

function licensureMigration(): { up: string; down: string } {
  const file = fs.readdirSync(MIGRATIONS).find(f => /_pharmacy_licensure_scope\.sql$/.test(f))
  expect(file).toBeDefined()
  const up = fs.readFileSync(path.join(MIGRATIONS, file!), 'utf8')
  const downPath = path.join(MIGRATIONS, 'down', file!.replace(/_pharmacy_licensure_scope\.sql$/, '_down.sql'))
  expect(fs.existsSync(downPath)).toBe(true)
  return { up, down: fs.readFileSync(downPath, 'utf8') }
}

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
