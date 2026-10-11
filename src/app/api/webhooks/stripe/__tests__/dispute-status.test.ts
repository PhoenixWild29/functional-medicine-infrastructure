/**
 * @jest-environment node
 *
 * Payment Flow v1.1: charge.dispute.updated / charge.dispute.closed.
 *
 *   - disputes.status follows Stripe;
 *   - every order the dispute covers gets an event row with the new status;
 *     its order status is never changed;
 *   - closed as lost alerts ops (IDs, codes, amount); won does not;
 *   - the same status twice records and alerts once;
 *   - a dispute we never saw open is recorded first (the created handler).
 */

import type Stripe from 'stripe'
import { scriptedDb, type ScriptedCall } from '@/__tests__/helpers/scripted-db'
import { handleDisputeStatusChanged } from '../handle-dispute-status'

type Row = { order_id: string; metadata: Record<string, unknown> }

function world(opts: { disputeRow?: { order_id: string } | null; links: string[]; orders: Array<{ order_id: string; status: string }> }) {
  const history: Row[] = []
  const db = scriptedDb((c: ScriptedCall) => {
    if (c.table === 'disputes' && c.op === 'select') return { data: opts.disputeRow === undefined ? { dispute_id: 'dp_1', order_id: opts.links[0], status: 'needs_response' } : opts.disputeRow }
    if (c.table === 'dispute_orders') return { data: opts.links.map(order_id => ({ order_id })) }
    if (c.table === 'orders') return { data: opts.orders }
    if (c.table === 'order_status_history' && c.op === 'insert') { history.push(...(c.payload as Row[])); return { data: null } }
    if (c.table === 'order_status_history') {
      const want = c.filters['metadata:contains'] as Record<string, unknown>
      return { data: history.filter(r => Object.entries(want).every(([k, v]) => r.metadata[k] === v)) }
    }
    return undefined
  })
  return { db, history }
}

const dispute = (status: Stripe.Dispute.Status) =>
  ({ id: 'dp_1', status, reason: 'fraudulent', amount: 10000, currency: 'usd', payment_intent: 'pi_1', metadata: {} }) as unknown as Stripe.Dispute

const sendSlackAlert = jest.fn().mockResolvedValue(undefined)
const buildStripePaymentAlert = jest.fn((p: unknown) => p as never)
const recordDisputeCreated = jest.fn().mockResolvedValue(undefined)
const deps = (db: ReturnType<typeof scriptedDb>) => ({ supabase: db.client as never, sendSlackAlert, buildStripePaymentAlert, recordDisputeCreated })

beforeEach(() => {
  sendSlackAlert.mockClear(); buildStripePaymentAlert.mockClear(); recordDisputeCreated.mockClear()
  for (const l of ['info', 'warn', 'error'] as const) jest.spyOn(console, l).mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

it('a solo dispute updated: disputes.status follows, the order gets an event row, its status is untouched', async () => {
  const { db, history } = world({ links: ['o-1'], orders: [{ order_id: 'o-1', status: 'SHIPPED' }] })
  await handleDisputeStatusChanged(dispute('under_review'), 'charge.dispute.updated', 'evt_1', deps(db))

  expect(db.to('disputes', 'update')[0]!.payload).toEqual(expect.objectContaining({ status: 'under_review' }))
  expect(db.calls.some(c => c.table === 'orders' && c.op === 'update')).toBe(false)
  expect(history).toEqual([expect.objectContaining({
    order_id: 'o-1', old_status: 'SHIPPED', new_status: 'SHIPPED',
    metadata: expect.objectContaining({ event: 'stripe_dispute_status', dispute_id: 'dp_1', dispute_status: 'under_review', stripe_event: 'charge.dispute.updated' }),
  })])
  expect(sendSlackAlert).not.toHaveBeenCalled()
})

it('a group dispute closed as lost: every member recorded, ops alerted once', async () => {
  const { db, history } = world({ links: ['o-1', 'o-2'], orders: [{ order_id: 'o-1', status: 'SHIPPED' }, { order_id: 'o-2', status: 'DELIVERED' }] })
  await handleDisputeStatusChanged(dispute('lost'), 'charge.dispute.closed', 'evt_1', deps(db))
  expect(history.map(r => r.order_id)).toEqual(['o-1', 'o-2'])
  expect(buildStripePaymentAlert).toHaveBeenCalledWith({
    type: 'stripe_dispute_lost', orderId: 'o-1',
    details: { dispute_id: 'dp_1', dispute_status: 'lost', dispute_reason: 'fraudulent', amount: 10000, currency: 'usd', count: 2 },
  })
  expect(sendSlackAlert).toHaveBeenCalledTimes(1)
})

it('closed as won: recorded, no alert', async () => {
  const { db, history } = world({ links: ['o-1'], orders: [{ order_id: 'o-1', status: 'SHIPPED' }] })
  await handleDisputeStatusChanged(dispute('won'), 'charge.dispute.closed', 'evt_1', deps(db))
  expect(history).toHaveLength(1)
  expect(sendSlackAlert).not.toHaveBeenCalled()
})

it('the same status twice: recorded and alerted once', async () => {
  const { db, history } = world({ links: ['o-1'], orders: [{ order_id: 'o-1', status: 'SHIPPED' }] })
  await handleDisputeStatusChanged(dispute('lost'), 'charge.dispute.closed', 'evt_1', deps(db))
  await handleDisputeStatusChanged(dispute('lost'), 'charge.dispute.closed', 'evt_1', deps(db))
  expect(history).toHaveLength(1)
  expect(sendSlackAlert).toHaveBeenCalledTimes(1)
})

it('a dispute we never saw open is recorded first by the created handler', async () => {
  const { db } = world({ disputeRow: null, links: ['o-1'], orders: [{ order_id: 'o-1', status: 'SHIPPED' }] })
  await handleDisputeStatusChanged(dispute('needs_response'), 'charge.dispute.updated', 'evt_1', deps(db))
  expect(recordDisputeCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'dp_1' }))
  expect(db.to('disputes', 'update')).toHaveLength(0)
})
