// ============================================================
// SLA Resolver — WO-24
// ============================================================
//
// Auto-resolves SLA deadline records when an order transitions into
// a state that fulfils the SLA's success condition.
//
// REQ-SLM-013: Webhook-driven auto-resolution for all V2.0 events.
// REQ-SLM-012: Supports manual resolution by ops (via resolved_at + resolution_notes).
//
// Auto-resolution map (newStatus → SLA types that become resolved):
//
//   PAID_PROCESSING       → PAYMENT, SUBMISSION, STATUS_UPDATE
//   PHARMACY_ACKNOWLEDGED → ADAPTER_SUBMISSION_ACK, PHARMACY_ACKNOWLEDGE
//   FAX_DELIVERED         → FAX_DELIVERY
//   PHARMACY_COMPOUNDING  → PHARMACY_COMPOUNDING_ACK
//   SHIPPED               → PHARMACY_CONFIRMATION, SHIPPING
//   DELIVERED             → REROUTE_RESOLUTION
//   CANCELLED             → all open SLAs (payment expired, cancelled before fulfillment)
//   SUBMISSION_FAILED     → ADAPTER_SUBMISSION_ACK (cascade or exhausted — no longer pending)
//   REROUTE_PENDING       → ADAPTER_SUBMISSION_ACK (pharmacy rejected — rerouting)
//
// Idempotent: WHERE resolved_at IS NULL guard prevents double-resolution.

import { createServiceClient } from '@/lib/supabase/service'
import type { OrderStatus } from '@/lib/orders/state-machine'
import type { SlaType } from '@/lib/sla/creator'

// ============================================================
// AUTO-RESOLUTION MAP
// ============================================================

const RESOLVE_ON_STATUS: Partial<Record<OrderStatus, SlaType[]>> = {
  PAID_PROCESSING: [
    'PAYMENT',
    'SUBMISSION',
    'STATUS_UPDATE',
  ],
  PHARMACY_ACKNOWLEDGED: [
    'ADAPTER_SUBMISSION_ACK',
    'PHARMACY_ACKNOWLEDGE',
  ],
  FAX_DELIVERED: [
    'FAX_DELIVERY',
  ],
  PHARMACY_COMPOUNDING: [
    'PHARMACY_COMPOUNDING_ACK',
  ],
  PHARMACY_PROCESSING: [
    // PHARMACY_PROCESSING is the non-compounding equivalent of PHARMACY_COMPOUNDING
    'PHARMACY_COMPOUNDING_ACK',
  ],
  SHIPPED: [
    'PHARMACY_CONFIRMATION',
    'SHIPPING',
  ],
  DELIVERED: [
    'REROUTE_RESOLUTION',
  ],
  // Submission exhausted or rerouted — ADAPTER_SUBMISSION_ACK no longer pending
  SUBMISSION_FAILED: [
    'ADAPTER_SUBMISSION_ACK',
  ],
  REROUTE_PENDING: [
    'ADAPTER_SUBMISSION_ACK',
  ],
  // Order cancelled — resolve all open SLAs to keep the table clean
  CANCELLED: [
    'PAYMENT',
    'SUBMISSION',
    'STATUS_UPDATE',
    'FAX_DELIVERY',
    'PHARMACY_ACKNOWLEDGE',
    'PHARMACY_CONFIRMATION',
    'PHARMACY_COMPOUNDING_ACK',
    'SHIPPING',
    'REROUTE_RESOLUTION',
    'ADAPTER_SUBMISSION_ACK',
  ],
  // REQ-PRX-006: Payment expired — resolve payment-phase SLAs (patient missed deadline)
  PAYMENT_EXPIRED: [
    'PAYMENT',
    'SUBMISSION',
    'STATUS_UPDATE',
  ],
}

// ============================================================
// MAIN RESOLVE FUNCTION
// ============================================================

/**
 * Auto-resolves all SLA types triggered by an order entering `newStatus`.
 * Idempotent — safe to call multiple times.
 *
 * Called from:
 *   - Stripe webhook (→ PAID_PROCESSING)
 *   - Pharmacy webhook handler (→ PHARMACY_ACKNOWLEDGED, PHARMACY_COMPOUNDING, etc.)
 *   - Documo webhook handler (→ FAX_DELIVERED)
 *   - Shipping webhook handler (→ SHIPPED, DELIVERED)
 *   - Routing engine cascade (→ SUBMISSION_FAILED, REROUTE_PENDING)
 *   - Order cancellation handler (→ CANCELLED)
 */
export async function resolveSlasForTransition(
  orderId:   string,
  newStatus: OrderStatus
): Promise<void> {
  const slaTypes = RESOLVE_ON_STATUS[newStatus]
  if (!slaTypes || slaTypes.length === 0) return

  const supabase = createServiceClient()
  const now = new Date().toISOString()

  const { error } = await supabase
    .from('order_sla_deadlines')
    .update({ resolved_at: now })
    .eq('order_id', orderId)
    .in('sla_type', slaTypes)
    .is('resolved_at', null)   // idempotency guard

  if (error) {
    // NB-01: auto-resolution failures are logged but not thrown — callers
    // (webhook handlers) should not fail a payment/delivery event just because
    // the SLA record failed to update. The SLA cron will catch the breach.
    console.error(
      `[sla-resolver] failed to resolve SLAs for order ${orderId} on ${newStatus}:`,
      error.message
    )
  }
}

// ============================================================
// MANUAL RESOLUTION — REQ-SLM-012
// ============================================================

export interface ManualResolveParams {
  orderId:         string
  slaType:         SlaType
  resolvedBy:      string   // ops user email / ID
  resolutionNotes: string
}

/**
 * Manually resolves a single SLA record. Used by the ops dashboard.
 * Records who resolved it and the reason.
 */
export async function manuallyResolveSla(params: ManualResolveParams): Promise<void> {
  const { orderId, slaType, resolvedBy, resolutionNotes } = params
  const supabase = createServiceClient()
  const now = new Date().toISOString()

  const { error } = await supabase
    .from('order_sla_deadlines')
    .update({
      resolved_at:      now,
      acknowledged_by:  resolvedBy,
      acknowledged_at:  now,
      resolution_notes: resolutionNotes,
    })
    .eq('order_id', orderId)
    .eq('sla_type', slaType)
    .is('resolved_at', null)

  if (error) {
    console.error(
      `[sla-resolver] manual resolve failed for order=${orderId} sla=${slaType}:`,
      error.message
    )
    throw new Error(`[sla-resolver] manual resolve failed: ${error.message}`)
  }
}
