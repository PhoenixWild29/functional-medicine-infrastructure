/**
 * @jest-environment node
 *
 * Payment Flow v1.1: a paid bundle's members now carry the bundle's
 * PaymentIntent (orders.stripe_payment_intent_id). The refund decision
 * must check the bundle FIRST: refunding that PaymentIntent in full for
 * one member would refund the whole bundle.
 *
 * Also: the charge.refunded webhook can mark an order REFUNDED for our own
 * refund before our refund call finishes; refundedWithRefund says so.
 */

import { scriptedDb, DB_DOWN, type ScriptedCall } from '@/__tests__/helpers/scripted-db'
import { decideRefund, pendingRefund, refundedWithRefund } from '../refund'

const GROUP = 'a5000000-0000-4000-8000-000000000001'

function db(history: Array<Record<string, unknown>> = []) {
  return scriptedDb((c: ScriptedCall) => {
    if (c.table === 'payment_groups') return { data: { group_id: GROUP, status: 'PAID', stripe_payment_intent_id: 'pi_bundle', total_cents: 20900 } }
    if (c.table === 'orders') return { data: [
      { order_id: 'o-1', status: 'PAID_PROCESSING', retail_price_snapshot: 100 },
      { order_id: 'o-2', status: 'PAID_PROCESSING', retail_price_snapshot: 100 },
    ] }
    if (c.table === 'order_status_history') {
      const want = (c.filters['metadata:contains'] ?? {}) as Record<string, unknown>
      const found = history.filter(r =>
        (!('order_id' in c.filters) || r['order_id'] === c.filters['order_id'])
        && (!('new_status' in c.filters) || r['new_status'] === c.filters['new_status'])
        && Object.entries(want).every(([k, v]) => (r['metadata'] as Record<string, unknown>)[k] === v))
      return { data: c.single ? found[0] ?? null : found }
    }
    return undefined
  })
}

const member = { order_id: 'o-1', status: 'PAID_PROCESSING', stripe_payment_intent_id: 'pi_bundle', payment_group_id: GROUP, retail_price_snapshot: 100 }

describe('decideRefund: the bundle first', () => {
  it('a member carrying the bundle PaymentIntent is refunded its own share, not the whole bundle', async () => {
    const result = await decideRefund(db().client as never, member)
    expect(result).toEqual({ ok: true, target: { paymentIntentId: 'pi_bundle', amountCents: 10000, includesShipping: false } })
  })

  it('a single order is still refunded in full on its own PaymentIntent', async () => {
    const result = await decideRefund(db().client as never, { ...member, payment_group_id: null, stripe_payment_intent_id: 'pi_solo' })
    expect(result).toEqual({ ok: true, target: { paymentIntentId: 'pi_solo', amountCents: null, includesShipping: false } })
  })
})

describe('pendingRefund: no full-refund fallback for a bundle member', () => {
  it('a member with no recorded decision has no safe answer (left for ops), never the whole bundle', async () => {
    const result = await pendingRefund(db().client as never, { ...member, status: 'REFUND_PENDING' })
    expect(result).toEqual(expect.objectContaining({ ok: true, target: null }))
  })

  it('a single order still falls back to a full refund of its own PaymentIntent', async () => {
    const result = await pendingRefund(db().client as never, { ...member, status: 'REFUND_PENDING', payment_group_id: null, stripe_payment_intent_id: 'pi_solo' })
    expect(result).toEqual(expect.objectContaining({ ok: true, target: { paymentIntentId: 'pi_solo', amountCents: null, includesShipping: false } }))
  })
})

describe('refundedWithRefund', () => {
  it('true when the order was marked REFUNDED for this refund', async () => {
    const d = db([{ order_id: 'o-1', new_status: 'REFUNDED', metadata: { refund_id: 're_1', source: 'charge.refunded' } }])
    expect(await refundedWithRefund(d.client as never, 'o-1', 're_1')).toBe(true)
  })

  it('false for another refund, or no REFUNDED row', async () => {
    const d = db([{ order_id: 'o-1', new_status: 'REFUNDED', metadata: { refund_id: 're_other' } }])
    expect(await refundedWithRefund(d.client as never, 'o-1', 're_1')).toBe(false)
  })

  it('false (and logged) when it cannot be read', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    const d = scriptedDb(() => DB_DOWN)
    expect(await refundedWithRefund(d.client as never, 'o-1', 're_1')).toBe(false)
  })
})
