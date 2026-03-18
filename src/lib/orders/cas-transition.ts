import { createServiceClient } from '@/lib/supabase/service'
import { canTransition } from '@/lib/orders/state-machine'
import type { OrderStatus } from '@/lib/orders/state-machine'

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
// Usage:
//   const result = await casTransition({
//     orderId, expectedStatus: 'AWAITING_PAYMENT',
//     newStatus: 'PAID_PROCESSING', actor: 'system',
//     metadata: { stripeEventId: evt.id },
//   })
//   if (!result.success && !result.wasAlreadyTransitioned) {
//     // genuine error — alert ops
//   }

export interface CasTransitionParams {
  orderId: string
  expectedStatus: OrderStatus
  newStatus: OrderStatus
  /** Actor performing the transition — stored in order_status_history */
  actor: string
  /** Optional metadata attached to the order_status_history entry */
  metadata?: Record<string, unknown>
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
  const { orderId, expectedStatus, newStatus, actor, metadata } = params

  // Guard: validate the transition is legal before hitting the DB
  if (!canTransition(expectedStatus, newStatus)) {
    throw new Error(
      `CAS: illegal transition ${expectedStatus} → ${newStatus} for order ${orderId}`
    )
  }

  const supabase = createServiceClient()

  // ---- CAS UPDATE ----
  // match only if the order is still in expectedStatus
  const { data, error } = await supabase
    .from('orders')
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq('order_id', orderId)
    .eq('status', expectedStatus)   // ← CAS predicate
    .select('order_id, status')

  if (error) {
    throw new Error(
      `CAS DB error for order ${orderId} (${expectedStatus} → ${newStatus}): ${error.message}`
    )
  }

  const transitioned = (data?.length ?? 0) > 0

  if (transitioned) {
    // Live transition — write audit record
    await writeStatusHistory({
      orderId,
      oldStatus: expectedStatus,
      newStatus,
      actor,
      metadata,
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

  const { error } = await supabase.from('order_status_history').insert({
    order_id: orderId,
    old_status: oldStatus,
    new_status: newStatus,
    changed_by: actor,
    metadata: metadata ?? null,
  })

  if (error) {
    // Non-fatal: log but don't throw — transition already committed
    console.error(
      `CAS: failed to write status history for ${orderId} (${oldStatus} → ${newStatus}):`,
      error.message
    )
  }
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

// ============================================================
// CAS TRANSACTION WRAPPER
// ============================================================
// Wraps a CAS transition + additional DB work in a single
// Supabase RPC call (Postgres function) for atomic execution.
//
// Use this when the transition must succeed atomically with
// other side effects (e.g. creating SLA deadlines, updating
// adapter_submissions).
//
// The Postgres function must:
//   1. Attempt the CAS UPDATE
//   2. If rows affected = 0, RETURN 'no-op'
//   3. Execute caller-specified side effects
//   4. RETURN 'transitioned'
//
// NOTE: Full Postgres RPC implementation is covered in the SLA
// work order (WO-11+). This wrapper is the TypeScript call site.

export interface CasRpcParams {
  orderId: string
  expectedStatus: OrderStatus
  newStatus: OrderStatus
  actor: string
  /** Name of the Postgres function implementing the atomic CAS + side effects */
  rpcName: string
  /** Additional args forwarded to the RPC function */
  rpcArgs?: Record<string, unknown>
}

export async function casTransitionRpc(
  params: CasRpcParams
): Promise<CasTransitionResult> {
  const { orderId, expectedStatus, newStatus, actor, rpcName, rpcArgs } = params

  if (!canTransition(expectedStatus, newStatus)) {
    throw new Error(
      `CAS: illegal transition ${expectedStatus} → ${newStatus} for order ${orderId}`
    )
  }

  const supabase = createServiceClient()

  const { data, error } = await supabase.rpc(rpcName, {
    p_order_id: orderId,
    p_expected_status: expectedStatus,
    p_new_status: newStatus,
    p_actor: actor,
    ...rpcArgs,
  })

  if (error) {
    throw new Error(`CAS RPC ${rpcName} error for order ${orderId}: ${error.message}`)
  }

  const wasAlreadyTransitioned = data === 'no-op'

  logCasResult({
    orderId,
    expectedStatus,
    newStatus,
    actor,
    outcome: wasAlreadyTransitioned ? 'no-op' : 'transitioned',
  })

  return { success: true, wasAlreadyTransitioned, orderId }
}
