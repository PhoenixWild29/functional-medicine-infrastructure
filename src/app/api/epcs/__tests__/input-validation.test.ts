/**
 * @jest-environment node
 *
 * /api/epcs input validation. The signed-in provider is resolved first
 * (provider-binding.test.ts); then the body. A JSON body that is not an
 * object is a 400, not a thrown 500. For action=audit: ids must be uuids
 * (a bad one was a 22P02 500), event_type is the table's closed set,
 * dea_schedule is 0-5, text is bounded. Nothing is written on bad input.
 */

import { NextRequest } from 'next/server'
import { scriptedDb } from '@/__tests__/helpers/scripted-db'

const ME = 'aaaaaaaa-0000-4000-8000-000000000001'
const CLINIC = '11111111-1111-4111-8111-111111111111'
const PATIENT = 'a3000000-0000-0000-0000-000000000001'

const getUserMock = jest.fn()
let db = scriptedDb(() => undefined)
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser: () => getUserMock() } }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.mock('@/lib/auth/current-provider', () => ({
  ...jest.requireActual('@/lib/auth/current-provider'),
  resolveCurrentProvider: async () => ({ provider_id: ME, clinic_id: CLINIC, first_name: 'A', last_name: 'B', npi_number: '1', signature_hash: null }),
}))
jest.mock('otplib', () => ({ TOTP: class {}, generateSecret: () => 'S', generateURI: () => 'otpauth://totp/x', verifySync: () => ({ valid: false }) }))
jest.mock('qrcode', () => ({ toDataURL: async () => 'data:image/png;base64,AAA' }))
jest.mock('@/lib/epcs/crypto', () => ({ encryptSecret: (s: string) => s, decryptSecret: (s: string) => s }))

import { POST } from '../route'

const post = (action: string, body: string) =>
  POST(new NextRequest(`http://localhost/api/epcs?action=${action}`, { method: 'POST', body, headers: { 'content-type': 'application/json' } }))
const audit = (body: Record<string, unknown>) => post('audit', JSON.stringify(body))
const writes = () => db.calls.filter(c => c.op !== 'select')

beforeEach(() => {
  db = scriptedDb(() => undefined)
  getUserMock.mockResolvedValue({ data: { user: { id: 'u1', app_metadata: { app_role: 'provider', clinic_id: CLINIC } } } })
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('POST /api/epcs: input', () => {
  it('a medical assistant is 403 before the body is read', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u2', app_metadata: { app_role: 'medical_assistant', clinic_id: CLINIC } } } })
    const res = await post('audit', '{')
    expect(res.status).toBe(403)
  })

  it('invalid JSON: 400', async () => {
    const res = await post('audit', '{')
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Invalid JSON body')
  })

  it.each(['audit', 'verify', 'setup'])('a null body (action=%s): 400, not a thrown 500', async action => {
    const res = await post(action, 'null')
    expect(res.status).toBe(400)
    expect(writes()).toEqual([])
  })

  it('a valid audit row is written', async () => {
    // The patient is the caller's clinic's (C-2026-10-25-07: audit ids are scoped).
    db = scriptedDb(c => (c.table === 'patients' && c.op === 'select' ? { data: { patient_id: PATIENT } } : undefined))
    const res = await audit({ event_type: 'PRE_SIGN_REVIEW', dea_schedule: 2, medication_name: 'Testosterone Cypionate', patient_id: PATIENT, details: { lines: 1 } })
    expect(res.status).toBe(200)
    expect(db.to('epcs_audit_log', 'insert')).toHaveLength(1)
  })

  it.each([
    ['a patient_id that is not a uuid', { event_type: 'PRE_SIGN_REVIEW', patient_id: 'p-1' }],
    ['an order_id that is not a uuid', { event_type: 'PRE_SIGN_REVIEW', order_id: "x'; drop" }],
    ['an unknown event_type', { event_type: 'MADE_UP' }],
    ['a dea_schedule out of range', { event_type: 'PRE_SIGN_REVIEW', dea_schedule: 9 }],
    ['an oversize medication_name', { event_type: 'PRE_SIGN_REVIEW', medication_name: 'x'.repeat(1001) }],
    ['details that are not an object', { event_type: 'PRE_SIGN_REVIEW', details: 'text' }],
  ])('audit with %s: 400, nothing written', async (_l, body) => {
    const res = await audit(body)
    expect(res.status).toBe(400)
    expect(db.to('epcs_audit_log', 'insert')).toEqual([])
  })

  it('audit with no event_type keeps its message', async () => {
    const res = await audit({})
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Missing event_type')
  })

  it('verify with an oversize code: 400, the provider is not read', async () => {
    const res = await post('verify', JSON.stringify({ code: '1'.repeat(100) }))
    expect(res.status).toBe(400)
    expect(db.calls).toEqual([])
  })
})
