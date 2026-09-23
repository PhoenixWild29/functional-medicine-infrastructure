/**
 * @jest-environment node
 *
 * WO-102: shipping is charged ONCE PER PHARMACY PER BUNDLE, never per
 * prescription. Getting this wrong overcharges the patient on every
 * multi-item order, so each rule is pinned here.
 *
 * Seed rates (migration 20260916000001): Quick Rx $12 standard / $25
 * cold chain; Strive $9 / $22.
 */

import {
  allocateShippingToOrders,
  bundleTotals,
  computeBundleShipping,
  ratesFromPharmacyRow,
  type PharmacyShippingRates,
} from '../shipping'

const STRIVE = 'a4000000-0000-0000-0000-000000000001'
const QUICK_RX = 'a4000000-0000-0000-0000-000000000002'

const RATES: PharmacyShippingRates[] = [
  ratesFromPharmacyRow({ pharmacy_id: STRIVE, name: 'Strive Pharmacy', shipping_fee_standard: 9, shipping_fee_cold_chain: 22, free_shipping_threshold: null }),
  ratesFromPharmacyRow({ pharmacy_id: QUICK_RX, name: 'Quick Rx Pharmacy', shipping_fee_standard: '12.00', shipping_fee_cold_chain: '25.00', free_shipping_threshold: null }),
]

const semaglutide = (pharmacyId: string) => ({ pharmacyId, shippingType: 'cold_chain', wholesaleCents: 9500 })
const bpc157 = (pharmacyId: string) => ({ pharmacyId, shippingType: 'standard', wholesaleCents: 6500 })

describe('computeBundleShipping — spec scenarios', () => {
  it('Semaglutide via Quick Rx (cold) + BPC-157 via Strive (standard) → $25 + $9 = $34', () => {
    const s = computeBundleShipping([semaglutide(QUICK_RX), bpc157(STRIVE)], RATES)
    expect(s.byPharmacy.map(p => [p.pharmacyName, p.shippingType, p.feeCents])).toEqual([
      ['Quick Rx Pharmacy', 'cold_chain', 2500],
      ['Strive Pharmacy',   'standard',   900],
    ])
    expect(s.totalCents).toBe(3400)
  })

  it('both via Strive → $22 once: the cold-chain fee covers the standard item', () => {
    const s = computeBundleShipping([semaglutide(STRIVE), bpc157(STRIVE)], RATES)
    expect(s.byPharmacy).toEqual([{
      pharmacyId: STRIVE, pharmacyName: 'Strive Pharmacy', shippingType: 'cold_chain',
      itemCount: 2, subtotalCents: 16000, rateCents: 2200, feeCents: 2200, waived: false,
    }])
    expect(s.totalCents).toBe(2200)
  })
})

describe('computeBundleShipping — once per pharmacy, never per Rx', () => {
  it('two standard Rx to the same pharmacy pay the standard fee once', () => {
    expect(computeBundleShipping([bpc157(STRIVE), bpc157(STRIVE)], RATES).totalCents).toBe(900)
  })

  it('three items, two pharmacies → exactly two charges', () => {
    const s = computeBundleShipping([bpc157(STRIVE), semaglutide(QUICK_RX), bpc157(STRIVE)], RATES)
    expect(s.byPharmacy).toHaveLength(2)
    expect(s.totalCents).toBe(900 + 2500)
  })

  it('cold chain on the LAST item still upgrades that pharmacy', () => {
    expect(computeBundleShipping([bpc157(QUICK_RX), bpc157(QUICK_RX), semaglutide(QUICK_RX)], RATES).totalCents).toBe(2500)
  })

  it('a missing / unknown shipping type is standard', () => {
    expect(computeBundleShipping([{ pharmacyId: STRIVE, shippingType: null, wholesaleCents: 100 }], RATES).totalCents).toBe(900)
  })

  it('a pharmacy with no rates on file ships free rather than inventing a charge', () => {
    expect(computeBundleShipping([bpc157('unknown')], RATES)).toEqual({
      byPharmacy: [expect.objectContaining({ pharmacyId: 'unknown', feeCents: 0 })],
      totalCents: 0,
    })
  })
})

describe('free_shipping_threshold', () => {
  const withThreshold = [
    ratesFromPharmacyRow({ pharmacy_id: STRIVE, name: 'Strive Pharmacy', shipping_fee_standard: 9, shipping_fee_cold_chain: 22, free_shipping_threshold: 150 }),
  ]

  it('met by that pharmacy\'s subtotal → its shipping is zero', () => {
    const s = computeBundleShipping([semaglutide(STRIVE), bpc157(STRIVE)], withThreshold)   // $160 ≥ $150
    expect(s.byPharmacy[0]).toEqual(expect.objectContaining({ rateCents: 2200, feeCents: 0, waived: true }))
    expect(s.totalCents).toBe(0)
  })

  it('exactly at the threshold counts as met', () => {
    expect(computeBundleShipping([{ pharmacyId: STRIVE, shippingType: 'standard', wholesaleCents: 15000 }], withThreshold).totalCents).toBe(0)
  })

  it('below the threshold → charged', () => {
    expect(computeBundleShipping([bpc157(STRIVE)], withThreshold).totalCents).toBe(900)
  })

  it('only the pharmacy whose own subtotal meets it is waived', () => {
    const mixed = [...withThreshold, RATES[1]!]
    const s = computeBundleShipping([semaglutide(STRIVE), bpc157(STRIVE), bpc157(QUICK_RX)], mixed)
    expect(s.byPharmacy.map(p => p.feeCents)).toEqual([0, 1200])
  })

  it('no threshold (null) never waives', () => {
    expect(ratesFromPharmacyRow({ pharmacy_id: 'x', name: 'x', free_shipping_threshold: null }).freeShippingThresholdCents).toBeNull()
  })
})

describe('allocateShippingToOrders — per-order snapshots sum to the bundle', () => {
  // WO-99 follow-up (prod finding 2): a pharmacy's fee lands on ONE of its
  // orders — the one whose shipping type set the rate. Semaglutide (cold
  // chain) set Strive's $22, so it carries it; BPC-157 (standard) carries
  // $0. This used to put the fee on the first order (o1), which stored the
  // cold-chain fee on a standard line.
  it('the pharmacy fee lands on one order only — the one whose shipping type set the rate', () => {
    const orders = [
      { orderId: 'o1', ...bpc157(STRIVE) },
      { orderId: 'o2', ...semaglutide(QUICK_RX) },
      { orderId: 'o3', ...semaglutide(STRIVE) },
    ]
    const s = computeBundleShipping(orders, RATES)
    const alloc = allocateShippingToOrders(orders, s)
    expect(Object.fromEntries(alloc)).toEqual({ o1: 0, o2: 2500, o3: 2200 })
    expect([...alloc.values()].reduce((a, b) => a + b, 0)).toBe(s.totalCents)
  })
})

describe('bundleTotals — platform fee is never charged on shipping', () => {
  const lines = [{ retailCents: 19000, wholesaleCents: 9500 }, { retailCents: 13000, wholesaleCents: 6500 }]

  it('pass-through (default): patient total = subtotal + shipping; fee on margin only', () => {
    const t = bundleTotals(lines, 3400)
    expect(t).toEqual({
      subtotalCents:        32000,
      wholesaleCents:       16000,
      shippingCents:        3400,
      platformFeeCents:     2400,    // 15% × $95 + 15% × $65 — shipping excluded
      patientShippingCents: 3400,
      patientTotalCents:    35400,
      clinicPayoutCents:    13600,   // $160 margin − $24 fee
    })
  })

  it('the platform fee is identical with and without shipping', () => {
    expect(bundleTotals(lines, 3400).platformFeeCents).toBe(bundleTotals(lines, 0).platformFeeCents)
  })

  it('clinic absorbs shipping: patient pays the subtotal, payout carries the shipping', () => {
    const t = bundleTotals(lines, 3400, { absorbShipping: true })
    expect(t).toEqual(expect.objectContaining({
      patientShippingCents: 0,
      patientTotalCents:    32000,
      platformFeeCents:     2400,
      clinicPayoutCents:    13600 - 3400,
    }))
  })
})
