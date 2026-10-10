/**
 * @jest-environment node
 *
 * Payments ledger (record-only). Every money split of a paid order is
 * recorded from the frozen snapshots, one line per party and type, keyed
 * by the Stripe event (or refund) that caused it so a redelivery writes
 * nothing twice:
 *   charge           platform   + what the patient paid (retail + shipping, unless the clinic absorbs it)
 *   clinic_transfer  clinic     + the clinic's share (charge - application fee)
 *   platform_fee     platform   + 15% of the margin
 *   pharmacy_payable pharmacy   + wholesale + shipping (also a pharmacy_payables row, 'owed')
 * The four sum to the charge. Refunds and disputes are negative lines.
 * The writer never throws: a failed write is logged and reported.
 */

import { scriptedDb, type Script } from '@/__tests__/helpers/scripted-db'
import { computeOrderSplit } from '../split'
import { recordPaymentLedger, recordRefundLedger, recordDisputeLedger, recordLatePaymentLedger } from '../ledger'

const CLINIC = 'c0000000-0000-4000-8000-000000000001'
const PHARM  = 'f0000000-0000-4000-8000-000000000001'
const GROUP  = '90000000-0000-4000-8000-000000000001'
const O1 = 'a0000000-0000-4000-8000-000000000001'
const O2 = 'a0000000-0000-4000-8000-000000000002'

const order = (id: string, over: Record<string, unknown> = {}) => ({
  order_id: id, clinic_id: CLINIC, pharmacy_id: PHARM, payment_group_id: null,
  retail_price_snapshot: 200, wholesale_price_snapshot: 100, shipping_fee: 9, ...over,
})

function db(orders: Array<Record<string, unknown>>, absorb = false, extra?: Script) {
  return scriptedDb(call => {
    const a = extra?.(call)
    if (a) return a
    if (call.table === 'orders' && call.op === 'select') return { data: call.single ? orders[0] : orders }
    if (call.table === 'clinics' && call.op === 'select') return { data: { clinic_id: CLINIC, absorb_shipping: absorb } }
    if (call.table === 'ledger_entries' && call.op === 'upsert') return { data: (call.payload as unknown[]).map((_, i) => ({ entry_id: `e${i}` })) }
    if (call.table === 'pharmacy_payables' && call.op === 'select') return { data: { payable_id: 'p1', amount_cents: 10900, reversed_cents: 0, status: 'owed' } }
    return undefined
  })
}

type Line = { entry_type: string; party: string; amount_cents: number; order_id: string | null; payment_group_id: string | null; stripe_object_id: string; source_event_id: string; line_key: string; status: string; currency: string }
const lines = (d: ReturnType<typeof scriptedDb>) => d.to('ledger_entries', 'upsert').flatMap(c => c.payload as Line[])
const pick = (ls: Line[], type: string, party: string) => ls.filter(l => l.entry_type === type && l.party === party)

describe('computeOrderSplit', () => {
  it('splits a $200 retail / $100 wholesale / $9 shipping order', () => {
    expect(computeOrderSplit(order(O1), false)).toEqual({
      chargeCents: 20900, platformFeeCents: 1500, pharmacyPayableCents: 10900, clinicTransferCents: 8500, wholesaleCents: 10000, shippingCents: 900,
    })
  })

  it('a clinic that absorbs shipping is charged less and pays the shipping from its share', () => {
    const s = computeOrderSplit(order(O1), true)
    expect(s).toEqual(expect.objectContaining({ chargeCents: 20000, pharmacyPayableCents: 10900, platformFeeCents: 1500, clinicTransferCents: 7600 }))
  })

  it('the parts always sum to the charge', () => {
    for (const o of [order(O1), order(O1, { retail_price_snapshot: 99.99, wholesale_price_snapshot: 43.21, shipping_fee: 0 }), order(O1, { shipping_fee: 25 })]) {
      for (const absorb of [false, true]) {
        const s = computeOrderSplit(o, absorb)
        expect(s.clinicTransferCents + s.platformFeeCents + s.pharmacyPayableCents).toBe(s.chargeCents)
      }
    }
  })
})

describe('recordPaymentLedger', () => {
  it('a solo order: four lines from the snapshots, keyed by the event, and an owed payable', async () => {
    const d = db([order(O1)])
    const res = await recordPaymentLedger(d.client, { eventId: 'evt_1', paymentIntentId: 'pi_1', chargeId: 'ch_1', currency: 'usd', orderIds: [O1], paymentGroupId: null })
    expect(res).toEqual({ ok: true, inserted: 4 })
    const ls = lines(d)
    expect(ls).toHaveLength(4)
    expect(pick(ls, 'charge', 'platform')[0]).toEqual(expect.objectContaining({ amount_cents: 20900, stripe_object_id: 'ch_1', status: 'succeeded', currency: 'usd' }))
    expect(pick(ls, 'clinic_transfer', 'clinic')[0]!.amount_cents).toBe(8500)
    expect(pick(ls, 'platform_fee', 'platform')[0]!.amount_cents).toBe(1500)
    expect(pick(ls, 'pharmacy_payable', 'pharmacy')[0]).toEqual(expect.objectContaining({ amount_cents: 10900, order_id: O1 }))
    for (const l of ls) {
      expect(l.source_event_id).toBe('evt_1')
      expect(l.line_key).toBe(`${l.entry_type}:${l.party}:${O1}`)
    }
    const [payable] = d.to('pharmacy_payables', 'upsert').flatMap(c => c.payload as unknown[])
    expect(payable).toEqual(expect.objectContaining({
      order_id: O1, pharmacy_id: PHARM, clinic_id: CLINIC, wholesale_cents: 10000, shipping_cents: 900, amount_cents: 10900, status: 'owed',
    }))
  })

  it('a bundle: lines per member order, all on the group and its one charge', async () => {
    const d = db([order(O1, { payment_group_id: GROUP }), order(O2, { payment_group_id: GROUP, shipping_fee: 0 })])
    await recordPaymentLedger(d.client, { eventId: 'evt_2', paymentIntentId: 'pi_g', chargeId: 'ch_g', currency: 'usd', orderIds: [O1, O2], paymentGroupId: GROUP })
    const ls = lines(d)
    expect(ls).toHaveLength(8)
    expect(new Set(ls.map(l => l.payment_group_id))).toEqual(new Set([GROUP]))
    expect(pick(ls, 'charge', 'platform').map(l => l.amount_cents)).toEqual([20900, 20000])
    expect(pick(ls, 'charge', 'platform').every(l => l.stripe_object_id === 'ch_g')).toBe(true)
    expect(d.to('pharmacy_payables', 'upsert').flatMap(c => c.payload as unknown[])).toHaveLength(2)
  })

  it('a failed write is reported, never thrown', async () => {
    const d = db([order(O1)], false, c => (c.table === 'ledger_entries' ? { error: { message: 'down' } } : undefined))
    jest.spyOn(console, 'error').mockImplementation(() => {})
    await expect(recordPaymentLedger(d.client, { eventId: 'evt_1', paymentIntentId: 'pi_1', chargeId: null, currency: 'usd', orderIds: [O1], paymentGroupId: null }))
      .resolves.toEqual({ ok: false, error: expect.any(String) })
  })
})

describe('recordRefundLedger', () => {
  it('a full refund: the refund and its reversals net the charge to zero, and voids an unpaid payable', async () => {
    const d = db([order(O1)])
    const res = await recordRefundLedger(d.client, { orderId: O1, refundId: 're_1', amountCents: null, currency: 'usd' })
    expect(res.ok).toBe(true)
    const ls = lines(d)
    expect(pick(ls, 'refund', 'platform')[0]).toEqual(expect.objectContaining({ amount_cents: -20900, stripe_object_id: 're_1', source_event_id: 're_1' }))
    expect(pick(ls, 'reversal', 'clinic')[0]!.amount_cents).toBe(-8500)
    expect(pick(ls, 'reversal', 'platform')[0]!.amount_cents).toBe(-1500)
    expect(pick(ls, 'reversal', 'pharmacy')[0]!.amount_cents).toBe(-10900)
    const [upd] = d.to('pharmacy_payables', 'update')
    expect(upd!.payload).toEqual(expect.objectContaining({ reversed_cents: 10900, status: 'void' }))
    expect(upd!.filters).toEqual(expect.objectContaining({ order_id: O1, 'status:in': ['owed', 'scheduled'] }))
  })

  it('a partial refund prorates the reversals, which still sum to the refund', async () => {
    const d = db([order(O1)])
    await recordRefundLedger(d.client, { orderId: O1, refundId: 're_2', amountCents: 10450, currency: 'usd' })
    const ls = lines(d)
    const reversals = ls.filter(l => l.entry_type === 'reversal').reduce((s, l) => s + l.amount_cents, 0)
    expect(pick(ls, 'refund', 'platform')[0]!.amount_cents).toBe(-10450)
    expect(reversals).toBe(-10450)
    expect(pick(ls, 'reversal', 'clinic')[0]!.amount_cents).toBe(-4250)
    const [upd] = d.to('pharmacy_payables', 'update')
    expect((upd!.payload as Record<string, unknown>)['status']).toBeUndefined()
  })

  it('a refund already recorded (same refund id) does not touch the payable again', async () => {
    const d = db([order(O1)], false, c => (c.table === 'ledger_entries' && c.op === 'upsert' ? { data: [] } : undefined))
    await recordRefundLedger(d.client, { orderId: O1, refundId: 're_1', amountCents: null, currency: 'usd' })
    expect(d.to('pharmacy_payables', 'update')).toEqual([])
  })
})

describe('recordDisputeLedger', () => {
  it('records the disputed amount as an open, negative platform line', async () => {
    const d = db([order(O1)])
    await recordDisputeLedger(d.client, { eventId: 'evt_d', disputeId: 'du_1', amountCents: 20900, currency: 'usd', status: 'needs_response', orderId: O1, paymentGroupId: null, clinicId: CLINIC })
    const [l] = lines(d)
    expect(l).toEqual(expect.objectContaining({ entry_type: 'dispute', party: 'platform', amount_cents: -20900, stripe_object_id: 'du_1', status: 'open', source_event_id: 'evt_d', order_id: O1 }))
  })
})

describe('recordLatePaymentLedger', () => {
  it('a late payment on an expired bundle: the charge and its full refund, on the group', async () => {
    const d = db([])
    await recordLatePaymentLedger(d.client, { eventId: 'evt_l', paymentIntentId: 'pi_l', chargeId: 'ch_l', amountCents: 30000, currency: 'usd', paymentGroupId: GROUP, clinicId: CLINIC, refundId: 're_l' })
    const ls = lines(d)
    expect(pick(ls, 'charge', 'platform')[0]).toEqual(expect.objectContaining({ amount_cents: 30000, payment_group_id: GROUP, order_id: null }))
    expect(pick(ls, 'refund', 'platform')[0]).toEqual(expect.objectContaining({ amount_cents: -30000, stripe_object_id: 're_l' }))
  })
})
