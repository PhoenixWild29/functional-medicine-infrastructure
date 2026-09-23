/**
 * WO-107: the practice dashboard's numbers reconcile to the orders table.
 *
 * Revenue, clinic payout, platform fee and shipping must equal a direct
 * sum over the same orders for the same period. The "direct sum" below is
 * written independently of lib/practice/metrics, the way someone checking
 * the dashboard against the table by hand would do it.
 *
 * Refunded and cancelled orders (and every other status whose money was
 * not taken) are counted and labelled on their own, never mixed into
 * revenue. A payment group's shipping is counted once, not once per order.
 */

import {
  breakdown,
  breakdownCsv,
  bucketOf,
  periodBounds,
  practiceTotals,
  type PracticeGroupShipping,
  type PracticeOrder,
} from '../metrics'

let n = 0
function order(over: Partial<PracticeOrder>): PracticeOrder {
  n++
  return {
    orderId: `o-${n}`, status: 'DELIVERED', createdAt: '2026-09-10T12:00:00.000Z',
    retailCents: 20000, wholesaleCents: 10000, shippingFeeCents: 0, paymentGroupId: null,
    providerId: 'p-chen', providerName: 'Sarah Chen', pharmacyId: 'ph-strive', pharmacyName: 'Strive Pharmacy',
    medicationName: 'Semaglutide 5mg/mL', ...over,
  }
}

// A month of one clinic's orders.
const ORDERS: PracticeOrder[] = [
  // A payment group: two collected orders, shipping allocated $22 / $0
  // (and the group's shipping_total is $22).
  order({ status: 'DELIVERED',       retailCents: 19000, wholesaleCents: 9500, shippingFeeCents: 2200, paymentGroupId: 'g-1' }),
  order({ status: 'SHIPPED',         retailCents: 13000, wholesaleCents: 6500, shippingFeeCents: 0,    paymentGroupId: 'g-1', medicationName: 'BPC-157 5mg' }),
  // Combine and Send bundled two solo orders AFTER signing: each kept its
  // own full shipping_fee, but the group charged $9 once.
  order({ status: 'PAID_PROCESSING', retailCents: 15000, wholesaleCents: 9000, shippingFeeCents: 900, paymentGroupId: 'g-2', pharmacyId: 'ph-quick', pharmacyName: 'Quick Rx' }),
  order({ status: 'FAX_QUEUED',      retailCents: 12000, wholesaleCents: 8000, shippingFeeCents: 900, paymentGroupId: 'g-2', pharmacyId: 'ph-quick', pharmacyName: 'Quick Rx' }),
  // Solo, collected, $12 shipping.
  order({ status: 'SUBMISSION_FAILED', retailCents: 11000, wholesaleCents: 5000, shippingFeeCents: 1200, providerId: 'p-patel', providerName: 'Raj Patel' }),
  // Below cost (a margin of zero or less carries no fee).
  order({ status: 'DELIVERED',       retailCents: 9000, wholesaleCents: 9500, shippingFeeCents: 0 }),
  // Money not taken, or given back — labelled, never revenue.
  order({ status: 'AWAITING_PAYMENT', retailCents: 50000 }),
  order({ status: 'PAYMENT_EXPIRED',  retailCents: 40000 }),
  order({ status: 'ERROR_PAYMENT_FAILED', retailCents: 30000 }),
  order({ status: 'REFUND_PENDING',   retailCents: 25000, shippingFeeCents: 900 }),
  order({ status: 'REFUNDED',         retailCents: 21000, shippingFeeCents: 900, paymentGroupId: 'g-3' }),
  order({ status: 'CANCELLED',        retailCents: 17000 }),
  order({ status: 'DISPUTED',         retailCents: 16000 }),
  // Drafts are not scripts yet.
  order({ status: 'DRAFT',            retailCents: 99900 }),
]
const GROUPS: PracticeGroupShipping[] = [
  { groupId: 'g-1', shippingTotalCents: 2200 },
  { groupId: 'g-2', shippingTotalCents: 900 },
  { groupId: 'g-3', shippingTotalCents: 900 },
]

/** The direct sum: what a person reconciling against the table computes. */
function directSum(orders: PracticeOrder[], groups: PracticeGroupShipping[], absorb: boolean) {
  const notTaken = new Set(['DRAFT', 'AWAITING_PAYMENT', 'PAYMENT_EXPIRED', 'ERROR_PAYMENT_FAILED', 'REFUND_PENDING', 'REFUNDED', 'CANCELLED', 'DISPUTED'])
  const paid = orders.filter(o => !notTaken.has(o.status))
  const revenue = paid.reduce((s, o) => s + o.retailCents, 0)
  const wholesale = paid.reduce((s, o) => s + o.wholesaleCents, 0)
  const fee = paid.reduce((s, o) => s + (o.retailCents > o.wholesaleCents ? Math.round((o.retailCents - o.wholesaleCents) * 0.15) : 0), 0)
  const groupIds = new Set(paid.map(o => o.paymentGroupId).filter(Boolean))
  const shipping = paid.filter(o => !o.paymentGroupId).reduce((s, o) => s + o.shippingFeeCents, 0)
    + groups.filter(g => groupIds.has(g.groupId)).reduce((s, g) => s + g.shippingTotalCents, 0)
  return { revenue, wholesale, fee, shipping, payout: revenue - wholesale - fee - (absorb ? shipping : 0), paidCount: paid.length }
}

describe('the totals reconcile to a direct sum over the same orders', () => {
  it.each([false, true])('revenue, payout, platform fee and shipping match (clinic absorbs shipping: %s)', absorb => {
    const t = practiceTotals(ORDERS, GROUPS, { absorbShipping: absorb })
    const d = directSum(ORDERS, GROUPS, absorb)
    expect({
      revenue: t.revenueCents, fee: t.platformFeeCents, shipping: t.shippingCents,
      payout: t.clinicPayoutCents, wholesale: t.wholesaleCents, paid: t.collectedCount,
    }).toEqual({
      revenue: d.revenue, fee: d.fee, shipping: d.shipping, payout: d.payout, wholesale: d.wholesale, paid: d.paidCount,
    })
  })

  it('the numbers, spelled out', () => {
    const t = practiceTotals(ORDERS, GROUPS, { absorbShipping: false })
    expect(t.revenueCents).toBe(19000 + 13000 + 15000 + 12000 + 11000 + 9000)             // 79,000
    expect(t.platformFeeCents).toBe(1425 + 975 + 900 + 600 + 900 + 0)                      // 4,800
    expect(t.shippingCents).toBe(2200 + 900 + 1200)                                         // g-1 once, g-2 once, solo
    expect(t.clinicPayoutCents).toBe(79000 - (9500 + 6500 + 9000 + 8000 + 5000 + 9500) - 4800)
    expect(t.scripts).toBe(13)
    expect(t.drafts).toBe(1)
  })
})

describe('refunded, cancelled and other untaken money is labelled, never revenue', () => {
  it('each has its own count and amount', () => {
    const t = practiceTotals(ORDERS, GROUPS, { absorbShipping: false })
    expect(t.excluded).toEqual({
      awaiting:       { count: 1, retailCents: 50000 },
      expired:        { count: 1, retailCents: 40000 },
      payment_failed: { count: 1, retailCents: 30000 },
      refund_pending: { count: 1, retailCents: 25000 },
      refunded:       { count: 1, retailCents: 21000 },
      cancelled:      { count: 1, retailCents: 17000 },
      disputed:       { count: 1, retailCents: 16000 },
    })
  })

  it("a refunded group's shipping is not counted", () => {
    const t = practiceTotals([ORDERS[10]!], GROUPS, { absorbShipping: false })
    expect(t.shippingCents).toBe(0)
    expect(t.revenueCents).toBe(0)
  })

  it.each([
    ['DELIVERED', 'collected'], ['PHARMACY_REJECTED', 'collected'], ['REROUTE_PENDING', 'collected'],
    ['AWAITING_PAYMENT', 'awaiting'], ['REFUNDED', 'refunded'], ['CANCELLED', 'cancelled'], ['DRAFT', 'draft'],
  ])('%s → %s', (status, bucket) => {
    expect(bucketOf(status)).toBe(bucket)
  })
})

describe('shipping once per payment group, not once per order', () => {
  it('a group of two orders at $22 each charges $22', () => {
    const t = practiceTotals([
      order({ paymentGroupId: 'g', shippingFeeCents: 2200 }),
      order({ paymentGroupId: 'g', shippingFeeCents: 2200 }),
    ], [{ groupId: 'g', shippingTotalCents: 2200 }], { absorbShipping: false })
    expect(t.shippingCents).toBe(2200)
  })
})

describe('breakdowns and the CSV export', () => {
  it('by provider, largest revenue first, paid orders only', () => {
    const rows = breakdown(ORDERS, 'provider')
    expect(rows.map(r => [r.label, r.scripts, r.revenueCents])).toEqual([
      ['Sarah Chen', 5, 68000],
      ['Raj Patel', 1, 11000],
    ])
    // The rows sum to the revenue card.
    expect(rows.reduce((s, r) => s + r.revenueCents, 0)).toBe(practiceTotals(ORDERS, GROUPS, { absorbShipping: false }).revenueCents)
  })

  it('the CSV is the table: same rows, same order, same numbers', () => {
    const rows = breakdown(ORDERS, 'pharmacy')
    const csv = breakdownCsv(rows, 'pharmacy').trim().split('\n')
    expect(csv[0]).toBe('Pharmacy,Scripts,Revenue,Wholesale,Platform fee,Margin')
    expect(csv.slice(1)).toEqual(rows.map(r =>
      [r.label, r.scripts, (r.revenueCents / 100).toFixed(2), (r.wholesaleCents / 100).toFixed(2), (r.platformFeeCents / 100).toFixed(2), (r.marginCents / 100).toFixed(2)].join(',')))
  })

  it('quotes a label with a comma', () => {
    const rows = breakdown([order({ medicationName: 'Testosterone, Cypionate' })], 'medication')
    expect(breakdownCsv(rows, 'medication').split('\n')[1]).toMatch(/^"Testosterone, Cypionate",1,/)
  })
})

describe('periods', () => {
  const now = new Date('2026-09-23T15:30:00Z')
  it.each([
    ['today', '2026-09-23T00:00:00.000Z', '2026-09-24T00:00:00.000Z'],
    ['7d',    '2026-09-17T00:00:00.000Z', '2026-09-24T00:00:00.000Z'],
    ['30d',   '2026-08-25T00:00:00.000Z', '2026-09-24T00:00:00.000Z'],
    ['mtd',   '2026-09-01T00:00:00.000Z', '2026-09-24T00:00:00.000Z'],
    ['nonsense', '2026-08-25T00:00:00.000Z', '2026-09-24T00:00:00.000Z'],
  ])('%s', (key, from, to) => {
    expect(periodBounds(key, now)).toMatchObject({ from, to })
  })

  it('custom takes both days, the end inclusive', () => {
    expect(periodBounds('custom', now, { from: '2026-09-01', to: '2026-09-15' }))
      .toEqual({ key: 'custom', from: '2026-09-01T00:00:00.000Z', to: '2026-09-16T00:00:00.000Z' })
  })
})
