/**
 * @jest-environment node
 *
 * Input validation for the internal adapter endpoints (route-order,
 * submit). The internal secret is checked first; then the body is parsed.
 * Bad input is a 400 and nothing reaches the routing engine or an adapter:
 * a non-object body, an id that is not a uuid (a 500 from Postgres, 22P02),
 * a malformed forceOverride, an oversize override reason.
 */

import type { NextRequest } from 'next/server'

const routeOrderMock = jest.fn()
const tier1Mock = jest.fn()
const tier2Mock = jest.fn()
const tier4Mock = jest.fn()
jest.mock('@/lib/adapters/routing-engine', () => ({ routeOrder: (...a: unknown[]) => routeOrderMock(...a) }))
jest.mock('@/lib/adapters/tier1-api', () => ({ submitTier1Api: (...a: unknown[]) => tier1Mock(...a) }))
jest.mock('@/lib/adapters/tier2-portal', () => ({ submitTier2Portal: (...a: unknown[]) => tier2Mock(...a) }))
jest.mock('@/lib/adapters/tier4-fax', () => ({ submitTier4Fax: (...a: unknown[]) => tier4Mock(...a) }))

import { POST as routeOrderPOST } from '../route-order/route'
import { POST as submitPOST } from '../submit/route'

const SECRET = 'internal-test-secret'
const ORDER = 'a1000000-0000-0000-0000-000000000001'
const PHARMACY = 'a4000000-0000-0000-0000-000000000001'

function req(body: string, token: string | null = SECRET): NextRequest {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (token) headers.set('x-internal-token', token)
  return new Request('https://app.test/api/adapters/x', { method: 'POST', headers, body }) as unknown as NextRequest
}
const json = (v: unknown) => JSON.stringify(v)

beforeEach(() => {
  process.env['ADAPTER_INTERNAL_SECRET'] = SECRET
  routeOrderMock.mockReset().mockResolvedValue({ outcome: 'submitted', tier: 'TIER_4_FAX' })
  tier1Mock.mockReset().mockResolvedValue({ outcome: 'acknowledged', attemptsMade: 1 })
  tier2Mock.mockReset()
  tier4Mock.mockReset().mockResolvedValue({ documoFaxId: 'f', attemptNumber: 1 })
  jest.spyOn(console, 'info').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { jest.restoreAllMocks(); delete process.env['ADAPTER_INTERNAL_SECRET'] })

describe('POST /api/adapters/route-order', () => {
  const ok = { orderId: ORDER, pharmacyId: PHARMACY, currentStatus: 'PAID_PROCESSING' }

  it('no internal token: 401 before the body is read', async () => {
    const res = await routeOrderPOST(req('not json', null))
    expect(res.status).toBe(401)
  })

  it('a valid body reaches the routing engine (seeded, non-v4 ids accepted)', async () => {
    const res = await routeOrderPOST(req(json(ok)))
    expect(res.status).toBe(200)
    expect(routeOrderMock).toHaveBeenCalledTimes(1)
  })

  it('invalid JSON: 400', async () => {
    const res = await routeOrderPOST(req('{'))
    expect(res.status).toBe(400)
    expect(routeOrderMock).not.toHaveBeenCalled()
  })

  it.each([['null', 'null'], ['an array', '[]'], ['a number', '5']])('a JSON body that is %s: 400', async (_l, body) => {
    const res = await routeOrderPOST(req(body))
    expect(res.status).toBe(400)
    expect(routeOrderMock).not.toHaveBeenCalled()
  })

  it.each([['orderId', { ...ok, orderId: 'not-a-uuid' }], ['pharmacyId', { ...ok, pharmacyId: "1' or 1=1" }]])(
    'a %s that is not a uuid: 400', async (_l, body) => {
      const res = await routeOrderPOST(req(json(body)))
      expect(res.status).toBe(400)
      expect(routeOrderMock).not.toHaveBeenCalled()
    })

  it('an unknown currentStatus: 400 with the existing message', async () => {
    const res = await routeOrderPOST(req(json({ ...ok, currentStatus: 'SHIPPED' })))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/^currentStatus must be one of/)
    expect(routeOrderMock).not.toHaveBeenCalled()
  })

  it('forceOverride: null is a 400, not a thrown 500', async () => {
    const res = await routeOrderPOST(req(json({ ...ok, forceOverride: null })))
    expect(res.status).toBe(400)
    expect(routeOrderMock).not.toHaveBeenCalled()
  })

  it('an oversize forceOverride reason: 400', async () => {
    const res = await routeOrderPOST(req(json({ ...ok, forceOverride: { tier: 'TIER_4_FAX', reason: 'x'.repeat(2001) } })))
    expect(res.status).toBe(400)
    expect(routeOrderMock).not.toHaveBeenCalled()
  })

  it('an attemptNumber out of range: 400', async () => {
    const res = await routeOrderPOST(req(json({ ...ok, attemptNumber: 1e9 })))
    expect(res.status).toBe(400)
    expect(routeOrderMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/adapters/submit', () => {
  const ok = { orderId: ORDER, pharmacyId: PHARMACY, tier: 'TIER_1_API' }

  it('no internal token: 401', async () => {
    const res = await submitPOST(req(json(ok), 'wrong'))
    expect(res.status).toBe(401)
    expect(tier1Mock).not.toHaveBeenCalled()
  })

  it('a valid body reaches the adapter', async () => {
    const res = await submitPOST(req(json(ok)))
    expect(res.status).toBe(200)
    expect(tier1Mock).toHaveBeenCalledWith(ORDER, PHARMACY)
  })

  it('a null body: 400, not a thrown 500', async () => {
    const res = await submitPOST(req('null'))
    expect(res.status).toBe(400)
  })

  it.each([['orderId', { ...ok, orderId: 'abc' }], ['pharmacyId', { ...ok, pharmacyId: 'x'.repeat(5000) }]])(
    'a %s that is not a uuid: 400, no adapter called', async (_l, body) => {
      const res = await submitPOST(req(json(body)))
      expect(res.status).toBe(400)
      expect(tier1Mock).not.toHaveBeenCalled()
    })

  it('an unknown tier: 400 with the existing message', async () => {
    const res = await submitPOST(req(json({ ...ok, tier: 'TIER_9' })))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/^tier must be one of/)
  })
})

describe('C-2026-10-25-07: Hybrid backstop and the constant-time token check', () => {
  it('submit for a TIER_3_HYBRID pharmacy stays a 501 (no adapter is built)', async () => {
    const res = await submitPOST(req(json({ orderId: ORDER, pharmacyId: PHARMACY, tier: 'TIER_3_HYBRID' })))
    expect(res.status).toBe(501)
    expect(tier1Mock).not.toHaveBeenCalled()
  })

  it.each([
    ['a token of another length', 'internal'],
    ['a token of the same length, one character off', 'internal-test-secreT'],
  ])('%s: 401 on both routes, nothing dispatched', async (_n, token) => {
    expect((await submitPOST(req(json({ orderId: ORDER, pharmacyId: PHARMACY, tier: 'TIER_1_API' }), token))).status).toBe(401)
    expect((await routeOrderPOST(req(json({ orderId: ORDER, pharmacyId: PHARMACY }), token))).status).toBe(401)
    expect(tier1Mock).not.toHaveBeenCalled()
    expect(routeOrderMock).not.toHaveBeenCalled()
  })

  it('no secret configured: 401 even for an empty-looking token', async () => {
    delete process.env['ADAPTER_INTERNAL_SECRET']
    expect((await submitPOST(req(json({ orderId: ORDER, pharmacyId: PHARMACY, tier: 'TIER_1_API' }), 'x'))).status).toBe(401)
  })
})
