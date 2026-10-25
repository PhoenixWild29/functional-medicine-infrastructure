import { createServiceClient } from '@/lib/supabase/service'
import { canActorTransition, canTransition, getRequiredFieldsOnEnter } from '@/lib/orders/state-machine'
import type { ActorType, OrderStatus, RequiredOrderField } from '@/lib/orders/state-machine'
import type { Database, Json } from '@/types/database.types'
import { insertStatusHistory } from '@/lib/orders/status-history'

// ============================================================
// COMPARE-AND-SWAP (CAS) ORDER TRANSITION
// ============================================================
// Executes optimistic concurrency transitions on orders.status.
//
// Pattern:
//   UPDATE orders
//   SET status = :new_status, updated_at = now()
//   WHERE order_id = :order_id
//     AND status = :expected_status     ← the CAS predicate
//
// If the WHERE clause matches 0 rows the order has already moved
// past the expected state.  This is treated as an idempotent no-op
// (success), NOT an error.  Callers must never retry on a no-op.
//
// Race conditions eliminated by CAS:
//
// 1. Payment Confirmation Race
//    payment_intent.succeeded webhook AND 72h expiry cron both attempt
//    AWAITING_PAYMENT → different states simultaneously.
//    CAS ensures only the first caller wins; the second safely no-ops.
//
// 2. Duplicate Webhook Race
//    Stripe / Documo / Pharmacy APIs retry webhooks on timeout.
//    webhook_events idempotency check is the first line of defence.
//    CAS on the order is the second — if idempotency check somehow
//    races, CAS prevents double-processing.
//
// 3. Adapter Cascade Race
//    Tier 1 failure handler and cascade-to-Tier-4 logic both attempt
//    transitions in parallel.  CAS ensures clean progression without
//    collision or phantom state entries.
//
// Enforced before anything is written (state-machine.ts):
//   - the transition is legal (VALID_TRANSITIONS);
//   - actorRole may make it (TRANSITION_RULES);
//   - every REQUIRED_FIELDS_ON_ENTER column of the new status is set. The
//     check is part of the UPDATE's WHERE clause, so it cannot race: an
//     order still in expectedStatus with a field missing is refused
//     (CasTransitionRefused 'missing_required_fields'), not a no-op.
// `patch` is written in the same UPDATE as the status (e.g. a reroute's
// reroute_count and pharmacy), so the two can never come apart.
//
// Usage:
//   const result = await casTransition({
//     orderId, expectedStatus: 'AWAITING_PAYMENT',
//     newStatus: 'PAID_PROCESSING', actor: 'stripe_webhook', actorRole: 'system',
//     metadata: { stripeEventId: evt.id },
//   })
//   if (!result.success && !result.wasAlreadyTransitioned) {
//     // genuine error — alert ops
//   }

export interface CasTransitionParams {
  orderId: string
  expectedStatus: OrderStatus
  newStatus: OrderStatus
  /** Who performed the transition, as recorded in order_status_history (e.g. 'ops:<email>', 'routing_engine') */
  actor: string
  /** The actor's role, checked against TRANSITION_RULES */
  actorRole: ActorType
  /** Optional metadata attached to the order_status_history entry */
  metadata?: Record<string, unknown>
  /** Other columns written in the same UPDATE as the status (never status or updated_at) */
  patch?: Omit<OrderUpdate, 'status' | 'updated_at'>
}

type OrderUpdate = Database['public']['Tables']['orders']['Update']

/** A transition the state machine does not allow. Nothing was written. */
export class CasTransitionRefused extends Error {
  constructor(
    readonly code: 'illegal_transition' | 'actor_not_allowed' | 'missing_required_fields',
    message: string,
    readonly missingFields: ReadonlyArray<RequiredOrderField> = [],
  ) {
    super(message)
    this.name = 'CasTransitionRefused'
  }
}

export interface CasTransitionResult {
  /** true if the transition was applied OR was already a no-op */
  success: boolean
  /** true when the order had already left expectedStatus (no-op path) */
  wasAlreadyTransitioned: boolean
  /** Snapshot of the order row after the operation */
  orderId: string
}

/**
 * Execute a CAS (Compare-And-Swap) order status transition.
 *
 * Returns { success: true, wasAlreadyTransitioned: false } on a live transition.
 * Returns { success: true, wasAlreadyTransitioned: true  } on a no-op.
 * Throws on genuine DB errors or invalid transition attempts.
 */
export async function casTransition(
  params: CasTransitionParams
): Promise<CasTransitionResult> {
  const { orderId, expectedStatus, newStatus, actor, actorRole, metadata, patch } = params

  // Guard: validate the transition is legal before hitting the DB
  if (!canTransition(expectedStatus, newStatus)) {
    throw new CasTransitionRefused(
      'illegal_transition',
      `CAS: illegal transition ${expectedStatus} → ${newStatus} for order ${orderId}`,
    )
  }
  if (!canActorTransition(expectedStatus, newStatus, actorRole)) {
    throw new CasTransitionRefused(
      'actor_not_allowed',
      `CAS: ${actorRole} may not move order ${orderId} from ${expectedStatus} to ${newStatus}`,
    )
  }
  const patchFields = (patch ?? {}) as Record<string, unknown>
  if ('status' in patchFields || 'updated_at' in patchFields) {
    throw new Error('CAS: patch may not set status or updated_at')
  }

  // Required on entry: a field the patch sets is checked here; the rest
  // are checked by the UPDATE itself.
  const required = getRequiredFieldsOnEnter(newStatus)
  const clearedByPatch = required.filter(f => f in patchFields && patchFields[f] == null)
  if (clearedByPatch.length > 0) {
    throw new CasTransitionRefused(
      'missing_required_fields',
      `CAS: order ${orderId} cannot enter ${newStatus} without ${clearedByPatch.join(', ')}`,
      clearedByPatch,
    )
  }
  const checkedInDb = required.filter(f => !(f in patchFields))

  const supabase = createServiceClient()

  // ---- CAS UPDATE ----
  // match only if the order is still in expectedStatus (and has what the
  // new status requires)
  let update = supabase
    .from('orders')
    .update({ ...patchFields, status: newStatus, updated_at: new Date().toISOString() } as OrderUpdate)
    .eq('order_id', orderId)
    .eq('status', expectedStatus)   // ← CAS predicate
  for (const field of checkedInDb) update = update.not(field, 'is', null)
  const { data, error } = await update.select('order_id, status')

  if (error) {
    throw new Error(
      `CAS DB error for order ${orderId} (${expectedStatus} → ${newStatus}): ${error.message}`
    )
  }

  const transitioned = (data?.length ?? 0) > 0

  if (!transitioned && checkedInDb.length > 0) {
    // Not applied: either the order moved on (a no-op, as always), or it is
    // still in expectedStatus with a required field missing (refused).
    const missing = await missingRequiredFields(supabase, orderId, expectedStatus, checkedInDb)
    if (missing.length > 0) {
      console.error(`[CAS] ${orderId} | ${expectedStatus} → ${newStatus} | actor=${actor} | REFUSED: missing ${missing.join(', ')}`)
      throw new CasTransitionRefused(
        'missing_required_fields',
        `CAS: order ${orderId} cannot enter ${newStatus} without ${missing.join(', ')}`,
        missing,
      )
    }
  }

  if (transitioned) {
    // Live transition — write audit record
    await writeStatusHistory({
      orderId,
      oldStatus: expectedStatus,
      newStatus,
      actor,
      ...(metadata !== undefined ? { metadata } : {}),
    })

    logCasResult({ orderId, expectedStatus, newStatus, actor, outcome: 'transitioned' })
  } else {
    // No-op — order already past expectedStatus; safe to ignore
    logCasResult({ orderId, expectedStatus, newStatus, actor, outcome: 'no-op' })
  }

  return {
    success: true,
    wasAlreadyTransitioned: !transitioned,
    orderId,
  }
}

/** The required fields an order still in `status` lacks ([] if it left `status`). */
async function missingRequiredFields(
  supabase: ReturnType<typeof createServiceClient>,
  orderId: string,
  status: OrderStatus,
  fields: ReadonlyArray<RequiredOrderField>,
): Promise<RequiredOrderField[]> {
  const { data, error } = await supabase
    .from('orders')
    .select(['status', ...fields].join(', '))
    .eq('order_id', orderId)
    .maybeSingle()
  if (error) {
    throw new Error(`CAS DB error re-reading order ${orderId}: ${error.message}`)
  }
  const row = data as Record<string, unknown> | null
  if (!row || row['status'] !== status) return []
  return fields.filter(f => row[f] == null)
}

// ============================================================
// STATUS HISTORY WRITE
// ============================================================
// Writes one row to order_status_history (append-only).
// Called only on live transitions — no-ops must NOT be recorded.

interface WriteStatusHistoryParams {
  orderId: string
  oldStatus: OrderStatus
  newStatus: OrderStatus
  actor: string
  metadata?: Record<string, unknown>
}

async function writeStatusHistory(params: WriteStatusHistoryParams): Promise<void> {
  const supabase = createServiceClient()
  const { orderId, oldStatus, newStatus, actor, metadata } = params

  // Non-fatal (the transition is already committed), but a failure alerts ops.
  await insertStatusHistory(supabase, {
    order_id: orderId,
    old_status: oldStatus,
    new_status: newStatus,
    changed_by: actor,
    metadata: (metadata ?? null) as Json,
  }, 'casTransition')
}

// ============================================================
// LOGGING
// ============================================================

interface CasLogParams {
  orderId: string
  expectedStatus: OrderStatus
  newStatus: OrderStatus
  actor: string
  outcome: 'transitioned' | 'no-op'
}

function logCasResult(params: CasLogParams): void {
  const { orderId, expectedStatus, newStatus, actor, outcome } = params
  if (outcome === 'transitioned') {
    console.info(
      `[CAS] ${orderId} | ${expectedStatus} → ${newStatus} | actor=${actor} | APPLIED`
    )
  } else {
    console.info(
      `[CAS] ${orderId} | expected=${expectedStatus} new=${newStatus} | actor=${actor} | NO-OP (already transitioned)`
    )
  }
}
