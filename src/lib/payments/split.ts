// ============================================================
// One order's money split, from its frozen snapshots
// ============================================================
//
// The same arithmetic the checkout uses for the destination charge
// (stripeSplit): the patient pays retail plus shipping (unless the clinic
// absorbs shipping); the application fee keeps wholesale + shipping for
// the pharmacy and 15% of the margin for the platform; the clinic gets the
// rest. The four parts always sum to the charge.
//
// Record-only: this computes what was split. It never moves money.

import { stripeSplit } from '@/lib/orders/shipping'

export interface SplitOrder {
  retail_price_snapshot:    number | string | null
  wholesale_price_snapshot: number | string | null
  shipping_fee:             number | string | null
}

export interface OrderSplit {
  /** What the patient paid for this order. */
  chargeCents:          number
  platformFeeCents:     number
  /** Wholesale + shipping: what the pharmacy is owed. */
  pharmacyPayableCents: number
  /** Charge less the application fee. */
  clinicTransferCents:  number
  wholesaleCents:       number
  shippingCents:        number
}

const cents = (dollars: number | string | null): number => Math.round(Number(dollars ?? 0) * 100)

export function computeOrderSplit(order: SplitOrder, absorbShipping: boolean | null | undefined): OrderSplit {
  const retailCents    = cents(order.retail_price_snapshot)
  const wholesaleCents = cents(order.wholesale_price_snapshot)
  const shippingCents  = Math.max(0, cents(order.shipping_fee))
  const { amountCents, applicationFeeCents } = stripeSplit({ retailCents, wholesaleCents, shippingCents, absorbShipping: absorbShipping ?? null })
  const pharmacyPayableCents = wholesaleCents + shippingCents
  return {
    chargeCents:         amountCents,
    // The fee's platform part; the pharmacy's part is the rest of it.
    platformFeeCents:    applicationFeeCents - pharmacyPayableCents,
    pharmacyPayableCents,
    clinicTransferCents: amountCents - applicationFeeCents,
    wholesaleCents,
    shippingCents,
  }
}

/**
 * A refund of `refundCents` against an order's split, spread over the
 * parties in proportion; the pharmacy takes the rounding so the parts sum
 * to the refund exactly.
 */
export function prorateRefund(split: OrderSplit, refundCents: number): { clinic: number; platform: number; pharmacy: number } {
  const amount = Math.max(0, refundCents)
  if (split.chargeCents <= 0 || amount === 0) return { clinic: 0, platform: 0, pharmacy: 0 }
  if (amount === split.chargeCents) {
    return { clinic: split.clinicTransferCents, platform: split.platformFeeCents, pharmacy: split.pharmacyPayableCents }
  }
  const ratio = amount / split.chargeCents
  const clinic = Math.round(split.clinicTransferCents * ratio)
  const platform = Math.round(split.platformFeeCents * ratio)
  return { clinic, platform, pharmacy: amount - clinic - platform }
}
