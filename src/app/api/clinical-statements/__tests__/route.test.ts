/**
 * @jest-environment node
 *
 * /api/clinical-statements (coverage gap 6): saved clinical difference
 * statements, per clinic and formulation, for the practice or one patient.
 *
 *   GET    ?formulation_id=&patient_id=  the clinic's statements for that
 *          formulation: this patient's first, then the practice's; never
 *          another clinic's or another patient's.
 *   POST   { formulation_id, statement, patient_id? }  save one (any clinic
 *          role, as favorites); validated, length-bounded, deduplicated.
 *   DELETE ?id=  remove one of the clinic's (soft delete).
 */

import { NextRequest } from 'next/server'
import { DELETE, GET, POST } from '../route'

const CLINIC = 'a1000000-0000-4000-8000-000000000001'
const FORM   = 'a7000000-0000-4000-8000-000000000001'
const PAT    = 'a3000000-0000-4000-8000-000000000001'
const OTHER_PAT = 'a3000000-0000-4000-8000-000000000099'
const STMT   = 'Glycine added to help maintain muscle mass'

type Call = { table: string; op: string; args: unknown[] }
let calls: Call[] = []
const fixtures: Record<string, () => unknown> = {}

const getUserMock = jest.fn()
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockResolvedValue({ auth: { getUser: () => getUserMock() } }),
}))

function chain(table: string) {
  const b: Record<string, unknown> = {}
  for (const op of ['select', 'eq', 'is', 'or', 'in', 'order', 'limit', 'insert', 'update']) {
    b[op] = (...args: unknown[]) => { calls.push({ table, op, args }); return b }
  }
  const resolve = (key: string) => Promise.resolve((fixtures[`${table}:${key}`] ?? (() => ({ data: null, error: null })))())
  b['maybeSingle'] = () => resolve('maybeSingle')
  b['single'] = () => resolve('single')
  b['then'] = (res: (v: unknown) => unknown) => resolve('await').then(res)
  return b
}
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn().mockReturnValue({ from: (t: string) => chain(t) }),
}))

function signedInAs(role: string, clinicId: string | null = CLINIC) {
  getUserMock.mockResolvedValue({ data: { user: { id: 'user-1', app_metadata: { app_role: role, clinic_id: clinicId } } } })
}

const get = (qs: string) => GET(new NextRequest(new URL(`http://localhost/api/clinical-statements${qs}`)))
const post = (body: unknown, headers: Record<string, string> = {}) => POST(new NextRequest(new URL('http://localhost/api/clinical-statements'), {
  method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers },
}))
const del = (qs: string) => DELETE(new NextRequest(new URL(`http://localhost/api/clinical-statements${qs}`), { method: 'DELETE' }))
const ops = (table: string, op: string) => calls.filter(c => c.table === table && c.op === op).map(c => c.args)

beforeEach(() => {
  calls = []
  Object.keys(fixtures).forEach(k => delete fixtures[k])
  signedInAs('provider')
  fixtures['patients:maybeSingle'] = () => ({ data: { patient_id: PAT }, error: null })
  fixtures['formulations:maybeSingle'] = () => ({ data: { formulation_id: FORM }, error: null })
  fixtures['saved_clinical_statements:await'] = () => ({ data: [], error: null })
  fixtures['saved_clinical_statements:single'] = () => ({ data: { statement_id: 's-new', statement: STMT, patient_id: null, created_at: '2026-10-25T00:00:00Z' }, error: null })
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('GET', () => {
  it("returns this patient's statements first, then the practice's, scoped to the clinic and formulation", async () => {
    fixtures['saved_clinical_statements:await'] = () => ({
      data: [
        { statement_id: 'p1', statement: 'A practice statement that is long enough', patient_id: null, created_at: '2026-10-01T00:00:00Z' },
        { statement_id: 'mine', statement: STMT, patient_id: PAT, created_at: '2026-10-02T00:00:00Z' },
        // Defensive: a row for another patient never reaches the caller.
        { statement_id: 'other', statement: 'Another patient statement, long enough', patient_id: OTHER_PAT, created_at: '2026-10-03T00:00:00Z' },
      ],
      error: null,
    })
    const res = await get(`?formulation_id=${FORM}&patient_id=${PAT}`)
    expect(res.status).toBe(200)
    const json = await res.json() as { data: Array<{ statement_id: string; scope: string }> }
    expect(json.data.map(r => [r.statement_id, r.scope])).toEqual([['mine', 'patient'], ['p1', 'practice']])
    expect(ops('saved_clinical_statements', 'eq')).toEqual(expect.arrayContaining([['clinic_id', CLINIC], ['formulation_id', FORM]]))
    expect(ops('saved_clinical_statements', 'is')).toEqual(expect.arrayContaining([['deleted_at', null]]))
    expect(ops('saved_clinical_statements', 'or')).toEqual([[`patient_id.is.null,patient_id.eq.${PAT}`]])
  })

  it('without a patient: practice statements only', async () => {
    await get(`?formulation_id=${FORM}`)
    expect(ops('saved_clinical_statements', 'is')).toEqual(expect.arrayContaining([['patient_id', null]]))
    expect(ops('saved_clinical_statements', 'or')).toEqual([])
  })

  it('400 for a missing or malformed id; 401 signed out; 403 for ops, pharmacy or no clinic', async () => {
    expect((await get('')).status).toBe(400)
    expect((await get(`?formulation_id=${FORM}&patient_id=nope`)).status).toBe(400)
    getUserMock.mockResolvedValue({ data: { user: null } })
    expect((await get(`?formulation_id=${FORM}`)).status).toBe(401)
    signedInAs('ops_admin', null)
    expect((await get(`?formulation_id=${FORM}`)).status).toBe(403)
    signedInAs('pharmacy_admin', null)
    expect((await get(`?formulation_id=${FORM}`)).status).toBe(403)
    signedInAs('provider', null)
    expect((await get(`?formulation_id=${FORM}`)).status).toBe(403)
  })

  it('a failed read is a 500, never an empty list', async () => {
    fixtures['saved_clinical_statements:await'] = () => ({ data: null, error: { message: 'db down' } })
    const res = await get(`?formulation_id=${FORM}`)
    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toEqual({ error: 'Saved statements could not be loaded.' })
  })
})

describe('POST', () => {
  it('saves for the practice with the clinic from the session, never from the body', async () => {
    const res = await post({ formulation_id: FORM, statement: `  ${STMT} ` })
    expect(res.status).toBe(201)
    expect(ops('saved_clinical_statements', 'insert')).toEqual([[{
      clinic_id: CLINIC, formulation_id: FORM, patient_id: null, statement: STMT, created_by: 'user-1',
    }]])
    await expect(res.json()).resolves.toEqual({ data: expect.objectContaining({ statement_id: 's-new', scope: 'practice' }) })
  })

  it('saves for one patient after checking the patient is in the clinic', async () => {
    fixtures['saved_clinical_statements:single'] = () => ({ data: { statement_id: 's-pat', statement: STMT, patient_id: PAT, created_at: '2026-10-25T00:00:00Z' }, error: null })
    const res = await post({ formulation_id: FORM, statement: STMT, patient_id: PAT })
    expect(res.status).toBe(201)
    expect(ops('patients', 'eq')).toEqual(expect.arrayContaining([['patient_id', PAT], ['clinic_id', CLINIC]]))
    expect((ops('saved_clinical_statements', 'insert')[0]![0] as Record<string, unknown>)['patient_id']).toBe(PAT)
  })

  it("403 for another clinic's patient; 404 for an unknown formulation; nothing inserted", async () => {
    fixtures['patients:maybeSingle'] = () => ({ data: null, error: null })
    expect((await post({ formulation_id: FORM, statement: STMT, patient_id: OTHER_PAT })).status).toBe(403)
    fixtures['patients:maybeSingle'] = () => ({ data: { patient_id: PAT }, error: null })
    fixtures['formulations:maybeSingle'] = () => ({ data: null, error: null })
    expect((await post({ formulation_id: FORM, statement: STMT })).status).toBe(404)
    expect(ops('saved_clinical_statements', 'insert')).toEqual([])
  })

  it('the same statement for the same scope is returned, not saved twice', async () => {
    fixtures['saved_clinical_statements:await'] = () => ({
      data: [{ statement_id: 's-old', statement: STMT.toUpperCase(), patient_id: null, created_at: '2026-10-01T00:00:00Z' }],
      error: null,
    })
    const res = await post({ formulation_id: FORM, statement: STMT })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ data: expect.objectContaining({ statement_id: 's-old' }) })
    expect(ops('saved_clinical_statements', 'insert')).toEqual([])
  })

  it('400 for a short statement or a bad body; MAs may save (as favorites); ops may not; cross-site refused', async () => {
    const short = await post({ formulation_id: FORM, statement: 'too short' })
    expect(short.status).toBe(400)
    await expect(short.json()).resolves.toEqual({ error: 'statement must be 20 to 500 characters' })
    expect((await post({ formulation_id: FORM, statement: STMT, clinic_id: CLINIC })).status).toBe(400)
    signedInAs('medical_assistant')
    expect((await post({ formulation_id: FORM, statement: STMT })).status).toBe(201)
    signedInAs('ops_admin', null)
    expect((await post({ formulation_id: FORM, statement: STMT })).status).toBe(403)
    signedInAs('provider')
    expect((await post({ formulation_id: FORM, statement: STMT }, { 'sec-fetch-site': 'cross-site' })).status).toBe(403)
  })
})

describe('DELETE', () => {
  it("soft-deletes one of the clinic's statements; 404 when it is not the clinic's", async () => {
    const ID = 'a9000000-0000-4000-8000-000000000001'
    fixtures['saved_clinical_statements:await'] = () => ({ data: [{ statement_id: ID }], error: null })
    expect((await del(`?id=${ID}`)).status).toBe(200)
    expect(ops('saved_clinical_statements', 'update')[0]![0]).toEqual({ deleted_at: expect.any(String) })
    expect(ops('saved_clinical_statements', 'eq')).toEqual(expect.arrayContaining([['statement_id', ID], ['clinic_id', CLINIC]]))
    fixtures['saved_clinical_statements:await'] = () => ({ data: [], error: null })
    expect((await del(`?id=${ID}`)).status).toBe(404)
    expect((await del('?id=nope')).status).toBe(400)
  })
})
