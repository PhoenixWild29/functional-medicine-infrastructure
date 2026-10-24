/**
 * @jest-environment node
 *
 * Issue Log 72: the inbound fax viewer no longer points at a Supabase
 * bucket `fax-pdfs` (it does not exist; inbound faxes live only in Documo).
 * Each fax row carries the ops-only route that fetches the PDF from Documo.
 * Migration 20261024000001 adds phi_access_log.fax_id, so a view records
 * which fax; additive, safe to apply twice, with a down file.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { mapFaxRow } from '../map-fax-row'

const FAX = '55555555-5555-4555-8555-555555555555'

it('mapFaxRow: the ops PDF route, no storage call', async () => {
  const storage = { from: jest.fn() }
  const entry = await mapFaxRow({ fax_id: FAX, documo_fax_id: 'd-1', from_number: '+15125550100', page_count: 2, storage_path: 'documo/path', status: 'UNMATCHED', created_at: 'x', updated_at: 'x' }, { storage } as never)
  expect(entry.pdfUrl).toBe(`/api/ops/fax/${FAX}/pdf`)
  expect(storage.from).not.toHaveBeenCalled()
})

it('no code refers to a fax-pdfs bucket any more', () => {
  const offenders: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) { if (name !== '__tests__' && name !== 'node_modules') walk(full) }
      else if (/\.(ts|tsx)$/.test(name) && readFileSync(full, 'utf8').includes("'fax-pdfs'")) offenders.push(full)
    }
  }
  walk(join(process.cwd(), 'src'))
  expect(offenders).toEqual([])
})

describe('migration 20261024000001', () => {
  const DIR = join(process.cwd(), 'supabase', 'migrations')
  const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8').replace(/\r\n/g, '\n') : '')
  const flat = (s: string) => s.replace(/--.*$/gm, '').replace(/\s+/g, ' ').toLowerCase()
  const code = flat(read(join(DIR, '20261024000001_phi_access_log_fax_id.sql')))
  const down = flat(read(join(DIR, 'down', '20261024000001_down.sql')))

  it('exists with a down file, one transaction each', () => {
    expect(code).toMatch(/^\s*begin;.*commit;\s*$/)
    expect(down).toMatch(/^\s*begin;.*commit;\s*$/)
  })

  it('adds a nullable fax_id (no FK: the log outlives the queue row) and an index; nothing else', () => {
    expect(code).toContain('alter table phi_access_log add column if not exists fax_id uuid')
    expect(code).toMatch(/create index if not exists idx_phi_access_log_fax_time on phi_access_log \(fax_id, occurred_at desc\) where fax_id is not null/)
    expect(code).not.toMatch(/references|create table|drop |delete from|update phi_access_log/)
  })

  it('the down file refuses while fax views are recorded, then drops the index and column', () => {
    expect(down).toMatch(/raise exception/)
    expect(down).toContain('fax_id is not null')
    expect(down).toContain('drop index if exists idx_phi_access_log_fax_time')
    expect(down).toContain('alter table phi_access_log drop column if exists fax_id')
  })
})
