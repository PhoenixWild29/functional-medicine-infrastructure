/**
 * @jest-environment node
 *
 * Payment Flow v1.1: payment_intent.payment_failed.
 *
 *   - the order stays AWAITING_PAYMENT (no transition), so the patient can
 *     retry on the same link;
 *   - an event row records the failure code, the decline reason code and
 *     the PaymentIntent id, and never card data (no message, no payment
 *     method);
 *   - one ops alert, IDs and codes only;
 *   - idempotent on the Stripe event id: the same event twice records and
 *     alerts once;
 *   - a bundle records on every member still awaiting payment;
 *   - a database error throws (Stripe redelivers).
 */

import type Stripe from 'stripe'
import { scriptedDb, DB_DOWN, type ScriptedCall } from '@/__tests__/helpers/scripted-db'
import { handlePaymentFailed } from '../handle-payment-failed'

const GROUP = 'a5000000-0000-4000-8000-000000000001'
const sendSlackAlert = jest.fn().mockResolvedValue(undefined)
const buildStripePaymentAlert = jest.fn((p: unknown) => p as never)

function pi(over: Partial<Stripe.PaymentIntent> = {}): Stripe.PaymentIntent {
  return {
    id: 'pi_solo_1',
    metadata: { order_id: 'a0000000-0000-4000-8000-000000000001', clinic_id: 'c0000000-0000-4000-8000-000000000001', platform: '8090ai' },
    last_payment_error: {
      type: 'card_error', code: 'card_declined', decline_code: 'insufficient_funds',
      message: 'Your card ending 4242 was declined.',
      payment_method: { id: 'pm_1', card: { last4: '4242', brand: 'visa' } },
    },
    ...over,
  } as unknown as Stripe.PaymentIntent
}

/** A store of history rows, so "twice" is measured. */
function world(opts: { orders: Array<{ order_id: string; status: string; payment_group_id?: string | null }>; group?: boolean; fail?: string }) {
  const history: Array<Record<string, unknown>> = []
  const db = scriptedDb((c: ScriptedCall) => {
    if (opts.fail && c.table === opts.fail) return DB_DOWN
    if (c.table === 'payment_groups') {
      return { data: opts.group ? { group_id: GROUP, status: 'AWAITING_PAYMENT', stripe_payment_intent_id: c.filters['stripe_payment_intent_id'] ?? 'pi_group_1' } : null }
    }
    if (c.table === 'orders') {
      const rows = opts.orders.map(o => ({ payment_group_id: null, stripe_payment_intent_id: 'pi', retail_price_snapshot: 100, ...o }))
      return { data: c.single ? rows[0] ?? null : rows }
    }
    if (c.table === 'order_status_history' && c.op === 'insert') {
      history.push(...(c.payload as Array<Record<string, unknown>>))
      return { data: null }
    }
    if (c.table === 'order_status_history') {
      const want = c.filters['metadata:contains'] as Record<string, unknown>
      return { data: history.filter(r => Object.entries(want).every(([k, v]) => (r['metadata'] as Record<string, unknown>)[k] === v)) }
    }
    return undefined
  })
  return { db, history }
}

const deps = (db: ReturnType<typeof scriptedDb>) => ({ supabase: db.client as never, sendSlackAlert, buildStripePaymentAlert })

beforeEach(() => {
  sendSlackAlert.mockClear()
  buildStripePaymentAlert.mockClear()
  for (const l of ['info', 'warn', 'error'] as const) jest.spyOn(console, l).mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

it('records the failure on the order, leaves it AWAITING_PAYMENT, and alerts ops once with IDs only', async () => {
  const { db, history } = world({ orders: [{ order_id: 'o-1', status: 'AWAITING_PAYMENT' }] })
  await handlePaymentFailed(pi(), 'evt_1', deps(db))

  expect(db.calls.some(c => c.table === 'orders' && c.op === 'update')).toBe(false)
  expect(history).toEqual([{
    order_id: 'o-1', old_status: 'AWAITING_PAYMENT', new_status: 'AWAITING_PAYMENT', changed_by: 'stripe_webhook',
    metadata: {
      event: 'stripe_payment_failed', stripe_event_id: 'evt_1', payment_intent: 'pi_solo_1',
      failure_code: 'card_declined', decline_reason: 'insufficient_funds', payment_group_id: null,
    },
  }])
  // No card data anywhere.
  expect(JSON.stringify(history)).not.toMatch(/4242|visa|pm_1|declined\./)

  expect(sendSlackAlert).toHaveBeenCalledTimes(1)
  expect(buildStripePaymentAlert).toHaveBeenCalledWith({
    type: 'stripe_payment_failed', orderId: 'o-1', status: 'AWAITING_PAYMENT',
    details: { payment_intent: 'pi_solo_1', code: 'card_declined', decline_code: 'insufficient_funds', group_id: null, count: 1 },
  })
})

it('the same event twice records once and alerts once (idempotent on the event id)', async () => {
  const { db, history } = world({ orders: [{ order_id: 'o-1', status: 'AWAITING_PAYMENT' }] })
  await handlePaymentFailed(pi(), 'evt_1', deps(db))
  await handlePaymentFailed(pi(), 'evt_1', deps(db))
  expect(history).toHaveLength(1)
  expect(sendSlackAlert).toHaveBeenCalledTimes(1)
})

it('a second, different failure on the same link is recorded too', async () => {
  const { db, history } = world({ orders: [{ order_id: 'o-1', status: 'AWAITING_PAYMENT' }] })
  await handlePaymentFailed(pi(), 'evt_1', deps(db))
  await handlePaymentFailed(pi(), 'evt_2', deps(db))
  expect(history).toHaveLength(2)
})

it('a bundle: recorded on every member still awaiting payment, one alert', async () => {
  const { db, history } = world({
    group: true,
    orders: [
      { order_id: 'o-1', status: 'AWAITING_PAYMENT', payment_group_id: GROUP },
      { order_id: 'o-2', status: 'AWAITING_PAYMENT', payment_group_id: GROUP },
      { order_id: 'o-3', status: 'CANCELLED', payment_group_id: GROUP },
    ],
  })
  await handlePaymentFailed(pi({ id: 'pi_group_1', metadata: { payment_group_id: GROUP, platform: '8090ai' } }), 'evt_g', deps(db))
  expect(history.map(r => r['order_id'])).toEqual(['o-1', 'o-2'])
  expect((history[0]!['metadata'] as Record<string, unknown>)['payment_group_id']).toBe(GROUP)
  expect(sendSlackAlert).toHaveBeenCalledTimes(1)
})

it('a non-token code is dropped, never recorded as text', async () => {
  const { db, history } = world({ orders: [{ order_id: 'o-1', status: 'AWAITING_PAYMENT' }] })
  await handlePaymentFailed(pi({ last_payment_error: { code: 'Card 4242 bad', decline_code: undefined } as never }), 'evt_1', deps(db))
  expect(history[0]!['metadata']).toEqual(expect.objectContaining({ failure_code: null, decline_reason: null }))
})

it('nothing awaiting payment (already paid): nothing recorded, no alert', async () => {
  const { db, history } = world({ orders: [{ order_id: 'o-1', status: 'PAID_PROCESSING' }] })
  await handlePaymentFailed(pi(), 'evt_1', deps(db))
  expect(history).toHaveLength(0)
  expect(sendSlackAlert).not.toHaveBeenCalled()
})

it('a database error throws, so Stripe redelivers', async () => {
  const { db } = world({ orders: [{ order_id: 'o-1', status: 'AWAITING_PAYMENT' }], fail: 'orders' })
  await expect(handlePaymentFailed(pi(), 'evt_1', deps(db))).rejects.toThrow()
  expect(sendSlackAlert).not.toHaveBeenCalled()
})

it('a PHI metadata key is logged by name, and the failure still recorded', async () => {
  const { db, history } = world({ orders: [{ order_id: 'o-1', status: 'AWAITING_PAYMENT' }] })
  await handlePaymentFailed(pi({ metadata: { order_id: 'x', patient_name: 'Jane' } }), 'evt_1', deps(db))
  expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/PHI keys detected .*patient_name/))
  expect(JSON.stringify((console.error as jest.Mock).mock.calls)).not.toContain('Jane')
  expect(history).toHaveLength(1)
})
