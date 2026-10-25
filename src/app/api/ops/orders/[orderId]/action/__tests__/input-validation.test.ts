/**
 * @jest-environment node
 *
 * Input validation: POST /api/ops/orders/[orderId]/action.
 *
 *   - ops_admin only, before anything is read;
 *   - the order id (and reroute's optional pharmacy id) is an 8-4-4-4-12
 *     hex id: a malformed one reached Postgres (22P02) as a 500;
 *   - a body that is not a JSON object, an action outside the list, or an
 *     action's text field that is not a string or over its bound is a 400
 *     before the order is read.
 */

import { NextRequest } from 'next/server'
import { scriptedDb } from '@/__tests__/helpers/scripted-db'

const DEMO_ORDER    = 'd4000000-0000-0000-0000-000000000001'
const DEMO_PHARMACY = 'a4000000-0000-0000-0000-000000000002'

let user: Record<string, unknown> | null = null
let db = scriptedDb(() => undefined)

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser: async () => ({ data: { user }, error: user ? null : { message: 'no' } }) } }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.mock('@/lib/stripe/client', () => ({ createStripeClient: () => ({}) }))
jest.mock('@/lib/orders/cas-transition', () => ({ casTransition: jest.fn(async () => ({ success: true, wasAlreadyTransitioned: false })) }))
jest.mock('@/lib/orders/status-history', () => ({ insertStatusHistory: jest.fn(async () => true) }))
jest.mock('@/lib/adapters/routing-engine', () => ({ routeOrder: jest.fn(), submitQueuedFax: jest.fn() }))
jest.spyOn(console, 'error').mockImplementation(() => {})
jest.spyOn(console, 'info').mockImplementation(() => {})

import { POST } from '../route'

const as = (role: string) => ({ id: `u-${role}`, email: `${role}@x.example`, app_metadata: { app_role: role } })
const raw = (body: string) => new NextRequest('https://app.test/api/ops/orders/x/action', { method: 'POST', body })
const req = (body: unknown) => raw(JSON.stringify(body))
const params = (orderId = DEMO_ORDER) => ({ params: Promise.resolve({ orderId }) })

beforeEach(() => {
  user = as('ops_admin')
  db = scriptedDb(c => {
    if (c.table === 'orders' && c.op === 'select') return { data: { order_id: DEMO_ORDER, status: 'SUBMISSION_FAILED', reroute_count: 0, pharmacy_id: DEMO_PHARMACY, ops_assignee: null } }
    if (c.table === 'orders' && c.op === 'update') return { data: [{ order_id: DEMO_ORDER }] }
    return undefined
  })
})

it('claim with the shape the pipeline sends, on a seeded demo id, is 200', async () => {
  expect((await POST(req({ action: 'claim', opsAssignee: 'ops@compoundiq.test' }), params())).status).toBe(200)
})

it('reroute with no pharmacy (what the pipeline sends) is 200', async () => {
  expect((await POST(req({ action: 'reroute', currentStatus: 'SUBMISSION_FAILED' }), params())).status).toBe(200)
})

it('a malformed order id is 400 and reads nothing', async () => {
  expect((await POST(req({ action: 'release' }), params('o-1'))).status).toBe(400)
  expect(db.calls).toHaveLength(0)
})

it('invalid JSON keeps its message', async () => {
  const res = await POST(raw('{'), params())
  expect(res.status).toBe(400)
  expect((await res.json() as { error: string }).error).toBe('Invalid JSON')
})

it('a JSON body that is not an object (null) is 400, not a thrown 500', async () => {
  expect((await POST(raw('null'), params())).status).toBe(400)
  expect(db.calls).toHaveLength(0)
})

it('an unknown action is 400 before the order is read', async () => {
  const res = await POST(req({ action: 'teleport' }), params())
  expect(res.status).toBe(400)
  expect((await res.json() as { error: string }).error).toBe('Unknown action: teleport')
  expect(db.calls).toHaveLength(0)
})

it('claim with an opsAssignee that is not a string is 400 (it threw a 500)', async () => {
  expect((await POST(req({ action: 'claim', opsAssignee: 42 }), params())).status).toBe(400)
  expect(db.calls).toHaveLength(0)
})

it('claim with an opsAssignee over 254 characters is 400 with nothing written', async () => {
  expect((await POST(req({ action: 'claim', opsAssignee: `${'a'.repeat(250)}@x.example` }), params())).status).toBe(400)
  expect(db.calls).toHaveLength(0)
})

it('add_tracking with a tracking number over 200 characters is 400 with nothing written', async () => {
  expect((await POST(req({ action: 'add_tracking', trackingNumber: '1Z'.repeat(101), carrier: 'UPS' }), params())).status).toBe(400)
  expect(db.calls).toHaveLength(0)
})

it('reroute to a malformed pharmacy id is 400 with nothing written', async () => {
  expect((await POST(req({ action: 'reroute', pharmacyId: 'pharm-1' }), params())).status).toBe(400)
  expect(db.calls).toHaveLength(0)
})

it('a non-ops role is 403 and reads nothing', async () => {
  user = as('clinic_admin')
  expect((await POST(req({ action: 'release' }), params())).status).toBe(403)
  expect(db.calls).toHaveLength(0)
})
