// ============================================================
// SLA Creator — WO-24
// ============================================================
//
// Creates SLA deadline records in order_sla_deadlines when an order
// transitions into a trigger state. Called from webhook handlers and
// the adapter routing engine after each CAS transition.
//
// REQ-SLM-001 through REQ-SLM-006: All 10 SLA type definitions.
// REQ-SLM-007: Escalation-tier-aware creation map.
// REQ-SLM-016: Tier 4 backward compatibility — FAX_DELIVERY SLA is
//   created by submitTier4Fax directly (not here) to preserve the
//   30-min SLA for both initial submissions and retries.
//
// Idempotent: uses upsert with ignoreDuplicates=true so duplicate
// calls (e.g. webhook replays) never overwrite existing deadlines.
//
// SLA type → trigger state mapping:
//   AWAITING_PAYMENT     → PAYMENT (72h), SUBMISSION (24h), STATUS_UPDATE (48h)
//   SUBMISSION_PENDING   → ADAPTER_SUBMISSION_ACK (15 min Tier 1/3, 30 min Tier 2)
//   PHARMACY_ACKNOWLEDGED→ PHARMACY_CONFIRMATION (24 biz hrs, all tiers)
//                          PHARMACY_COMPOUNDING_ACK (2 biz hrs, Tier 1/2/3 only)
//                          SHIPPING (7 biz days, all tiers)
//   FAX_DELIVERED        → PHARMACY_ACKNOWLEDGE (4 biz hrs, Tier 4 only)
//   SHIPPED              → REROUTE_RESOLUTION (24h wall clock — tracking update)
//
// NOTE: FAX_DELIVERY is created by submitTier4Fax (REQ-SLM-016 Tier 4 compat).

import { createServiceClient } from '@/lib/supabase/service'
import { addWallClock, addBusinessHours, addBusinessDays } from '@/lib/sla/calculator'
import type { OrderStatus } from '@/lib/orders/state-machine'
import type { IntegrationTier } from '@/lib/adapters/audit-trail'

// ============================================================
// CONSTANTS — SLA deadlines per FRD 5 v2.0 REQ-SLM-001 to 006
// ============================================================

const MS = {
  min30:  30 * 60 * 1000,
  min15:  15 * 60 * 1000,
  hr24:   24 * 60 * 60 * 1000,
  hr48:   48 * 60 * 60 * 1000,
  hr72:   72 * 60 * 60 * 1000,
}

// ============================================================
// TYPES
// ============================================================

export type SlaType =
  | 'PAYMENT'
  | 'SUBMISSION'
  | 'STATUS_UPDATE'
  | 'FAX_DELIVERY'
  | 'PHARMACY_ACKNOWLEDGE'
  | 'PHARMACY_CONFIRMATION'
  | 'SHIPPING'
  | 'REROUTE_RESOLUTION'
  | 'ADAPTER_SUBMISSION_ACK'
  | 'PHARMACY_COMPOUNDING_ACK'

export interface CreateSlasParams {
  orderId:    string
  newStatus:  OrderStatus
  pharmacyId: string
  tier:       IntegrationTier
}

// ============================================================
// PHARMACY HELPERS
// ============================================================

async function getPharmacyTimezone(pharmacyId: string): Promise<string> {
  const supabase = createServiceClient()

  const { data } = await supabase
    .from('pharmacies')
    .select('timezone')
    .eq('pharmacy_id', pharmacyId)
    .maybeSingle()

  return (data as { timezone?: string } | null)?.timezone ?? 'America/New_York'
}

// ============================================================
// UPSERT HELPER
// ============================================================

/**
 * Explicitly upserts the FAX_DELIVERY SLA (30 min wall clock) for an order.
 * Called from the sla-check cascade path (BLK-02) to ensure the SLA exists
 * even when submitTier4Fax is invoked outside the normal routing flow.
 *
 * REQ-SLM-016: FAX_DELIVERY is normally created by submitTier4Fax; this export
 * is the escape hatch for the cascade path where submitTier4Fax is called after
 * the order is already in FAX_QUEUED.
 */
export async function upsertFaxDeliverySla(orderId: string): Promise<void> {
  const deadline = addWallClock(new Date(), MS.min30)
  await upsertSla(orderId, 'FAX_DELIVERY', deadline)
}

async function upsertSla(
  orderId:    string,
  slaType:    SlaType,
  deadlineAt: Date
): Promise<void> {
  const supabase = createServiceClient()

  const { error } = await supabase
    .from('order_sla_deadlines')
    .upsert(
      {
        order_id:    orderId,
        sla_type:    slaType,
        deadline_at: deadlineAt.toISOString(),
        escalated:         false,
        escalation_tier:   0,
        resolved_at:       null,
        cascade_attempted: false,
        is_active:         true,
        created_at:        new Date().toISOString(),
      },
      { onConflict: 'order_id,sla_type', ignoreDuplicates: true }
    )

  if (error) {
    console.error(
      `[sla-creator] failed to upsert SLA ${slaType} for order ${orderId}:`,
      error.message
    )
  }
}

// ============================================================
// MAIN SLA CREATION FUNCTION
// ============================================================

/**
 * Creates SLA deadline records for an order entering a trigger state.
 * Idempotent — safe to call multiple times for the same transition.
 *
 * Called from:
 *   - Stripe webhook (DRAFT → AWAITING_PAYMENT)
 *   - Routing engine (PAID_PROCESSING → SUBMISSION_PENDING)
 *   - Pharmacy webhook handler (SUBMISSION_PENDING → PHARMACY_ACKNOWLEDGED)
 *   - Documo webhook handler (FAX_QUEUED → FAX_DELIVERED)
 *   - Shipping webhook handler (READY_TO_SHIP → SHIPPED)
 */
export async function createSlasForTransition(
  params: CreateSlasParams
): Promise<void> {
  const { orderId, newStatus, pharmacyId, tier } = params

  const now = new Date()
  const tierIsApi = tier === 'TIER_1_API' || tier === 'TIER_3_SPEC'
  const tierIsPortal = tier === 'TIER_2_PORTAL'
  const tierIsFax = tier === 'TIER_4_FAX'
  const tierIsAdaptered = tierIsApi || tierIsPortal  // Tier 1/2/3

  switch (newStatus) {

    // ── AWAITING_PAYMENT ───────────────────────────────────
    // REQ-SLM-001: Payment expiry + SMS reminder SLAs
    case 'AWAITING_PAYMENT': {
      await Promise.all([
        // 72-hour payment expiry (wall clock)
        upsertSla(orderId, 'PAYMENT', addWallClock(now, MS.hr72)),
        // 24-hour SMS reminder (triggers WO-26 SMS send)
        upsertSla(orderId, 'SUBMISSION', addWallClock(now, MS.hr24)),
        // 48-hour SMS reminder (triggers WO-26 SMS send)
        upsertSla(orderId, 'STATUS_UPDATE', addWallClock(now, MS.hr48)),
      ])
      break
    }

    // ── SUBMISSION_PENDING ─────────────────────────────────
    // REQ-SLM-005: ADAPTER_SUBMISSION_ACK — V2.0 new
    // Tier 1/3: 15 min; Tier 2 portal: 30 min (portal login + form fill takes longer)
    case 'SUBMISSION_PENDING': {
      if (tierIsAdaptered) {
        const durationMs = tierIsPortal ? MS.min30 : MS.min15
        await upsertSla(orderId, 'ADAPTER_SUBMISSION_ACK', addWallClock(now, durationMs))
      }
      // Tier 4 FAX: no ADAPTER_SUBMISSION_ACK — FAX_DELIVERY covers the SLA
      break
    }

    // ── PHARMACY_ACKNOWLEDGED ──────────────────────────────
    // REQ-SLM-003: PHARMACY_CONFIRMATION (24 biz hrs — all tiers)
    // REQ-SLM-006: PHARMACY_COMPOUNDING_ACK (2 biz hrs — Tier 1/2/3 only)
    // REQ-SLM-002: SHIPPING (7 biz days — all tiers)
    case 'PHARMACY_ACKNOWLEDGED': {
      const timezone = await getPharmacyTimezone(pharmacyId)

      const tasks: Promise<void>[] = [
        // All tiers: 24 biz hrs to begin compounding/processing
        upsertSla(orderId, 'PHARMACY_CONFIRMATION', addBusinessHours(now, 24, timezone)),
        // All tiers: 7 biz days for order to ship
        upsertSla(orderId, 'SHIPPING', addBusinessDays(now, 7, timezone)),
      ]

      if (tierIsAdaptered) {
        // Tier 1/2/3 only: 2 biz hrs for pharmacy to start compounding
        // (provides visibility into ack-to-compounding gap — REQ-SLM-006)
        tasks.push(
          upsertSla(orderId, 'PHARMACY_COMPOUNDING_ACK', addBusinessHours(now, 2, timezone))
        )
      }

      await Promise.all(tasks)
      break
    }

    // ── FAX_DELIVERED ──────────────────────────────────────
    // REQ-SLM-004: PHARMACY_ACKNOWLEDGE — 4 biz hrs for Tier 4 only
    // (Tier 4 fax delivered → pharmacy must acknowledge within 4 business hours)
    case 'FAX_DELIVERED': {
      if (tierIsFax) {
        const timezone = await getPharmacyTimezone(pharmacyId)
        await upsertSla(orderId, 'PHARMACY_ACKNOWLEDGE', addBusinessHours(now, 4, timezone))
      }
      break
    }

    // ── SHIPPED ────────────────────────────────────────────
    // REQ-SLM-001: REROUTE_RESOLUTION — 24h wall clock tracking update
    // (Patient expects a tracking update within 24h of shipment)
    case 'SHIPPED': {
      await upsertSla(orderId, 'REROUTE_RESOLUTION', addWallClock(now, MS.hr24))
      break
    }

    // All other states — no SLA creation triggered
    default:
      break
  }
}
