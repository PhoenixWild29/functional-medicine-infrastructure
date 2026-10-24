/**
 * @jest-environment node
 *
 * Every upload goes through a Vercel Function, which refuses request bodies
 * over about 4.5 MB. So every upload, and every request that carries a
 * file's contents (CSV rows re-posted as JSON), is limited to 4 MB: on the
 * server where the server sees the file, in the browser before anything is
 * sent, and in the copy ("up to 4 MB"). The same pattern as the face sheet.
 *
 *   - pharmacy license documents (was 10 MB)
 *   - patient CSV import, the file (was 5 MB), and the rows sent to Check
 *     rows and Import (JSON, checked in the browser)
 *   - catalog CSVs, ops and pharmacy onboarding (parsed in the browser and
 *     sent as JSON rows; no limit before)
 *   - face sheets (already 4 MB)
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MAX_REQUEST_BYTES, MAX_REQUEST_LABEL, jsonBodyTooLarge } from '../limits'
import { MAX_DOCUMENT_BYTES, attachLicenseDocument } from '@/lib/pharmacy-onboarding/application'
import { MAX_IMPORT_BYTES } from '@/lib/patients/import/csv'
import { MAX_FACE_SHEET_BYTES } from '@/lib/face-sheet/config'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

it('one limit: 4 MB, under the Vercel Function body limit', () => {
  expect(MAX_REQUEST_BYTES).toBe(4 * 1024 * 1024)
  expect(MAX_REQUEST_LABEL).toBe('4 MB')
})

it.each([
  ['pharmacy license documents', () => MAX_DOCUMENT_BYTES],
  ['patient CSV import', () => MAX_IMPORT_BYTES],
  ['face sheets', () => MAX_FACE_SHEET_BYTES],
])('%s: 4 MB', (_name, limit) => {
  expect(limit()).toBe(MAX_REQUEST_BYTES)
})

it('jsonBodyTooLarge measures the JSON as bytes', () => {
  expect(jsonBodyTooLarge({ rows: ['x'] })).toBe(false)
  expect(jsonBodyTooLarge({ rows: ['x'.repeat(4 * 1024 * 1024)] })).toBe(true)
  // Multi-byte characters count as their bytes, not their length.
  expect(jsonBodyTooLarge({ s: 'é'.repeat(2 * 1024 * 1024 + 10) })).toBe(true)
})

it('the server refuses a license document over 4 MB, and says so', async () => {
  const r = await attachLicenseDocument({} as never, { pharmacyId: 'p', userId: 'u' }, 'TX', {
    name: 'l.pdf', type: 'application/pdf', size: 4 * 1024 * 1024 + 1, bytes: new Uint8Array(1),
  })
  expect(r).toEqual({ ok: false, status: 400, error: 'The file must be under 4 MB.' })
})

describe('the copy and the browser checks', () => {
  it('pharmacy onboarding: "up to 4 MB" on the license document; both uploads checked before sending', () => {
    const src = read('src/app/pharmacy/onboarding/_components/steps.tsx')
    expect(src).toContain('PDF, PNG or JPEG, up to 4 MB.')
    expect(src).not.toMatch(/10 MB/)
    expect(src).toContain('MAX_REQUEST_BYTES')
    expect(src).toContain('jsonBodyTooLarge(')
  })

  it('the license document route says 4 MB', () => {
    const src = read('src/app/api/pharmacy/onboarding/licenses/[state]/document/route.ts')
    expect(src).toContain('The file must be under 4 MB.')
    expect(src).not.toMatch(/10 MB/)
  })

  it('patient CSV import: "up to 4 MB", the server says 4 MB, the rows are checked before sending', () => {
    expect(read('src/app/(clinic-app)/settings/patients/import/_components/import-wizard.tsx')).toContain('A .csv file up to 4 MB and 5,000 patients, with a header row.')
    expect(read('src/app/(clinic-app)/settings/patients/import/_components/import-wizard.tsx')).toContain('jsonBodyTooLarge(')
    const route = read('src/app/api/patients/import/parse/route.ts')
    expect(route).toContain('The file is larger than 4 MB. Split it into smaller files.')
    expect(route).not.toMatch(/5 MB/)
  })

  it('ops catalog upload: the file and the rows are checked before sending', () => {
    const src = read('src/app/(ops-dashboard)/ops/catalog/_components/catalog-manager.tsx')
    expect(src).toContain('MAX_REQUEST_BYTES')
    expect(src).toContain('jsonBodyTooLarge(')
  })
})
