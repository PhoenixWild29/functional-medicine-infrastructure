/**
 * @jest-environment node
 *
 * Request access: the one migration (20261020000001).
 *
 * No Postgres runner here, so this pins what the SQL must say: one table
 * of business contacts (no PHI), RLS on with no policy at all (anon and
 * authenticated get nothing; the service role writes, and ops reads only
 * through ops routes), constraints that keep each row coherent, and
 * apply_pharmacy_admin_scope() last before COMMIT.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(process.cwd(), 'supabase', 'migrations')
const FILE = '20261020000001_access_requests.sql'
const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8').replace(/\r\n/g, '\n') : '')
const flat = (s: string) => s.replace(/--.*$/gm, '').replace(/\s+/g, ' ').toLowerCase()
const code = flat(read(join(DIR, FILE)))
const down = flat(read(join(DIR, 'down', '20261020000001_down.sql')))
const table = (() => {
  const start = code.indexOf('create table if not exists access_requests (')
  return start < 0 ? '' : code.slice(start, code.indexOf(');', start))
})()

it('exists with a down migration, one transaction, sorting after D\'s 20261018000001', () => {
  expect(code).toMatch(/^\s*begin;/)
  expect(code).toMatch(/commit;\s*$/)
  expect(down).toMatch(/^\s*begin;.*drop table if exists access_requests.*commit;\s*$/)
  expect(FILE > '20261018000001_~').toBe(true)
})

it('ends with SELECT apply_pharmacy_admin_scope(); right before COMMIT', () => {
  expect(code).toMatch(/select apply_pharmacy_admin_scope\(\); commit;\s*$/)
})

describe('access_requests', () => {
  it('holds the type, the request fields, status and who handled it when', () => {
    expect(table).not.toBe('')
    for (const col of ['request_id uuid', 'request_type text', 'organization_name text', 'contact_name text', 'work_email text', 'phone text',
      'states text[]', 'provider_count integer', 'facility_type text', 'note text', 'status text', 'decline_note text',
      'created_at timestamptz', 'handled_by uuid', 'handled_at timestamptz']) {
      expect(table).toContain(col)
    }
    expect(table).toContain("request_type in ('clinic', 'pharmacy')")
    expect(table).toContain("status in ('new', 'invited', 'declined')")
    expect(table).toContain("facility_type in ('503a', '503b')")
  })

  it('keeps each row coherent: clinic fields for clinics, pharmacy fields for pharmacies; who and when once handled; a decline has a note', () => {
    expect(table).toContain("(request_type = 'clinic') = (provider_count is not null)")
    expect(table).toContain("(request_type = 'pharmacy') = (facility_type is not null)")
    expect(table).toContain("(status = 'new') = (handled_at is null and handled_by is null)")
    expect(table).toContain("status <> 'declined' or decline_note is not null")
  })

  it('has no PHI fields: business contacts only', () => {
    expect(table).not.toMatch(/date_of_birth|patient|allerg|medication|diagnos|ssn/)
  })

  it('RLS on and no policy: anon and authenticated get nothing; only the service role reads and writes', () => {
    expect(code).toContain('alter table access_requests enable row level security')
    expect(code).toContain('revoke all on access_requests from anon, authenticated')
    expect(code).not.toMatch(/create policy \w+ on access_requests/)
  })

  it('indexes for the ops list and the 24-hour duplicate check', () => {
    expect(code).toMatch(/create index if not exists \w+ on access_requests \(request_type, status, created_at desc\)/)
    expect(code).toMatch(/create index if not exists \w+ on access_requests \(work_email, created_at desc\)/)
  })
})
