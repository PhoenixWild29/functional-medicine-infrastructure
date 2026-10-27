// Decision 10, tracking A: SHIPPED stays allowed without a tracking number
// (a pharmacy's order.shipped webhook or the portal poll may not have one;
// UNENFORCED_REQUIRED_FIELDS_ON_ENTER in lib/orders/state-machine), so ops
// are shown "Tracking pending" on such an order instead.

export const TRACKING_PENDING_LABEL = 'Tracking pending'

export function trackingPending(status: string | null | undefined, trackingNumber: string | null | undefined): boolean {
  return status === 'SHIPPED' && !(trackingNumber ?? '').trim()
}
