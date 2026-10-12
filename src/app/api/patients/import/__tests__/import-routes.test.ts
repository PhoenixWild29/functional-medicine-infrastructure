/**
 * @jest-environment node
 *
 * Patient CSV import routes (Patient Intake spec v1.1, PR 5).
 *
 *   POST /api/patients/import/parse     multipart: the .csv is parsed on
 *        the server (5 MB, 5,000 rows) and never stored; headers, rows and
 *        a suggested mapping come back.
 *   POST /api/patients/import/validate  every row checked with a mapping;
 *        possible duplicates against the clinic's active patients.
 *   POST /api/patients/import           re-checks everything, then creates
 *        the patients in ONE transaction (the import_patient_batch
 *        function): complete, source csv_import, texts off; a batch record
 *        (who, when, file name, counts); one PHI access log row each.
 *
 * Clinic admin and medical assistants only (403 for providers and ops);
 * the clinic always comes from the caller's claims (claims.ts), never the
 * request. getUser(), never getSession(). No PHI in logs.
 */

import { scriptedDb, DB_DOWN, type ScriptedCall, type ScriptedAnswer } from '@/__tests__/helpers/scripted-db'

const CLINIC_ID = 'aaaaaaaa-aaaa-4aaa-9aaa-aaaaaaaaaaaa'
const OTHER_CLINIC = 'bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb'
const BATCH_ID = 'c0000000-0000-4000-8000-000000000001'

const getUserMock = jest.fn()
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn(async () => ({ auth: { getUser: () => getUserMock() } })),
}))
let script: (c: ScriptedCall) => ScriptedAnswer | undefined = () => undefined
let db = scriptedDb(c => script(c))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))

import { POST as PARSE } from '../parse/route'
import { POST as VALIDATE } from '../validate/route'
import { POST as IMPORT } from '../route'
import { logPhiAccessMany } from '@/lib/audit/phi-access'

const HEADERS = ['First Name', 'Last Name', 'DOB', 'Mobile', 'Email', 'State', 'Zip']
const GOOD = ['Jane', 'Smith', '04/15/1985', '(512) 555-0123', 'jane@example.test', 'TX', '78701']
const GOOD2 = ['Ravi', 'Patel', '1990-01-02', '', 'ravi@example.test', 'CA', '94110']
const BAD = ['', 'Nobody', '13/40/1985', '555', '', 'TX', '78701']
const MAPPING = { firstName: 0, lastName: 1, dateOfBirth: 2, mobile: 3, email: 4, state: 5, zip: 6 }

function signedIn(role: string, clinicId: string | undefined = CLINIC_ID) {
  getUserMock.mockResolvedValue({ data: { user: { id: 'user-1', email: 'ma@clinic.test', app_metadata: { app_role: role, ...(clinicId ? { clinic_id: clinicId } : {}) } } }, error: null })
}
const json = (url: string, body: unknown) => new Request(`https://app.test${url}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}) as unknown as import('next/server').NextRequest
function upload(content: string | Uint8Array, name = 'patients.csv') {
  const form = new FormData()
  form.append('file', new Blob([content], { type: 'text/csv' }), name)
  return new Request('https://app.test/api/patients/import/parse', { method: 'POST', body: form }) as unknown as import('next/server').NextRequest
}
const csv = (rows: string[][]) => [HEADERS, ...rows].map(r => r.join(',')).join('\n')

beforeEach(() => {
  db = scriptedDb(c => script(c))
  script = () => ({ data: [] })
  signedIn('medical_assistant')
  ;(logPhiAccessMany as jest.Mock).mockClear()
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'info').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('who may import', () => {
  it.each([
    ['parse', () => PARSE(upload(csv([GOOD])))],
    ['validate', () => VALIDATE(json('/api/patients/import/validate', { headers: HEADERS, rows: [GOOD], mapping: MAPPING }))],
    ['import', () => IMPORT(json('/api/patients/import', { fileName: 'p.csv', headers: HEADERS, rows: [GOOD], mapping: MAPPING, excluded: [], confirmDuplicates: [] }))],
  ])('%s: 401 signed out, 403 for a provider or ops admin, 400 with no clinic in the claims', async (_n, call) => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
    expect((await call()).status).toBe(401)
    signedIn('provider')
    expect((await call()).status).toBe(403)
    signedIn('ops_admin')
    expect((await call()).status).toBe(403)
    signedIn('clinic_admin', undefined)
    expect((await call()).status).toBe(400)
    expect(db.calls).toHaveLength(0)
  })

  it('the clinic admin may', async () => {
    signedIn('clinic_admin')
    expect((await PARSE(upload(csv([GOOD])))).status).toBe(200)
  })
})

describe('parse', () => {
  it('returns headers, rows and a suggested mapping; nothing is written', async () => {
    const res = await PARSE(upload(csv([GOOD, GOOD2])))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ fileName: 'patients.csv', headers: HEADERS, rows: [GOOD, GOOD2], suggestedMapping: MAPPING })
    expect(db.calls).toHaveLength(0)
  })

  it.each([
    ['no file', () => new Request('https://app.test/x', { method: 'POST', body: new FormData() }) as unknown as import('next/server').NextRequest, /choose a \.csv file/i],
    ['not a .csv', () => upload('a,b\n1,2', 'patients.xlsx'), /\.csv/i],
    ['only a header', () => upload(HEADERS.join(',')), /no patient rows/i],
    ['an unterminated quote', () => upload('a,b\n"x,1\n'), /could not be read/i],
  ])('400 for %s', async (_n, req, msg) => {
    const res = await PARSE(req())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(msg)
  })

  it('413 over 5 MB; 400 over 5,000 rows', async () => {
    expect((await PARSE(upload(new Uint8Array(5 * 1024 * 1024 + 1).fill(97)))).status).toBe(413)
    const many = Array.from({ length: 5001 }, () => GOOD)
    const res = await PARSE(upload(csv(many)))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/5,000/)
  })
})

describe('validate', () => {
  it('per-row results and counts; duplicates checked in this clinic only, among active patients', async () => {
    script = c => (c.table === 'patients'
      ? { data: [{ patient_id: 'e1', first_name: 'Jane', last_name: 'Smith', date_of_birth: '1985-04-15', phone_e164: '+15125550999' }] }
      : undefined)
    const res = await VALIDATE(json('/api/patients/import/validate', { headers: HEADERS, rows: [GOOD, GOOD2, BAD], mapping: MAPPING }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.counts).toEqual({ ready: 1, error: 1, duplicate: 1, total: 3 })
    expect(body.rows[0]).toEqual(expect.objectContaining({ index: 0, status: 'duplicate', duplicate: expect.objectContaining({ patientId: 'e1', matchedOn: 'name_and_date_of_birth' }) }))
    expect(body.rows[1]).toEqual(expect.objectContaining({ index: 1, status: 'ready', errors: [] }))
    expect(body.rows[2].status).toBe('error')
    expect(body.rows[2].errors.map((e: { field: string }) => e.field)).toEqual(expect.arrayContaining(['firstName', 'dateOfBirth', 'mobile']))
    const lookup = db.to('patients')[0]!
    expect(lookup.filters).toEqual(expect.objectContaining({ clinic_id: CLINIC_ID, is_active: true, 'deleted_at:is': null }))
    expect(lookup.filters['date_of_birth:in']).toEqual(expect.arrayContaining(['1985-04-15', '1990-01-02']))
  })

  it('a bad mapping is a 400 with the reasons', async () => {
    const res = await VALIDATE(json('/api/patients/import/validate', { headers: HEADERS, rows: [GOOD], mapping: { firstName: 0 } }))
    expect(res.status).toBe(400)
    expect((await res.json()).mappingErrors.length).toBeGreaterThan(0)
  })

  it('the duplicate lookup failing is a 503, never "no duplicates"', async () => {
    script = c => (c.table === 'patients' ? DB_DOWN : undefined)
    expect((await VALIDATE(json('/api/patients/import/validate', { headers: HEADERS, rows: [GOOD], mapping: MAPPING }))).status).toBe(503)
  })
})

describe('import', () => {
  const rpcOk = (ids: string[]) => (c: ScriptedCall): ScriptedAnswer | undefined => {
    if (c.op === 'rpc') return { data: { batch_id: BATCH_ID, patient_ids: ids } }
    if (c.table === 'patients') return { data: [] }
    return undefined
  }
  const body = (over: Record<string, unknown> = {}) => ({ fileName: 'patients.csv', headers: HEADERS, rows: [GOOD, GOOD2], mapping: MAPPING, excluded: [], confirmDuplicates: [], ...over })

  it('one transaction: the batch function, with the clinic from the claims (a clinic in the body is ignored)', async () => {
    script = rpcOk(['p1', 'p2'])
    const res = await IMPORT(json('/api/patients/import', body({ clinicId: OTHER_CLINIC })))
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ batchId: BATCH_ID, imported: 2 })
    const rpc = db.calls.filter(c => c.op === 'rpc')
    expect(rpc).toHaveLength(1)
    expect(rpc[0]!.table).toBe('import_patient_batch')
    const args = rpc[0]!.payload as Record<string, unknown>
    expect(args).toEqual(expect.objectContaining({
      p_clinic_id: CLINIC_ID, p_imported_by: 'user-1', p_file_name: 'patients.csv',
      p_total_rows: 2, p_excluded_rows: 0, p_duplicates_confirmed: 0,
    }))
    expect(args['p_patients']).toEqual([
      expect.objectContaining({ first_name: 'Jane', last_name: 'Smith', date_of_birth: '1985-04-15', phone: '+15125550123', phone_e164: '+15125550123', email: 'jane@example.test', state: 'TX', zip: '78701' }),
      expect.objectContaining({ first_name: 'Ravi', last_name: 'Patel', phone: null, phone_e164: null, email: 'ravi@example.test' }),
    ])
    expect(JSON.stringify(args)).not.toContain(OTHER_CLINIC)
    // Nothing is inserted outside the transaction.
    expect(db.calls.filter(c => c.op === 'insert')).toHaveLength(0)
  })

  it('logs PHI access once per created patient', async () => {
    script = rpcOk(['p1', 'p2'])
    await IMPORT(json('/api/patients/import', body()))
    expect(logPhiAccessMany).toHaveBeenCalledWith(expect.objectContaining({ action: 'create', resource: 'patient', route: '/api/patients/import', clinicId: CLINIC_ID }), ['p1', 'p2'])
  })

  it('a row that needs fixing and is not excluded: 422 with the results; nothing written', async () => {
    script = rpcOk([])
    const res = await IMPORT(json('/api/patients/import', body({ rows: [GOOD, BAD] })))
    expect(res.status).toBe(422)
    expect((await res.json()).counts.error).toBe(1)
    expect(db.calls.filter(c => c.op === 'rpc')).toHaveLength(0)
  })

  it('excluding the bad row imports the rest', async () => {
    script = rpcOk(['p1'])
    const res = await IMPORT(json('/api/patients/import', body({ rows: [GOOD, BAD], excluded: [1] })))
    expect(res.status).toBe(201)
    const args = db.calls.find(c => c.op === 'rpc')!.payload as Record<string, unknown>
    expect((args['p_patients'] as unknown[]).length).toBe(1)
    expect(args).toEqual(expect.objectContaining({ p_total_rows: 2, p_excluded_rows: 1 }))
  })

  it('a possible duplicate is imported only when staff confirm that row (409 otherwise)', async () => {
    const existing = (c: ScriptedCall): ScriptedAnswer | undefined => {
      if (c.op === 'rpc') return { data: { batch_id: BATCH_ID, patient_ids: ['p1', 'p2'] } }
      if (c.table === 'patients') return { data: [{ patient_id: 'e1', first_name: 'Jane', last_name: 'Smith', date_of_birth: '1985-04-15', phone_e164: null }] }
      return undefined
    }
    script = existing
    const res = await IMPORT(json('/api/patients/import', body()))
    expect(res.status).toBe(409)
    expect(db.calls.filter(c => c.op === 'rpc')).toHaveLength(0)
    db = scriptedDb(c => script(c))
    const ok = await IMPORT(json('/api/patients/import', body({ confirmDuplicates: [0] })))
    expect(ok.status).toBe(201)
    expect(db.calls.find(c => c.op === 'rpc')!.payload).toEqual(expect.objectContaining({ p_duplicates_confirmed: 1 }))
  })

  it('nothing left to import: 400', async () => {
    expect((await IMPORT(json('/api/patients/import', body({ excluded: [0, 1] })))).status).toBe(400)
  })

  it('the transaction failing: 500 with a generic message, no PHI logged, no partial import', async () => {
    script = c => (c.op === 'rpc' ? { error: { message: 'insert failed: Jane Smith 1985-04-15' } } : c.table === 'patients' ? { data: [] } : undefined)
    const err = jest.spyOn(console, 'error')
    const res = await IMPORT(json('/api/patients/import', body()))
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toMatch(/Jane|Smith|1985/)
    expect(JSON.stringify(err.mock.calls)).not.toMatch(/Jane|Smith|1985|5550123/)
    expect(logPhiAccessMany).not.toHaveBeenCalled()
  })

  it('refuses oversized input: more than 5,000 rows, or a cell over 500 characters', async () => {
    expect((await IMPORT(json('/api/patients/import', body({ rows: Array.from({ length: 5001 }, () => GOOD) })))).status).toBe(400)
    expect((await IMPORT(json('/api/patients/import', body({ rows: [[...GOOD.slice(0, 6), 'x'.repeat(501)]] })))).status).toBe(400)
  })
})
