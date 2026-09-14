// ============================================================
// WO-102: Shipping — once per pharmacy per bundle
// ============================================================
//
// Gina Rooks, 2026-09-11: "I don't see [shipping] listed anywhere with the
// med pricing or when you get to review and sign … you pay shipping more
// than once". Shipping is a pharmacy-level fact (phase rule 4) stored on
// `pharmacies` and attached to every order and bundle.
//
// Rules (and why each one exists):
//   - ONE fee per pharmacy per bundle, never per prescription. Two Rx to
//     the same pharmacy ship in one box.
//   - The fee is the pharmacy's rate for the bundle's shipping type there:
//     if ANY item going to that pharmacy is cold chain, the cold-chain fee
//     covers all of that pharmacy's items; otherwise the standard fee.
//   - free_shipping_threshold, when set and met by that pharmacy's
//     subtotal, zeroes that pharmacy's shipping. The subtotal is what the
//     pharmacy invoices for the bundle — the wholesale total of its items.
//   - Shipping sits OUTSIDE the margin: the platform fee is never charged
//     on it. By default the patient pays it at cost; a clinic can choose
//     to absorb it (clinics.absorb_shipping), in which case it comes out of
//     the clinic payout and the patient total excludes it.
//
// Pure: integer cents in and out (HC-01). No React, no Supabase.

import type { ShippingType } from './rx-details'

export interface PharmacyShippingRates {
  pharmacyId:                 string
  pharmacyName:               string
  standardCents:              number
  coldChainCents:             number
  /** null = no free-shipping threshold */
  freeShippingThresholdCents: number | null
}

export interface ShippingItem {
  pharmacyId:     string
  shippingType:   ShippingType | string | null | undefined
  wholesaleCents: number
}

export interface PharmacyShipping {
  pharmacyId:     string
  pharmacyName:   string
  /** 'cold_chain' when any of this pharmacy's items is cold chain */
  shippingType:   ShippingType
  itemCount:      number
  /** What this pharmacy invoices for the bundle (wholesale). */
  subtotalCents:  number
  /** The rate before any free-shipping waiver. */
  rateCents:      number
  /** Charged: 0 when the threshold waived it. */
  feeCents:       number
  waived:         boolean
}

export interface BundleShipping {
  /** One entry per pharmacy, in the order the pharmacy first appears. */
  byPharmacy: PharmacyShipping[]
  totalCents: number
}

/** Dollars (NUMERIC from the DB, possibly a string) → integer cents; null/invalid → 0. */
export function dollarsToCents(v: number | string | null | undefined): number {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 100) : 0
}

/** A `pharmacies` row's shipping columns → rates. */
export function ratesFromPharmacyRow(row: {
  pharmacy_id:              string
  name:                     string
  shipping_fee_standard?:   number | string | null
  shipping_fee_cold_chain?: number | string | null
  free_shipping_threshold?: number | string | null
}): PharmacyShippingRates {
  const threshold = row.free_shipping_threshold
  return {
    pharmacyId:                 row.pharmacy_id,
    pharmacyName:               row.name,
    standardCents:              dollarsToCents(row.shipping_fee_standard),
    coldChainCents:             dollarsToCents(row.shipping_fee_cold_chain),
    freeShippingThresholdCents: threshold == null || threshold === '' ? null : dollarsToCents(threshold),
  }
}

/**
 * Shipping for one bundle (a Review session, a payment group, or a single
 * order on its own). Items for a pharmacy with no known rates ship free —
 * a missing rate never invents a charge.
 */
export function computeBundleShipping(
  items: ReadonlyArray<ShippingItem>,
  rates: ReadonlyMap<string, PharmacyShippingRates> | ReadonlyArray<PharmacyShippingRates>,
): BundleShipping {
  const rateMap = rates instanceof Map
    ? rates as ReadonlyMap<string, PharmacyShippingRates>
    : new Map((rates as ReadonlyArray<PharmacyShippingRates>).map(r => [r.pharmacyId, r]))

  const groups = new Map<string, { cold: boolean; count: number; subtotal: number }>()
  for (const item of items) {
    const g = groups.get(item.pharmacyId) ?? { cold: false, count: 0, subtotal: 0 }
    g.cold = g.cold || item.shippingType === 'cold_chain'
    g.count += 1
    g.subtotal += Math.max(0, Math.round(item.wholesaleCents))
    groups.set(item.pharmacyId, g)
  }

  const byPharmacy: PharmacyShipping[] = []
  for (const [pharmacyId, g] of groups) {
    const r = rateMap.get(pharmacyId)
    const shippingType: ShippingType = g.cold ? 'cold_chain' : 'standard'
    const rateCents = r ? Math.max(0, g.cold ? r.coldChainCents : r.standardCents) : 0
    const waived = !!r && r.freeShippingThresholdCents != null && rateCents > 0 && g.subtotal >= r.freeShippingThresholdCents
    byPharmacy.push({
      pharmacyId,
      pharmacyName:  r?.pharmacyName ?? '',
      shippingType,
      itemCount:     g.count,
      subtotalCents: g.subtotal,
      rateCents,
      feeCents:      waived ? 0 : rateCents,
      waived,
    })
  }
  return { byPharmacy, totalCents: byPharmacy.reduce((s, p) => s + p.feeCents, 0) }
}

/**
 * Per-order shipping snapshots (orders.shipping_fee) for a bundle: each
 * pharmacy's fee is recorded on the FIRST of its orders and 0 on the rest,
 * so the snapshots sum to the bundle total and no order double-counts.
 */
export function allocateShippingToOrders<T extends { orderId: string } & ShippingItem>(
  orders: ReadonlyArray<T>,
  shipping: BundleShipping,
): Map<string, number> {
  const feeByPharmacy = new Map(shipping.byPharmacy.map(p => [p.pharmacyId, p.feeCents]))
  const charged = new Set<string>()
  const out = new Map<string, number>()
  for (const o of orders) {
    if (charged.has(o.pharmacyId)) {
      out.set(o.orderId, 0)
    } else {
      charged.add(o.pharmacyId)
      out.set(o.orderId, feeByPharmacy.get(o.pharmacyId) ?? 0)
    }
  }
  return out
}

export const PLATFORM_FEE_PCT = 15

export interface BundleTotals {
  subtotalCents:     number   // retail, what the prescriptions cost
  wholesaleCents:    number
  shippingCents:     number   // bundle shipping (once per pharmacy)
  platformFeeCents:  number   // 15% of margin — never of shipping
  /** Shipping the patient pays: all of it by default, 0 when the clinic absorbs it. */
  patientShippingCents: number
  patientTotalCents: number   // subtotal + patientShipping — the Stripe amount
  clinicPayoutCents: number   // margin − platform fee − (shipping when absorbed)
}

/**
 * Review / checkout / payment-intent totals. Platform fee is 15% of the
 * margin (retail − wholesale), rounded per line exactly as before; shipping
 * never enters it.
 */
export function bundleTotals(
  lines: ReadonlyArray<{ retailCents: number; wholesaleCents: number }>,
  shippingCents: number,
  opts: { absorbShipping?: boolean | null } = {},
): BundleTotals {
  let subtotalCents = 0
  let wholesaleCents = 0
  let platformFeeCents = 0
  for (const l of lines) {
    subtotalCents += l.retailCents
    wholesaleCents += l.wholesaleCents
    const margin = l.retailCents - l.wholesaleCents
    platformFeeCents += margin > 0 ? Math.round(margin * PLATFORM_FEE_PCT / 100) : 0
  }
  const absorb = opts.absorbShipping === true
  const patientShippingCents = absorb ? 0 : shippingCents
  return {
    subtotalCents,
    wholesaleCents,
    shippingCents,
    platformFeeCents,
    patientShippingCents,
    patientTotalCents: subtotalCents + patientShippingCents,
    clinicPayoutCents: subtotalCents - wholesaleCents - platformFeeCents - (absorb ? shippingCents : 0),
  }
}

export interface StripeSplit {
  /** What the patient is charged. */
  amountCents:          number
  /** What the platform retains: wholesale + 15% of margin + shipping (both paid on to the pharmacy). */
  applicationFeeCents:  number
}

/**
 * Stripe Connect split for one checkout (a single order or a payment
 * group), REQ-PSR-002 extended by WO-102:
 *
 *   amount                 = retail + shipping        (shipping 0 when the clinic absorbs it)
 *   application_fee_amount = wholesale + 15% × margin + shipping
 *
 * The platform pays the pharmacy the wholesale AND its shipping, so the
 * shipping passes through the application fee at cost — the 15% is taken
 * on the margin only. When the clinic absorbs shipping the patient is not
 * charged it and it comes out of the clinic's share. The fee is capped at
 * the amount (Stripe rejects a larger fee).
 */
export function stripeSplit(input: {
  retailCents:     number
  wholesaleCents:  number
  shippingCents:   number
  absorbShipping?: boolean | null
  /** Platform fee already summed per line (groups); defaults to 15% of this margin. */
  platformFeeCents?: number
}): StripeSplit {
  const shipping = Math.max(0, Math.round(input.shippingCents))
  const margin = Math.max(0, input.retailCents - input.wholesaleCents)
  const platformFee = input.platformFeeCents ?? Math.round(margin * PLATFORM_FEE_PCT / 100)
  const amountCents = input.retailCents + (input.absorbShipping === true ? 0 : shipping)
  const applicationFeeCents = Math.min(amountCents, input.wholesaleCents + platformFee + shipping)
  return { amountCents, applicationFeeCents }
}
