/**
 * @jest-environment node
 *
 * PHI access log (B14/B15): every ops quick action on an order (claim,
 * release, add_tracking, cancel_refund, retry_submission, force_fax,
 * retry_fax, reroute) is a write on a known order. One 'update' /
 * 'ops_order_action' row with the order, its patient and its clinic,
 * written BEFORE anything changes. A log that fails is a 503 and nothing is
 * written, transitioned, refunded or sent (fail-closed).
 */

import { NextRequest } from 'next/server'
import { scriptedDb } from '@/__tests__/helpers/scripted-db'
import { logPhiAccess } from '@/lib/audit/phi-access'

const ORDER    = 'd4000000-0000-0000-0000-000000000001'
const PATIENT  = 'a4000000-0000-0000-0000-000000000001'
const CLINIC   = 'c4000000-0000-0000-0000-000000000001'
const PHARMACY = 'a4000000-0000-0000-0000-000000000002'
const OPS = { id: 'u-ops', email: 'ops@x.example', app_metadata: { app_role: 'ops_admin' } }

let db = scriptedDb(() => undefined)
const casTransitionMock = jest.fn()
const refundsCreate = jest.fn()
const routeOrderMock = jest.fn()
const submitQueuedFaxMock = jest.fn()

jest.mock('next/server', () => {
  const actual = jest.requireActual('next/server')
  return { ...actual, after: jest.fn() }
})
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: OPS }, error: null }) } }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.mock('@/lib/stripe/client', () => ({ createStripeClient: () => ({ refunds: { create: refundsCreate } }) }))
jest.mock('@/lib/orders/cas-transition', () => ({ casTransition: (a: unknown) => casTransitionMock(a) }))
jest.mock('@/lib/orders/status-history', () => ({ insertStatusHistory: jest.fn(async () => true) }))
jest.mock('@/lib/adapters/routing-engine', () => ({
  routeOrder: (a: unknown) => routeOrderMock(a),
  submitQueuedFax: (a: unknown) => submitQueuedFaxMock(a),
}))
jest.mock('@/lib/adapters/submission-switch', () => ({ pharmacySubmissionsEnabled: () => true, PHARMACY_SUBMISSIONS_OFF_MESSAGE: 'off' }))
jest.spyOn(console, 'error').mockImplementation(() => {})
jest.spyOn(console, 'info').mockImplementation(() => {})

import { POST } from '../route'

const logMock = jest.mocked(logPhiAccess)
const req = (body: unknown) => new NextRequest('https://app.test/api/ops/orders/x/action', { method: 'POST', body: JSON.stringify(body) })
const params = { params: Promise.resolve({ orderId: ORDER }) }

const STATUS_FOR: Record<string, string> = {
  claim: 'SUBMISSION_FAILED', release: 'SUBMISSION_FAILED', add_tracking: 'READY_TO_SHIP', cancel_refund: 'PHARMACY_REJECTED',
  retry_submission: 'SUBMISSION_FAILED', force_fax: 'SUBMISSION_FAILED', retry_fax: 'FAX_FAILED', reroute: 'SUBMISSION_FAILED',
}
const BODY_FOR: Record<string, Record<string, unknown>> = {
  claim: { opsAssignee: 'ops@x.example' }, add_tracking: { trackingNumber: '1Z', carrier: 'UPS' },
}

function order(status: string) {
  db = scriptedDb(c => {
    if (c.table === 'orders' && c.op === 'select' && c.single) {
      return { data: {
        order_id: ORDER, status, patient_id: PATIENT, clinic_id: CLINIC, stripe_payment_intent_id: null, payment_group_id: null,
        retail_price_snapshot: null, reroute_count: 0, pharmacy_id: PHARMACY, ops_assignee: null,
      } }
    }
    return undefined
  })
}

beforeEach(() => {
  logMock.mockClear()
  casTransitionMock.mockReset().mockResolvedValue({ success: true, wasAlreadyTransitioned: false })
  refundsCreate.mockReset()
  routeOrderMock.mockReset()
  submitQueuedFaxMock.mockReset()
})

const ACTIONS = Object.keys(STATUS_FOR)

it('reads the order\'s patient and clinic with it', async () => {
  order('SUBMISSION_FAILED')
  await POST(req({ action: 'release' }), params)
  expect(db.to('orders', 'select')[0]?.columns).toMatch(/patient_id/)
  expect(db.to('orders', 'select')[0]?.columns).toMatch(/clinic_id/)
})

it.each(ACTIONS)('%s: update / ops_order_action with the order, patient and clinic, before any write', async action => {
  order(STATUS_FOR[action]!)
  let writesAtLog = -1
  let casAtLog = -1
  logMock.mockImplementationOnce(async () => {
    writesAtLog = db.calls.filter(c => c.op !== 'select').length
    casAtLog = casTransitionMock.mock.calls.length
    return true
  })
  await POST(req({ action, ...BODY_FOR[action] }), params)
  expect(logMock).toHaveBeenCalledTimes(1)
  expect(logMock).toHaveBeenCalledWith(expect.objectContaining({
    user: OPS, action: 'update', resource: 'ops_order_action', route: '/api/ops/orders/[orderId]/action',
    orderId: ORDER, patientId: PATIENT, clinicId: CLINIC,
  }))
  expect(writesAtLog).toBe(0)
  expect(casAtLog).toBe(0)
})

it.each(ACTIONS)('%s: the log fails, so 503 and nothing is changed', async action => {
  order(STATUS_FOR[action]!)
  logMock.mockResolvedValueOnce(false)
  const res = await POST(req({ action, ...BODY_FOR[action] }), params)
  expect(res.status).toBe(503)
  expect(await res.json()).toEqual({ error: 'This change could not be recorded. Nothing was changed. Try again.' })
  expect(db.calls.filter(c => c.op !== 'select')).toEqual([])
  expect(casTransitionMock).not.toHaveBeenCalled()
  expect(refundsCreate).not.toHaveBeenCalled()
  expect(routeOrderMock).not.toHaveBeenCalled()
  expect(submitQueuedFaxMock).not.toHaveBeenCalled()
})

it('an order that does not exist: 404, no log row', async () => {
  db = scriptedDb(() => undefined)
  expect((await POST(req({ action: 'release' }), params)).status).toBe(404)
  expect(logMock).not.toHaveBeenCalled()
})
