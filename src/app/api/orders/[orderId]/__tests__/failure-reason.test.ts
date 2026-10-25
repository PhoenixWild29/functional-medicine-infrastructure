/**
 * @jest-environment node
 *
 * GET /api/orders/[orderId]/failure-reason: why sending this order to the
 * pharmacy failed, for the clinic order drawer.
 *   - getUser(), clinic from app_metadata (claims); 401 without a user.
 *   - Read with the caller's own session (RLS), never the service role,
 *     and scoped to the caller's clinic: another clinic's order is 404.
 *   - Only an order in a failed submission state has a reason.
 *   - Returns only { code, plainReason, pharmacyName, at }: never the
 *     adapter's raw error_message, the submission id or other internals.
 */

import { NextRequest } from 'next/server'
import { scriptedDb, type ScriptedCall } from '@/__tests__/helpers/scripted-db'

const CLINIC = '11111111-1111-4111-8111-111111111111'
const ORDER  = '22222222-2222-4222-8222-222222222222'
const PHARM  = '33333333-3333-4333-8333-333333333333'
const SUB    = '44444444-4444-4444-8444-444444444444'
const OTHER  = '55555555-5555-4555-8555-555555555555'

let user: unknown = { id: 'u-1', app_metadata: { app_role: 'clinic_admin', clinic_id: CLINIC } }
let db = scriptedDb(() => undefined)

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) }, from: (t: string) => (db.client as unknown as { from: (t: string) => unknown }).from(t) }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => { throw new Error('service role must not be used') } }))
jest.spyOn(console, 'error').mockImplementation(() => {})

import { GET } from '../failure-reason/route'

const call = () => GET(new NextRequest(`http://localhost/api/orders/${ORDER}/failure-reason`), { params: Promise.resolve({ orderId: ORDER }) })

const failedOrder = (status = 'SUBMISSION_FAILED', submission: Record<string, unknown> | null = {
  submission_id: SUB, pharmacy_id: PHARM, status: 'SUBMISSION_FAILED', error_code: 'NETWORK_ERROR',
  error_message: 'TypeError: fetch failed\n    at node:internal/deps/undici key=sk_live_secret', created_at: '2026-10-24T10:00:00Z', completed_at: '2026-10-24T10:01:00Z',
}) => (c: ScriptedCall) => {
  if (c.table === 'orders') return { data: { order_id: ORDER, status, pharmacy_snapshot: { pharmacy_id: PHARM, name: 'Strive Pharmacy' } } }
  if (c.table === 'adapter_submissions') return { data: submission ? [submission] : [] }
  if (c.table === 'pharmacies') return { data: { name: c.filters['pharmacy_id'] === OTHER ? 'Empower Pharmacy' : 'Strive Pharmacy' } }
  return undefined
}

beforeEach(() => { user = { id: 'u-1', app_metadata: { app_role: 'clinic_admin', clinic_id: CLINIC } } })

it('401 without a verified user', async () => {
  user = null
  db = scriptedDb(failedOrder())
  expect((await call()).status).toBe(401)
})

it('another clinic\'s order (or none): 404, scoped by the caller\'s clinic', async () => {
  db = scriptedDb(c => (c.table === 'orders' ? { data: null } : undefined))
  expect((await call()).status).toBe(404)
  expect(db.to('orders', 'select')[0]!.filters).toEqual(expect.objectContaining({ order_id: ORDER, clinic_id: CLINIC }))
})

it('a failed submission: only code, plain reason, pharmacy name and time', async () => {
  db = scriptedDb(failedOrder())
  const res = await call()
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body).toEqual({ failure: { code: 'NETWORK_ERROR', plainReason: "the pharmacy's system did not respond", pharmacyName: 'Strive Pharmacy', at: '2026-10-24T10:01:00Z' } })
  const text = JSON.stringify(body)
  for (const leak of ['TypeError', 'undici', 'sk_live', SUB, PHARM]) expect(text).not.toContain(leak)
})

it('reads the latest failed submission for this order only', async () => {
  db = scriptedDb(failedOrder())
  await call()
  const sub = db.to('adapter_submissions', 'select')[0]!
  expect(sub.filters).toEqual(expect.objectContaining({ order_id: ORDER }))
  expect(sub.filters['status:in']).toEqual(expect.arrayContaining(['FAILED', 'REJECTED', 'SUBMISSION_FAILED']))
})

it('no failed submission row (e.g. failed before sending): a generic reason with the order\'s pharmacy', async () => {
  db = scriptedDb(failedOrder('SUBMISSION_FAILED', null))
  const body = await (await call()).json()
  expect(body.failure).toEqual({ code: null, plainReason: 'the order could not be delivered to the pharmacy', pharmacyName: 'Strive Pharmacy', at: null })
})

it("the failed attempt went to another pharmacy (a re-route): that pharmacy's name", async () => {
  db = scriptedDb(failedOrder('SUBMISSION_FAILED', { pharmacy_id: OTHER, status: 'REJECTED', error_code: 'REJECTED', created_at: '2026-10-24T11:00:00Z', completed_at: null }))
  const body = await (await call()).json()
  expect(body.failure).toEqual({ code: 'REJECTED', plainReason: 'the pharmacy declined the order', pharmacyName: 'Empower Pharmacy', at: '2026-10-24T11:00:00Z' })
})

it("the order's own pharmacy: its name from the order, no extra read", async () => {
  db = scriptedDb(failedOrder())
  await call()
  expect(db.to('pharmacies', 'select')).toHaveLength(0)
})

it('an order not in a failed state has no reason', async () => {
  db = scriptedDb(failedOrder('SHIPPED'))
  const body = await (await call()).json()
  expect(body).toEqual({ failure: null })
  expect(db.to('adapter_submissions', 'select')).toHaveLength(0)
})

it('a read error is 500 without detail', async () => {
  db = scriptedDb(c => (c.table === 'orders' ? { error: { message: 'relation secret_x does not exist' } } : undefined))
  const res = await call()
  expect(res.status).toBe(500)
  expect(JSON.stringify(await res.json())).not.toContain('secret_x')
})

// Security review follow-up (L10): only codes the drawer knows are
// returned. A pharmacy's own code (anything not in the plain-reason table
// or an HTTP status) comes back as null with the generic reason.
it.each([
  ['INTERNAL_DB_TIMEOUT_AT_STRIVE_42', null, 'the order could not be delivered to the pharmacy'],
  ['DRUG_UNAVAILABLE', 'DRUG_UNAVAILABLE', 'the pharmacy does not have this medication available'],
  ['503', '503', "the pharmacy's system did not respond"],
])('error code %s is returned as %s', async (raw, code, plainReason) => {
  db = scriptedDb(failedOrder('SUBMISSION_FAILED', { pharmacy_id: PHARM, status: 'FAILED', error_code: raw, created_at: '2026-10-24T11:00:00Z', completed_at: null }))
  const body = await (await call()).json()
  expect(body.failure).toEqual(expect.objectContaining({ code, plainReason }))
})
