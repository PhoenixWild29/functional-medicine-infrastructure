/**
 * @jest-environment node
 *
 * Input validation and auth order for the /api/orders collection routes:
 * POST /api/orders, POST batch-sign, POST batch-sign/check, POST shipping,
 * POST refill and GET compliance-check.
 *
 *   - Who is calling is checked first: a signed-out caller is a 401
 *     whatever the body.
 *   - Bad input (invalid JSON, a body that is not an object, a bad id, an
 *     oversize string, an unknown sig mode, an oversize signature) is a
 *     400 before any read or write. A bad id never reaches Postgres
 *     (error 22P02 is a 500).
 */

import { NextRequest } from 'next/server'
import { scriptedDb } from '@/__tests__/helpers/scripted-db'

const CLINIC   = 'a1000000-0000-0000-0000-000000000001'
const PROVIDER = 'a2000000-0000-0000-0000-000000000001'
const PATIENT  = 'a3000000-0000-0000-0000-000000000001'
const PHARMACY = 'a4000000-0000-0000-0000-000000000004'
const FORM     = 'a7000000-0000-0000-0000-000000000001'
const ORDER    = 'a6000000-0000-0000-0000-000000000001'

let user: unknown = null
let db = scriptedDb(() => undefined)

jest.mock('@/lib/onboarding/approval-guard', () => ({
  ...jest.requireActual('@/lib/onboarding/approval-guard'),
  refuseUnlessApproved: async () => null,
}))
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) } }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))

const signBatchMock  = jest.fn()
const checkBatchMock = jest.fn()
jest.mock('@/lib/orders/batch-sign', () => ({
  ...jest.requireActual('@/lib/orders/batch-sign'),
  signBatch:  (...a: unknown[]) => signBatchMock(...a),
  checkBatch: (...a: unknown[]) => checkBatchMock(...a),
}))
jest.mock('@/lib/auth/signer', () => ({ resolveSigner: async () => ({ ok: true }) }))
const applyShippingMock = jest.fn()
jest.mock('@/lib/orders/apply-bundle-shipping', () => ({
  MAX_BUNDLE_ORDERS: 25,
  applyBundleShipping: (...a: unknown[]) => applyShippingMock(...a),
  reallocateDraftSiblingShipping: jest.fn(),
}))
jest.spyOn(console, 'error').mockImplementation(() => {})
jest.spyOn(console, 'warn').mockImplementation(() => {})

import { POST as createOrder } from '../route'
import { POST as batchSign } from '../batch-sign/route'
import { POST as batchCheck } from '../batch-sign/check/route'
import { POST as shipping } from '../shipping/route'
import { POST as refill } from '../refill/route'
import { GET as complianceCheck } from '../compliance-check/route'

const clinicUser = (role = 'provider') => ({ id: 'u-1', app_metadata: { app_role: role, clinic_id: CLINIC } })

function post(body: unknown, raw?: string): NextRequest {
  return new NextRequest('http://localhost/api/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
    body: raw ?? JSON.stringify(body),
  })
}

const noReads = () => expect(db.calls).toHaveLength(0)

beforeEach(() => {
  user = clinicUser()
  db = scriptedDb(() => undefined)
  signBatchMock.mockReset()
  checkBatchMock.mockReset()
  applyShippingMock.mockReset()
})

// ── POST /api/orders ────────────────────────────────────────────────

describe('POST /api/orders', () => {
  const body = (extra: Record<string, unknown> = {}) => ({
    patientId: PATIENT, providerId: PROVIDER, formulationId: FORM, catalogItemId: null, pharmacyId: PHARMACY,
    retailCents: 19000, sigText: 'Inject 10 units (0.10mL / 0.50mg) subcutaneously once weekly', patientState: 'TX',
    protocolId: null, refillOfOrderId: null, dose: '0.5 mg', frequencyCode: 'QW', quantityLabel: null,
    packageId: null, packageCount: null, sigMode: 'standard', titrationSteps: [], ...extra,
  })

  it.each([
    ['invalid JSON',            undefined, '{nope'],
    ['null body',               undefined, 'null'],
    ['a string body',           undefined, '"x"'],
    ['a bad patientId',         body({ patientId: 'p-1' }), undefined],
    ['a bad providerId',        body({ providerId: "x' OR 1=1" }), undefined],
    ['a bad pharmacyId',        body({ pharmacyId: 'ph-1' }), undefined],
    ['a bad formulationId',     body({ formulationId: 'f'.repeat(300) }), undefined],
    ['a bad protocolId',        body({ protocolId: 'proto' }), undefined],
    ['a bad refillOfOrderId',   body({ refillOfOrderId: 'o-1' }), undefined],
    ['a bad appendedToOrderId', body({ appendedToOrderId: 'o-1' }), undefined],
    ['a bad packageId',         body({ packageId: 'pkg' }), undefined],
    ['a non-string sigText',    body({ sigText: 12345678901 }), undefined],
    ['an oversize sigText',     body({ sigText: 'x'.repeat(4001) }), undefined],
    ['an oversize dose',        body({ dose: 'x'.repeat(201) }), undefined],
    ['an oversize patientState', body({ patientState: 'T'.repeat(50) }), undefined],
    ['an unknown sigMode',      body({ sigMode: 'sometimes' }), undefined],
    ['a huge retailCents',      body({ retailCents: 1e12 }), undefined],
    ['a huge daysSupply',       body({ rxDetails: { daysSupply: 3e9 } }), undefined],
    ['titrationSteps not a list', body({ sigMode: 'titration', titrationSteps: 'weekly' }), undefined],
  ])('%s is a 400 before any read', async (_n, b, raw) => {
    const res = await createOrder(post(b, raw))
    expect(res.status).toBe(400)
    noReads()
  })

  it('a signed-out caller with a bad body is a 401', async () => {
    user = null
    expect((await createOrder(post(undefined, '{nope'))).status).toBe(401)
  })

  it('keeps the existing messages: missing fields, bad retailCents', async () => {
    let res = await createOrder(post(body({ patientId: '' })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Missing required fields' })
    res = await createOrder(post(body({ retailCents: '500' })))
    expect(await res.json()).toEqual({ error: 'retailCents must be a positive integer (cents)' })
  })

  it('the body the New Prescription flow sends reaches the line lookup', async () => {
    const res = await createOrder(post(body({ rxDetails: { daysSupply: 28, dispenseQuantity: 2, dispenseUnit: 'mL', refills: 0 } })))
    // The formulation is not in this fake: the request got past validation.
    expect(res.status).not.toBe(400)
    expect(db.calls.length).toBeGreaterThan(0)
  })
})

// ── POST /api/orders/batch-sign ─────────────────────────────────────

describe('POST /api/orders/batch-sign', () => {
  const strokes = [[{ x: 0, y: 0 }, { x: 200, y: 5 }], [{ x: 10, y: 10 }], [{ x: 20, y: 20 }]]
  const signature = { dataUrl: 'data:image/png;base64,AAAA', strokes, padWidth: 300 }

  it.each([
    ['invalid JSON', '{nope'],
    ['null body', 'null'],
    ['an array body', '[]'],
  ])('%s is a 400, nothing signed', async (_n, raw) => {
    expect((await batchSign(post(undefined, raw))).status).toBe(400)
    expect(signBatchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['an oversize dataUrl', { ...signature, dataUrl: 'data:image/png;base64,' + 'A'.repeat(5_000_001) }],
    ['too many strokes',    { ...signature, strokes: Array.from({ length: 1001 }, () => [{ x: 1, y: 1 }]) }],
    ['too many points',     { ...signature, strokes: [Array.from({ length: 100_001 }, (_, i) => ({ x: i, y: 1 }))] }],
  ])('%s is a 400, nothing signed', async (_n, sig) => {
    const res = await batchSign(post({ orderIds: [ORDER], signature: sig }))
    expect(res.status).toBe(400)
    expect(signBatchMock).not.toHaveBeenCalled()
  })

  it('a real signature goes through to signing', async () => {
    signBatchMock.mockResolvedValue({ ok: true, signedAt: 'now', patients: [] })
    const res = await batchSign(post({ orderIds: [ORDER], signature }))
    expect(res.status).toBe(200)
    expect(signBatchMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ orderIds: [ORDER], signature }))
  })

  it('a signed-out caller is a 401', async () => {
    user = null
    expect((await batchSign(post(undefined, '{nope'))).status).toBe(401)
  })
})

// ── POST /api/orders/batch-sign/check ───────────────────────────────

describe('POST /api/orders/batch-sign/check', () => {
  it.each([
    ['null body', 'null'],
    ['a string body', '"x"'],
  ])('%s is a 400, nothing checked', async (_n, raw) => {
    expect((await batchCheck(post(undefined, raw))).status).toBe(400)
    expect(checkBatchMock).not.toHaveBeenCalled()
  })
})

// ── POST /api/orders/shipping ───────────────────────────────────────

describe('POST /api/orders/shipping', () => {
  it.each([
    ['invalid JSON', undefined, '{nope'],
    ['null body', undefined, 'null'],
    ['a bad order id', { orderIds: ['order-1'] }, undefined],
  ])('%s is a 400, nothing allocated', async (_n, b, raw) => {
    expect((await shipping(post(b, raw))).status).toBe(400)
    expect(applyShippingMock).not.toHaveBeenCalled()
  })

  it('keeps its message for a bad id', async () => {
    const res = await shipping(post({ orderIds: ['order-1'] }))
    expect(await res.json()).toEqual({ error: 'orderIds must be 1–25 order ids' })
  })
})

// ── POST /api/orders/refill ─────────────────────────────────────────

describe('POST /api/orders/refill', () => {
  it.each([
    ['invalid JSON', undefined, '{nope'],
    ['null body', undefined, 'null'],
    ['a bad order id', { orderIds: ['o-1'] }, undefined],
    ['an oversize list', { orderIds: Array.from({ length: 501 }, () => ORDER) }, undefined],
  ])('%s is a 400 before any read', async (_n, b, raw) => {
    expect((await refill(post(b, raw))).status).toBe(400)
    noReads()
  })

  it('a signed-out caller is a 401', async () => {
    user = null
    expect((await refill(post({ orderIds: ['o-1'] }))).status).toBe(401)
  })
})

// ── GET /api/orders/compliance-check ────────────────────────────────

describe('GET /api/orders/compliance-check', () => {
  const get = (q: Record<string, string>) =>
    complianceCheck(new NextRequest(`http://localhost/api/orders/compliance-check?${new URLSearchParams(q)}`))
  const q = { patientId: PATIENT, providerId: PROVIDER, pharmacyId: PHARMACY, itemId: FORM, retailCents: '19000' }

  it.each([
    ['a bad patientId',  { ...q, patientId: 'p-1' }],
    ['a bad pharmacyId', { ...q, pharmacyId: "x' OR 1=1" }],
    ['a bad itemId',     { ...q, itemId: 'i'.repeat(500) }],
    ['a non-numeric retailCents', { ...q, retailCents: 'lots' }],
  ])('%s is a 400 before any read', async (_n, query) => {
    expect((await get(query)).status).toBe(400)
    noReads()
  })

  it('a caller with no clinic is refused before the query is read', async () => {
    user = { id: 'u-ops', app_metadata: { app_role: 'ops_admin' } }
    const res = await get({ ...q, patientId: 'p-1' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Session missing clinic_id' })
    noReads()
  })
})
