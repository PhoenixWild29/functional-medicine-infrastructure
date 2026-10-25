/**
 * @jest-environment node
 *
 * Input validation and auth order for the /api/orders/[orderId]/* routes.
 *
 *   - Who is calling is checked first: a bad id from a signed-out caller
 *     is a 401, not a 400.
 *   - A bad order id is a 400 before any read: it never reaches Postgres
 *     (error 22P02 is a 500).
 *   - Seeded demo ids (a4000000-0000-0000-0000-...) are ids: they are not
 *     RFC v4, and the Phase C routes used to refuse them.
 *   - Bad bodies (invalid JSON, not an object, oversize text, an unknown
 *     sig mode, a bad id) are a 400 before any read or write.
 *   - Another clinic's order is a 404, read only through the caller's
 *     clinic filter.
 */

import { NextRequest } from 'next/server'
import { scriptedDb, type ScriptedCall } from '@/__tests__/helpers/scripted-db'

const CLINIC   = 'a1000000-0000-0000-0000-000000000001'
const ORDER    = 'a6000000-0000-0000-0000-000000000001'
const SIBLING  = 'a6000000-0000-0000-0000-000000000002'
const PHARMACY = 'a4000000-0000-0000-0000-000000000004'
const FORM     = 'a7000000-0000-0000-0000-000000000001'

let user: unknown = null
let db = scriptedDb(() => undefined)
let serverDb = scriptedDb(() => undefined)

jest.mock('@/lib/onboarding/approval-guard', () => ({
  ...jest.requireActual('@/lib/onboarding/approval-guard'),
  refuseUnlessApproved: async () => null,
}))
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user }, error: null }) },
    from: (t: string) => (serverDb.client as unknown as { from: (t: string) => unknown }).from(t),
  }),
}))
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => db.client,
}))
const createGroupMock = jest.fn()
jest.mock('@/lib/payment-group/create-group', () => ({
  createPaymentGroup: (...a: unknown[]) => createGroupMock(...a),
  cancelPaymentGroup: jest.fn(),
}))
jest.mock('@/lib/auth/checkout-token', () => ({
  generateCheckoutToken: jest.fn().mockResolvedValue('t'),
  generateGroupCheckoutToken: jest.fn().mockResolvedValue('t'),
}))
jest.mock('@/lib/env', () => ({
  serverEnv: { appBaseUrl: () => 'https://app.example.test', checkoutTokenExpiry: () => 3600 },
}))
jest.spyOn(console, 'error').mockImplementation(() => {})
jest.spyOn(console, 'warn').mockImplementation(() => {})
jest.spyOn(console, 'info').mockImplementation(() => {})

import { GET as bundlableGET } from '../bundlable-siblings/route'
import { POST as checkoutLinkPOST } from '../checkout-link/route'
import { GET as failureReasonGET } from '../failure-reason/route'
import { POST as groupAndSendPOST } from '../group-and-send/route'
import { GET as groupLinkGET } from '../group-link/route'
import { POST as reassignPOST } from '../reassign-to-me/route'
import { GET as recordGET } from '../record/route'
import { GET as timelineGET } from '../timeline-actors/route'
import { PATCH, DELETE } from '../route'

const clinicUser = (role = 'clinic_admin') => ({ id: 'u-1', app_metadata: { app_role: role, clinic_id: CLINIC } })
const params = (orderId: string) => ({ params: Promise.resolve({ orderId }) })

function req(body?: unknown, raw?: string): NextRequest {
  return new NextRequest(`http://localhost/api/orders/x`, {
    method: body === undefined && raw === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
    ...(raw !== undefined ? { body: raw } : body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}
function patchReq(body: unknown, raw?: string): NextRequest {
  return new NextRequest(`http://localhost/api/orders/x`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: raw ?? JSON.stringify(body),
  })
}

const noReads = () => {
  expect(db.calls).toHaveLength(0)
  expect(serverDb.calls).toHaveLength(0)
}

const BAD_IDS = ['not-a-uuid', "1' OR '1'='1", 'a'.repeat(5000)]

beforeEach(() => {
  process.env['PHASE_C_GROUPS_ENABLED'] = 'true'
  user = clinicUser()
  db = scriptedDb(() => undefined)
  serverDb = scriptedDb(() => undefined)
  createGroupMock.mockReset()
})

// ── A bad order id: 400, nothing read ───────────────────────────────

const byId: Array<[string, (id: string) => Promise<Response>]> = [
  ['GET bundlable-siblings', id => bundlableGET(req(), params(id))],
  ['POST checkout-link',     id => checkoutLinkPOST(req({}), params(id))],
  ['GET failure-reason',     id => failureReasonGET(req(), params(id))],
  ['POST group-and-send',    id => groupAndSendPOST(req({ siblingOrderIds: [SIBLING] }), params(id))],
  ['GET group-link',         id => groupLinkGET(req(), params(id))],
  ['POST reassign-to-me',    id => reassignPOST(req({}), params(id))],
  ['GET record',             id => recordGET(req(), params(id))],
  ['GET timeline-actors',    id => timelineGET(req(), params(id))],
  ['DELETE [orderId]',       id => DELETE(req(), params(id))],
  ['PATCH [orderId]',        id => PATCH(patchReq({ formulationId: FORM, pharmacyId: PHARMACY, retailCents: 19000, sigText: 'Inject 10 units weekly please' }), params(id))],
]

describe.each(byId)('%s', (_name, call) => {
  it.each(BAD_IDS.map(id => [id.slice(0, 20), id]))('a bad order id (%s) is a 400 before any read', async (_label, id) => {
    user = _name === 'POST reassign-to-me' ? clinicUser('provider') : clinicUser()
    const res = await call(id)
    expect(res.status).toBe(400)
    noReads()
  })

  it('checks who is calling before the id: a signed-out caller is a 401', async () => {
    user = null
    const res = await call('not-a-uuid')
    expect(res.status).toBe(401)
    noReads()
  })
})

// ── Seeded demo ids are ids ─────────────────────────────────────────

describe('Phase C routes accept seeded (non-v4) ids', () => {
  it('bundlable-siblings reads the anchor for a seeded id', async () => {
    db = scriptedDb(c => (c.table === 'orders' && c.single === 'maybe' ? { data: null } : undefined))
    const res = await bundlableGET(req(), params(ORDER))
    expect(res.status).toBe(404)
    expect(db.to('orders')[0]!.filters).toEqual(expect.objectContaining({ order_id: ORDER, clinic_id: CLINIC }))
  })

  it('group-link reads the order for a seeded id', async () => {
    const res = await groupLinkGET(req(), params(ORDER))
    expect(res.status).toBe(404)
    expect(db.to('orders')[0]!.filters).toEqual(expect.objectContaining({ order_id: ORDER, clinic_id: CLINIC }))
  })

  it('group-and-send bundles seeded anchor and sibling ids', async () => {
    createGroupMock.mockResolvedValue({ ok: false, status: 409, error: 'nope' })
    const res = await groupAndSendPOST(req({ siblingOrderIds: [SIBLING] }), params(ORDER))
    expect(res.status).toBe(409)
    expect(createGroupMock).toHaveBeenCalledWith(expect.objectContaining({ orderIds: [ORDER, SIBLING], clinicId: CLINIC }))
  })
})

// ── group-and-send body ─────────────────────────────────────────────

describe('POST group-and-send body', () => {
  it.each([
    ['invalid JSON', '{nope'],
    ['null', 'null'],
    ['a string', '"x"'],
    ['siblingOrderIds not strings', JSON.stringify({ siblingOrderIds: [1] })],
  ])('%s is a 400, nothing bundled', async (_n, raw) => {
    const res = await groupAndSendPOST(req(undefined, raw), params(ORDER))
    expect(res.status).toBe(400)
    expect(createGroupMock).not.toHaveBeenCalled()
  })
})

// ── PATCH body ──────────────────────────────────────────────────────

describe('PATCH /api/orders/[orderId] body', () => {
  const line = (extra: Record<string, unknown> = {}) => ({
    formulationId: FORM, pharmacyId: PHARMACY, retailCents: 19000,
    sigText: 'Inject 10 units (0.10mL / 0.50mg) subcutaneously once weekly', ...extra,
  })

  it.each([
    ['invalid JSON',           undefined, '{nope'],
    ['null body',              undefined, 'null'],
    ['an array body',          undefined, '[]'],
    ['a bad pharmacyId',       line({ pharmacyId: 'ph-1' }), undefined],
    ['a bad formulationId',    line({ formulationId: 'not-an-id' }), undefined],
    ['a bad packageId',        line({ packageId: '123' }), undefined],
    ['an oversize sigText',    line({ sigText: 'x'.repeat(4001) }), undefined],
    ['an oversize dose',       line({ dose: 'x'.repeat(201) }), undefined],
    ['a non-string frequency', line({ frequencyCode: 42 }), undefined],
    ['an unknown sigMode',     line({ sigMode: 'weekly-ish' }), undefined],
    ['a huge retailCents',     line({ retailCents: 1e12 }), undefined],
    ['too many titration steps', line({ sigMode: 'titration', titrationSteps: Array.from({ length: 101 }, () => ({})) }), undefined],
  ])('%s is a 400 before the draft is read', async (_n, body, raw) => {
    const res = await PATCH(patchReq(body, raw), params(ORDER))
    expect(res.status).toBe(400)
    noReads()
  })

  it('a signed-out caller with a bad body is a 401, not a 400', async () => {
    user = null
    const res = await PATCH(patchReq(undefined, '{nope'), params(ORDER))
    expect(res.status).toBe(401)
  })
})

// ── Another clinic's order ──────────────────────────────────────────

describe("another clinic's order", () => {
  it.each([
    ['GET record',          () => recordGET(req(), params(ORDER))],
    ['GET timeline-actors', () => timelineGET(req(), params(ORDER))],
    ['POST checkout-link',  () => checkoutLinkPOST(req({}), params(ORDER))],
    ['DELETE [orderId]',    () => DELETE(req(), params(ORDER))],
  ])('%s: 404 through the caller\'s clinic filter, nothing else read or written', async (_n, call) => {
    // The other clinic's row never matches clinic_id = the caller's clinic.
    db = scriptedDb((c: ScriptedCall) => (c.table === 'orders' && c.filters['clinic_id'] !== CLINIC ? { data: { order_id: ORDER, clinic_id: 'other' } } : undefined))
    const res = await call()
    expect(res.status).toBe(404)
    const orderReads = db.to('orders')
    expect(orderReads.length).toBeGreaterThan(0)
    for (const c of orderReads) expect(c.filters['clinic_id']).toBe(CLINIC)
    expect(db.calls.filter(c => c.op !== 'select')).toHaveLength(0)
  })
})
