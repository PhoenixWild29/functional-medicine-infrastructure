/**
 * @jest-environment node
 *
 * Payment Flow v1.1: charge.refunded (incl. refunds issued from the Stripe
 * Dashboard).
 *
 *   - a refund that may transition: REFUND_PENDING → REFUNDED;
 *   - one that may not (the order shipped / is still being filled): the
 *     status is left alone, the refund recorded, ops alerted;
 *   - a Dashboard refund without reverse_transfer: the clinic transfer and
 *     platform fee are reversed in proportion, with idempotency keys from
 *     the refund id;
 *   - a reversal skipped because it was already done (our refunds always
 *     reverse; or nothing is left to reverse);
 *   - a bundle: our refund of one member touches only that member;
 *   - the same refund twice records, reverses and alerts once;
 *   - the ledger hook point is called per refund.
 * Stripe is mocked throughout; nothing here can reach a real account.
 */

import type Stripe from 'stripe'
import { scriptedDb, type ScriptedCall } from '@/__tests__/helpers/scripted-db'
import { handleChargeRefunded } from '../handle-charge-refunded'

const GROUP = 'a5000000-0000-4000-8000-000000000001'

type Row = Record<string, unknown> & { order_id: string; metadata: Record<string, unknown> | null; created_at?: string }

function matches(row: Row, f: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(f)) {
    if (k === 'order_id' && row.order_id !== v) return false
    if (k === 'order_id:in' && !(v as string[]).includes(row.order_id)) return false
    if (k === 'new_status' && row['new_status'] !== v) return false
    if (k === 'old_status' && row['old_status'] !== v) return false
    if (k === 'old_status:neq' && row['old_status'] === v) return false
    if (k === 'metadata:contains' && !Object.entries(v as object).every(([mk, mv]) => row.metadata?.[mk] === mv)) return false
  }
  return true
}

interface World {
  orders: Array<{ order_id: string; status: string; payment_group_id?: string | null }>
  group?: boolean
  history?: Row[]
}

function world(w: World) {
  const history: Row[] = [...(w.history ?? [])]
  const db = scriptedDb((c: ScriptedCall) => {
    if (c.table === 'payment_groups') {
      return { data: w.group ? { group_id: GROUP, status: 'PAID', stripe_payment_intent_id: 'pi_1' } : null }
    }
    if (c.table === 'orders') {
      const rows = w.orders.map(o => ({ payment_group_id: null, stripe_payment_intent_id: 'pi_1', retail_price_snapshot: 50, ...o }))
      return { data: c.single ? rows[0] ?? null : rows }
    }
    if (c.table === 'order_status_history' && c.op === 'insert') {
      history.push(...(c.payload as Row[]))
      return { data: null }
    }
    if (c.table === 'order_status_history') {
      const found = history.filter(r => matches(r, c.filters))
      return { data: c.single ? found[found.length - 1] ?? null : found }
    }
    return undefined
  })
  return { db, history }
}

function charge(over: Partial<Stripe.Charge> = {}): Stripe.Charge {
  return {
    id: 'ch_1', payment_intent: 'pi_1', amount: 10000, amount_refunded: 10000, refunded: true,
    transfer: 'tr_1', application_fee: 'fee_1', metadata: { platform: '8090ai' }, ...over,
  } as unknown as Stripe.Charge
}
const refund = (over: Partial<Stripe.Refund> = {}) =>
  ({ id: 're_1', amount: 10000, currency: 'usd', status: 'succeeded', transfer_reversal: null, ...over }) as unknown as Stripe.Refund

function stripeMock(refunds: Stripe.Refund[], transfer = { amount: 10000, amount_reversed: 0 }, fee = { amount: 1500, amount_refunded: 0 }) {
  return {
    refunds:         { list: jest.fn().mockResolvedValue({ data: refunds }) },
    transfers:       { retrieve: jest.fn().mockResolvedValue(transfer), createReversal: jest.fn().mockResolvedValue({ id: 'trr_new' }) },
    applicationFees: { retrieve: jest.fn().mockResolvedValue(fee), createRefund: jest.fn().mockResolvedValue({ id: 'fr_new' }) },
  }
}

const casTransition = jest.fn()
const sendSlackAlert = jest.fn().mockResolvedValue(undefined)
const buildStripePaymentAlert = jest.fn((p: unknown) => p as never)
const recordRefundInLedger = jest.fn().mockResolvedValue(undefined)

function run(db: ReturnType<typeof scriptedDb>, stripe: ReturnType<typeof stripeMock>, ch = charge(), eventId = 'evt_1') {
  return handleChargeRefunded(ch, eventId, {
    supabase: db.client as never, stripe: stripe as never, casTransition: casTransition as never,
    sendSlackAlert, buildStripePaymentAlert, recordRefundInLedger,
  })
}

const pendingTransition = (orderId: string, amountCents: number | null) => ({
  order_id: orderId, old_status: 'PAID_PROCESSING', new_status: 'REFUND_PENDING', created_at: '2026-10-09T00:00:00Z',
  metadata: { refund_pi: 'pi_1', refund_amount_cents: amountCents, refund_includes_shipping: false },
})

beforeEach(() => {
  casTransition.mockReset().mockResolvedValue({ success: true, wasAlreadyTransitioned: false })
  sendSlackAlert.mockClear()
  buildStripePaymentAlert.mockClear()
  recordRefundInLedger.mockClear()
  for (const l of ['info', 'warn', 'error'] as const) jest.spyOn(console, l).mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('a refund that is allowed to transition', () => {
  it('REFUND_PENDING → REFUNDED; recorded with the refund id and amount; no alert', async () => {
    const { db, history } = world({ orders: [{ order_id: 'o-1', status: 'REFUND_PENDING' }], history: [pendingTransition('o-1', null)] })
    const stripe = stripeMock([refund()])
    await run(db, stripe)

    expect(casTransition).toHaveBeenCalledWith({
      orderId: 'o-1', expectedStatus: 'REFUND_PENDING', newStatus: 'REFUNDED', actor: 'stripe_webhook',
      metadata: { refund_id: 're_1', source: 'charge.refunded' },
    })
    const synced = history.find(r => r.metadata?.['event'] === 'stripe_refund_synced')!
    expect(synced.metadata).toEqual(expect.objectContaining({
      refund_id: 're_1', amount_cents: 10000, currency: 'usd', payment_intent: 'pi_1', outcome: 'refunded', attribution: 'single_order',
    }))
    expect(sendSlackAlert).not.toHaveBeenCalled()
  })
})

describe('a refund that is not allowed to transition', () => {
  it.each(['SHIPPED', 'PAID_PROCESSING', 'DELIVERED'])('%s: status unchanged, recorded, ops alerted', async status => {
    const { db, history } = world({ orders: [{ order_id: 'o-1', status }] })
    await run(db, stripeMock([refund()]))
    expect(casTransition).not.toHaveBeenCalled()
    const synced = history.find(r => r.metadata?.['event'] === 'stripe_refund_synced')!
    expect(synced).toEqual(expect.objectContaining({ old_status: status, new_status: status }))
    expect(synced.metadata).toEqual(expect.objectContaining({ outcome: 'unchanged' }))
    expect(buildStripePaymentAlert).toHaveBeenCalledWith(expect.objectContaining({
      type: 'stripe_refund_unsynced', orderId: 'o-1',
      details: expect.objectContaining({ refund_id: 're_1', payment_intent: 'pi_1', amount: 10000, currency: 'usd' }),
    }))
  })
})

describe('the clinic transfer and platform fee', () => {
  it('a Dashboard refund without reverse_transfer: both reversed in proportion, keyed by the refund id', async () => {
    const { db } = world({ orders: [{ order_id: 'o-1', status: 'SHIPPED' }] })
    const stripe = stripeMock([refund({ amount: 2500 })])
    await run(db, stripe, charge({ amount_refunded: 2500, refunded: false }))
    expect(stripe.transfers.createReversal).toHaveBeenCalledWith('tr_1', { amount: 2500 }, { idempotencyKey: 'dashboard-refund:re_1:transfer' })
    expect(stripe.applicationFees.createRefund).toHaveBeenCalledWith('fee_1', { amount: 375 }, { idempotencyKey: 'dashboard-refund:re_1:fee' })
  })

  it('skipped when our refund path already reversed it (refund.transfer_reversal set)', async () => {
    const { db } = world({
      orders: [{ order_id: 'o-1', status: 'REFUNDED' }],
      history: [{ order_id: 'o-1', old_status: 'REFUND_PENDING', new_status: 'REFUNDED', metadata: { refund_id: 're_1' } }],
    })
    const stripe = stripeMock([refund({ transfer_reversal: 'trr_inapp' })])
    await run(db, stripe)
    expect(stripe.transfers.retrieve).not.toHaveBeenCalled()
    expect(stripe.transfers.createReversal).not.toHaveBeenCalled()
    expect(stripe.applicationFees.createRefund).not.toHaveBeenCalled()
    expect(sendSlackAlert).not.toHaveBeenCalled()
  })

  it('capped at what is left: a transfer and fee already reversed are not reversed again', async () => {
    const { db } = world({ orders: [{ order_id: 'o-1', status: 'SHIPPED' }] })
    const stripe = stripeMock([refund()], { amount: 10000, amount_reversed: 10000 }, { amount: 1500, amount_refunded: 1500 })
    await run(db, stripe)
    expect(stripe.transfers.createReversal).not.toHaveBeenCalled()
    expect(stripe.applicationFees.createRefund).not.toHaveBeenCalled()
  })

  it('a reversal that fails throws before anything is recorded (Stripe redelivers)', async () => {
    const { db, history } = world({ orders: [{ order_id: 'o-1', status: 'SHIPPED' }] })
    const stripe = stripeMock([refund()])
    stripe.transfers.createReversal.mockRejectedValue(new Error('stripe down'))
    await expect(run(db, stripe)).rejects.toThrow('stripe down')
    expect(history).toHaveLength(0)
  })
})

describe('idempotency', () => {
  it('the same refund twice: recorded, reversed and alerted once', async () => {
    const { db, history } = world({ orders: [{ order_id: 'o-1', status: 'SHIPPED' }] })
    const stripe = stripeMock([refund()])
    await run(db, stripe, charge(), 'evt_1')
    await run(db, stripe, charge(), 'evt_2')
    expect(history.filter(r => r.metadata?.['event'] === 'stripe_refund_synced')).toHaveLength(1)
    expect(stripe.transfers.createReversal).toHaveBeenCalledTimes(1)
    expect(sendSlackAlert).toHaveBeenCalledTimes(1)
  })

  it('a refund that has not succeeded is left for its own event', async () => {
    const { db, history } = world({ orders: [{ order_id: 'o-1', status: 'SHIPPED' }] })
    await run(db, stripeMock([refund({ status: 'pending' })]))
    expect(history).toHaveLength(0)
  })
})

describe('a bundle', () => {
  const members = [
    { order_id: 'o-1', status: 'PAID_PROCESSING', payment_group_id: GROUP },
    { order_id: 'o-2', status: 'REFUNDED', payment_group_id: GROUP },
  ]

  it('our refund of one member touches only that member: no alert for the others', async () => {
    const { db, history } = world({
      group: true, orders: members,
      history: [{ order_id: 'o-2', old_status: 'REFUND_PENDING', new_status: 'REFUNDED', metadata: { refund_id: 're_1' } }],
    })
    await run(db, stripeMock([refund({ amount: 5000, transfer_reversal: 'trr_inapp' })]), charge({ amount_refunded: 5000, refunded: false, metadata: { payment_group_id: GROUP } }))
    const synced = history.filter(r => r.metadata?.['event'] === 'stripe_refund_synced')
    expect(synced.map(r => r.order_id)).toEqual(['o-2'])
    expect(synced[0]!.metadata).toEqual(expect.objectContaining({ attribution: 'in_app', outcome: 'already_refunded' }))
    expect(sendSlackAlert).not.toHaveBeenCalled()
  })

  it('our refund the event beat to the database: the pending member is marked REFUNDED', async () => {
    const { db } = world({
      group: true,
      orders: [{ order_id: 'o-1', status: 'PAID_PROCESSING', payment_group_id: GROUP }, { order_id: 'o-2', status: 'REFUND_PENDING', payment_group_id: GROUP }],
      history: [pendingTransition('o-2', 5000)],
    })
    await run(db, stripeMock([refund({ amount: 5000, transfer_reversal: 'trr_inapp' })]), charge({ amount_refunded: 5000, refunded: false }))
    expect(casTransition).toHaveBeenCalledTimes(1)
    expect(casTransition).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'o-2', newStatus: 'REFUNDED' }))
    expect(sendSlackAlert).not.toHaveBeenCalled()
  })

  it('a Dashboard partial refund on a bundle: recorded on every member, ops alerted', async () => {
    const { db, history } = world({ group: true, orders: members })
    await run(db, stripeMock([refund({ amount: 3000 })]), charge({ amount_refunded: 3000, refunded: false }))
    const synced = history.filter(r => r.metadata?.['event'] === 'stripe_refund_synced')
    expect(synced.map(r => r.order_id)).toEqual(['o-1', 'o-2'])
    expect(synced[0]!.metadata).toEqual(expect.objectContaining({ attribution: 'unattributed', payment_group_id: GROUP }))
    expect(sendSlackAlert).toHaveBeenCalledTimes(1)
  })
})

it('calls the ledger hook point once per refund, with the refund id and amount', async () => {
  const { db } = world({ orders: [{ order_id: 'o-1', status: 'SHIPPED' }] })
  await run(db, stripeMock([refund({ amount: 2500 })]), charge({ amount_refunded: 2500, refunded: false }))
  expect(recordRefundInLedger).toHaveBeenCalledTimes(1)
  expect(recordRefundInLedger).toHaveBeenCalledWith({
    refundId: 're_1', paymentIntentId: 'pi_1', chargeId: 'ch_1', amountCents: 2500, currency: 'usd',
    orderIds: ['o-1'], paymentGroupId: null, reversedByWebhook: true,
  })
})
