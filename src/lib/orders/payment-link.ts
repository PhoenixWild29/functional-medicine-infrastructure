// ============================================================
// Is a patient's payment link still payable?
// ============================================================
//
// A link is open while its order is AWAITING_PAYMENT and inside the
// checkout token's lifetime: 72 hours from signing (locked_at), the
// window after which /api/cron/payment-expiry moves the order to
// PAYMENT_EXPIRED. Between the 72nd hour and the cron run the order still
// reads AWAITING_PAYMENT, but the patient cannot pay it — it is expired.
//
// Prod, 5 Oct: the dashboard counted every AWAITING_PAYMENT and
// PAYMENT_EXPIRED order as an "open payment link"; all 6 had expired.
// Paid, cancelled, refunded and draft orders have no open link.
//
// Plain module, no 'use client': the dashboard page (server) and the
// orders dashboard (client) both use it.

export const PAYMENT_LINK_TTL_MS = 72 * 60 * 60 * 1000

export interface PaymentLinkOrder {
  status:    string
  lockedAt?: string | null
  createdAt: string
}

/** 'open' (payable), 'expired', or null when the order has no payment link pending. */
export function paymentLinkState(o: PaymentLinkOrder, now: number = Date.now()): 'open' | 'expired' | null {
  if (o.status === 'PAYMENT_EXPIRED') return 'expired'
  if (o.status !== 'AWAITING_PAYMENT') return null
  const issuedAt = Date.parse(o.lockedAt ?? o.createdAt)
  if (!Number.isFinite(issuedAt)) return 'open'
  return now - issuedAt < PAYMENT_LINK_TTL_MS ? 'open' : 'expired'
}

export function paymentLinkCounts(orders: ReadonlyArray<PaymentLinkOrder>, now: number = Date.now()): { open: number; expired: number } {
  let open = 0
  let expired = 0
  for (const o of orders) {
    const s = paymentLinkState(o, now)
    if (s === 'open') open++
    else if (s === 'expired') expired++
  }
  return { open, expired }
}
