// ============================================================
// Inbound Stripe metadata check (HIPAA, AC-SWH-009)
// ============================================================
//
// Stripe signs no BAA: our outbound writes carry only opaque ids (see
// ./phi-guard). An object arriving on a webhook is checked against the
// same allow-list, per flavor: a bundle PaymentIntent (and the Charge or
// Dispute Stripe copies its metadata onto) carries payment_group_id and
// order_count; a single order carries order_id. Anything else is logged
// by KEY NAME only (never the value, which may be the PHI itself). The
// handler still runs: a stray key must not drop a payment event.
//
// Same rule as the inline checks in the payment_intent.succeeded and
// charge.dispute.created handlers; the newer handlers share this one.

const GROUP_KEYS = new Set(['payment_group_id', 'clinic_id', 'order_count', 'platform'])
const SOLO_KEYS  = new Set(['order_id', 'clinic_id', 'platform'])

/** The keys outside the allow-list (logged); empty when clean. */
export function checkInboundMetadata(
  source: string,
  objectId: string,
  metadata: Record<string, unknown> | null | undefined,
): string[] {
  const isGroup = typeof metadata?.['payment_group_id'] === 'string'
  const allowed = isGroup ? GROUP_KEYS : SOLO_KEYS
  const phiKeys = Object.keys(metadata ?? {}).filter(k => !allowed.has(k))
  if (phiKeys.length > 0) {
    console.error(
      `[stripe-webhook] HIPAA violation: PHI keys detected in ${source} metadata: ${phiKeys.join(', ')} | id=${objectId} flavor=${isGroup ? 'group' : 'solo'}`,
    )
  }
  return phiKeys
}
