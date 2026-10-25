/**
 * @jest-environment node
 *
 * Security follow-up (C-2026-10-25-07, item 2): an EPCS audit row may name
 * only the caller's own clinic's patient and order. Before the insert, one
 * scoped read each (patients / orders by id AND the signed-in provider's
 * clinic, not deleted). Another clinic's id, or one that does not exist, is
 * a 404 and nothing is written (the FK alone only proved the row existed).
 * A failed read is a 500 and nothing is written.
 */

import { NextRequest } from 'next/server'
import { scriptedDb, DB_DOWN, type ScriptedCall } from '@/__tests__/helpers/scripted-db'

const ME = 'aaaaaaaa-0000-4000-8000-000000000001'
const CLINIC = '11111111-1111-4111-8111-111111111111'
const MY_PATIENT = 'a3000000-0000-0000-0000-000000000001'
const MY_ORDER = 'b3000000-0000-0000-0000-000000000001'
const OTHER_PATIENT = 'a3000000-0000-0000-0000-0000000000ff'
const OTHER_ORDER = 'b3000000-0000-0000-0000-0000000000ff'

const getUserMock = jest.fn()
let down = false
const mine = (c: ScriptedCall) => {
  if (c.op !== 'select') return undefined
  if (down && (c.table === 'patients' || c.table === 'orders')) return DB_DOWN
  if (c.table === 'patients') return { data: c.filters['patient_id'] === MY_PATIENT && c.filters['clinic_id'] === CLINIC ? { patient_id: MY_PATIENT } : null }
  if (c.table === 'orders') return { data: c.filters['order_id'] === MY_ORDER && c.filters['clinic_id'] === CLINIC ? { order_id: MY_ORDER } : null }
  return undefined
}
let db = scriptedDb(mine)
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

const audit = (body: Record<string, unknown>) =>
  POST(new NextRequest('http://localhost/api/epcs?action=audit', { method: 'POST', body: JSON.stringify({ event_type: 'PRE_SIGN_REVIEW', dea_schedule: 2, ...body }), headers: { 'content-type': 'application/json' } }))
const inserts = () => db.to('epcs_audit_log', 'insert')

beforeEach(() => {
  down = false
  db = scriptedDb(mine)
  getUserMock.mockResolvedValue({ data: { user: { id: 'u1', app_metadata: { app_role: 'provider', clinic_id: CLINIC } } } })
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('POST /api/epcs?action=audit: ids are the caller\'s clinic\'s', () => {
  it('own patient and own order: written', async () => {
    const res = await audit({ patient_id: MY_PATIENT, order_id: MY_ORDER })
    expect(res.status).toBe(200)
    expect(inserts()).toHaveLength(1)
  })

  it('the reads are scoped to the caller\'s clinic and skip deleted rows', async () => {
    await audit({ patient_id: MY_PATIENT, order_id: MY_ORDER })
    for (const t of ['patients', 'orders']) {
      const read = db.calls.find(c => c.table === t)!
      expect(read.filters['clinic_id']).toBe(CLINIC)
      expect(read.filters['deleted_at:is']).toBeNull()
    }
  })

  it('no ids: written, nothing read', async () => {
    expect((await audit({})).status).toBe(200)
    expect(db.calls.some(c => c.table === 'patients' || c.table === 'orders')).toBe(false)
    expect(inserts()).toHaveLength(1)
  })

  it.each([
    ['another clinic\'s patient', { patient_id: OTHER_PATIENT }],
    ['another clinic\'s order', { order_id: OTHER_ORDER }],
    ['own patient, another clinic\'s order', { patient_id: MY_PATIENT, order_id: OTHER_ORDER }],
  ])('%s: 404, nothing written', async (_n, ids) => {
    const res = await audit(ids)
    expect(res.status).toBe(404)
    expect(inserts()).toHaveLength(0)
  })

  it('a failed scope read: 500, nothing written', async () => {
    down = true
    const res = await audit({ patient_id: MY_PATIENT })
    expect(res.status).toBe(500)
    expect(inserts()).toHaveLength(0)
  })
})
