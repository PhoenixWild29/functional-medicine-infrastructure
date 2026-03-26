// ============================================================
// Adapter Routing Engine — WO-23
// ============================================================
//
// Implements REQ-ARE-001 through REQ-ARE-005 (FRD 4 v2.0, Sub-Feature 4e).
//
// Orchestration flow:
//   1. Read pharmacies.integration_tier for target pharmacy (REQ-ARE-001)
//   2. Check circuit breaker state (REQ-ARE-003)
//      OPEN     → two-step CAS to SUBMISSION_FAILED, return circuit_open
//      HALF_OPEN → allow one test request, then evaluate
//      CLOSED   → proceed normally
//   3. Dispatch to the appropriate adapter:
//        TIER_1_API / TIER_3_SPEC → submitTier1Api(orderId, pharmacyId, tier)
//        TIER_2_PORTAL            → submitTier2Portal(orderId, pharmacyId, attemptNumber)
//        TIER_4_FAX               → submitTier4Fax(orderId)
//   4. CAS order status transitions based on adapter outcome
//   5. Update circuit breaker failure count on error
//   6. Cascade to Tier 4 fax on Tier 1/2/3 failure (REQ-ARE-002)
//   7. SUBMISSION_FAILED only after both primary tier AND Tier 4 exhausted (REQ-ARE-004)
//
// CAS transitions owned by this engine:
//   currentStatus → SUBMISSION_PENDING  (Tier 1/2/3 dispatch start; also circuit-OPEN step 1)
//   SUBMISSION_PENDING → PHARMACY_ACKNOWLEDGED  (Tier 1/2/3 accepted)
//   SUBMISSION_PENDING → REROUTE_PENDING         (pharmacy rejected order)
//   SUBMISSION_PENDING → SUBMISSION_FAILED        (step 2 for circuit-OPEN)
//   SUBMISSION_PENDING → FAX_QUEUED              (cascade to fax)
//   FAX_QUEUED → SUBMISSION_FAILED                (cascade fax also failed)
//   (Tier 4 direct: submitTier4Fax owns its own PAID_PROCESSING → FAX_QUEUED)
//   (Tier 2 manual_review: order stays in SUBMISSION_PENDING — ops reviews screenshot)
//
// Hard Constraint HC-13: No automatic tier downgrade at runtime.
//   Cascade to Tier 4 on failure is a safety net, NOT a tier change.
//   pharmacies.integration_tier is never mutated here.
//
// Circuit breaker schema (circuit_breaker_state):
//   pharmacy_id (PK), state, failure_count, last_failure_at,
//   cooldown_until, tripped_by_submission_id, updated_at

import { createServiceClient } from '@/lib/supabase/service'
import { casTransition } from '@/lib/orders/cas-transition'
import type { OrderStatus } from '@/lib/orders/state-machine'
import { submitTier1Api } from '@/lib/adapters/tier1-api'
import { submitTier2Portal } from '@/lib/adapters/tier2-portal'
import { submitTier4Fax } from '@/lib/adapters/tier4-fax'
import { sendSlackAlert, buildAdapterFailureAlert } from '@/lib/slack/client'
import type { IntegrationTier } from '@/lib/adapters/audit-trail'

// ============================================================
// CONSTANTS
// ============================================================

/** Consecutive failures within the window that trip circuit OPEN */
const CB_FAILURE_THRESHOLD = 5
/** Rolling window for failure counting (10 minutes) */
const CB_WINDOW_MS         = 10 * 60 * 1000
/** Cooldown before OPEN → HALF_OPEN test (5 minutes) */
const CB_COOLDOWN_MS       = 5  * 60 * 1000

// ============================================================
// TYPES
// ============================================================

export type { IntegrationTier }
export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN'

export interface RouteOrderParams {
  orderId:       string
  pharmacyId:    string
  /** Current order status — used as CAS expectedStatus for opening transitions */
  currentStatus: OrderStatus
  /** Attempt number forwarded to Tier 2 portal adapter */
  attemptNumber?: number
}

export interface RouteOrderResult {
  outcome:        'accepted' | 'manual_review' | 'reroute_pending' | 'cascaded_to_fax' | 'submission_failed' | 'circuit_open'
  submissionId?:  string
  tier:           IntegrationTier
  cascadeReason?: string
}

interface CircuitBreakerRow {
  pharmacy_id:              string
  state:                    CircuitBreakerState
  failure_count:            number
  last_failure_at:          string | null
  cooldown_until:           string | null
  tripped_by_submission_id: string | null
  updated_at:               string
}

// ============================================================
// CIRCUIT BREAKER
// ============================================================

/**
 * Returns the effective circuit breaker state.
 * Does NOT perform writes — OPEN → HALF_OPEN advancement is handled
 * by advanceCircuitToHalfOpen() called explicitly in routeOrder.
 * Returns CLOSED when no row exists (default healthy state).
 */
async function getCircuitBreakerRow(
  pharmacyId: string
): Promise<CircuitBreakerRow | null> {
  const supabase = createServiceClient()

  const { data: row } = await supabase
    .from('circuit_breaker_state')
    .select('*')
    .eq('pharmacy_id', pharmacyId)
    .maybeSingle()

  return row as CircuitBreakerRow | null
}

/**
 * Writes HALF_OPEN to circuit_breaker_state when the cooldown has elapsed.
 */
async function advanceCircuitToHalfOpen(pharmacyId: string): Promise<void> {
  const supabase = createServiceClient()

  const { error } = await supabase
    .from('circuit_breaker_state')
    .update({ state: 'HALF_OPEN', updated_at: new Date().toISOString() })
    .eq('pharmacy_id', pharmacyId)

  if (error) {
    // Non-fatal: log and proceed — the circuit will advance on next poll
    console.error(
      `[routing-engine] failed to advance circuit to HALF_OPEN for pharmacy=${pharmacyId}:`,
      error.message
    )
  }
}

/**
 * Resolves the current effective circuit breaker state, advancing
 * OPEN → HALF_OPEN when the cooldown window has elapsed.
 */
async function resolveCircuitBreakerState(
  pharmacyId: string
): Promise<{ state: CircuitBreakerState; row: CircuitBreakerRow | null }> {
  const row = await getCircuitBreakerRow(pharmacyId)

  if (!row) return { state: 'CLOSED', row: null }

  // Auto-advance OPEN → HALF_OPEN when cooldown has elapsed
  if (row.state === 'OPEN' && row.cooldown_until) {
    if (Date.now() >= new Date(row.cooldown_until).getTime()) {
      await advanceCircuitToHalfOpen(pharmacyId)
      return { state: 'HALF_OPEN', row: { ...row, state: 'HALF_OPEN' } }
    }
  }

  return { state: row.state, row }
}

/**
 * Resets circuit breaker to CLOSED after a successful submission.
 */
async function recordCircuitSuccess(pharmacyId: string): Promise<void> {
  const supabase = createServiceClient()

  await supabase
    .from('circuit_breaker_state')
    .upsert(
      {
        pharmacy_id:              pharmacyId,
        state:                    'CLOSED',
        failure_count:            0,
        last_failure_at:          null,
        cooldown_until:           null,
        tripped_by_submission_id: null,
        updated_at:               new Date().toISOString(),
      },
      { onConflict: 'pharmacy_id' }
    )
}

/**
 * Increments failure count for a pharmacy. If count reaches CB_FAILURE_THRESHOLD
 * within the rolling 10-minute window, or if the circuit was HALF_OPEN (test failed),
 * trips the circuit to OPEN and fires a Slack alert.
 *
 * @param pharmacyId   The pharmacy that failed
 * @param submissionId Submission ID that triggered the failure (use orderId as fallback when adapter crashed before creating a submission)
 * @param orderId      Actual order ID for Slack alert context
 * @param pharmacySlug Pharmacy slug for Slack alert
 * @param tier         Integration tier for Slack alert
 * @param existingRow  Pre-fetched circuit_breaker_state row (avoids a second DB round-trip)
 */
async function recordCircuitFailure(params: {
  pharmacyId:    string
  submissionId:  string
  orderId:       string
  pharmacySlug:  string
  tier:          IntegrationTier
  existingRow:   CircuitBreakerRow | null
}): Promise<void> {
  const { pharmacyId, submissionId, orderId, pharmacySlug, tier, existingRow } = params
  const supabase = createServiceClient()
  const nowMs    = Date.now()
  const nowIso   = new Date(nowMs).toISOString()

  // Reset count if the last failure was outside the 10-min window.
  // Note: when row is null (first-ever failure), lastMs = 0, so
  // (nowMs - lastMs) >> CB_WINDOW_MS — windowExpired = true, prevCount = 0 as intended.
  const lastMs        = existingRow?.last_failure_at
    ? new Date(existingRow.last_failure_at).getTime()
    : 0
  const windowExpired = (nowMs - lastMs) > CB_WINDOW_MS
  const prevCount     = windowExpired ? 0 : (existingRow?.failure_count ?? 0)
  const newCount      = prevCount + 1

  // HALF_OPEN test failure → immediately OPEN (even if count < threshold)
  const wasHalfOpen  = existingRow?.state === 'HALF_OPEN'
  const shouldOpen   = newCount >= CB_FAILURE_THRESHOLD || wasHalfOpen
  const newState: CircuitBreakerState = shouldOpen ? 'OPEN' : 'CLOSED'
  const cooldownUntil = shouldOpen
    ? new Date(nowMs + CB_COOLDOWN_MS).toISOString()
    : null

  const { error } = await supabase
    .from('circuit_breaker_state')
    .upsert(
      {
        pharmacy_id:              pharmacyId,
        state:                    newState,
        failure_count:            newCount,
        last_failure_at:          nowIso,
        cooldown_until:           cooldownUntil,
        tripped_by_submission_id: shouldOpen
          ? submissionId
          : (existingRow?.tripped_by_submission_id ?? null),
        updated_at:               nowIso,
      },
      { onConflict: 'pharmacy_id' }
    )

  if (error) {
    console.error(
      `[routing-engine] circuit breaker upsert failed for pharmacy=${pharmacyId}:`,
      error.message
    )
  }

  if (shouldOpen) {
    const reason = wasHalfOpen ? 'half_open_test_failed' : `${newCount}_consecutive_failures`
    console.warn(
      `[routing-engine] circuit OPEN | pharmacy=${pharmacyId} | reason=${reason} | tripped_by=${submissionId}`
    )

    await sendSlackAlert(
      buildAdapterFailureAlert({
        orderId,       // NB-07: pass actual orderId, not submissionId
        pharmacySlug,
        integrationTier: tier,
        errorCode:     `circuit_breaker_opened (${reason})`,
      })
    ).catch(slackErr =>
      console.error('[routing-engine] Slack circuit-open alert failed:', slackErr)
    )
  }
}

// ============================================================
// PHARMACY LOOKUP
// ============================================================

async function loadPharmacy(pharmacyId: string): Promise<{
  integration_tier: IntegrationTier
  name:  string
  slug:  string
} | null> {
  const supabase = createServiceClient()

  // NB-04: use maybeSingle() so a missing pharmacy returns null (not a throw)
  const { data } = await supabase
    .from('pharmacies')
    .select('integration_tier, name, slug')
    .eq('pharmacy_id', pharmacyId)
    .eq('is_active', true)
    .maybeSingle()

  return data as { integration_tier: IntegrationTier; name: string; slug: string } | null
}

// ============================================================
// CASCADE REASON LABELS (REQ-ARE-002)
// ============================================================

function cascadeReasonFor(tier: IntegrationTier): string {
  switch (tier) {
    case 'TIER_1_API':    return 'tier1_timeout'
    case 'TIER_3_SPEC':   return 'tier3_api_unavailable'
    case 'TIER_2_PORTAL': return 'tier2_portal_error'
    // TIER_4_FAX and TIER_3_HYBRID are not reachable via the cascade path
    default:              return 'unknown_tier_failure'
  }
}

// ============================================================
// MAIN ROUTING FUNCTION
// ============================================================

export async function routeOrder(params: RouteOrderParams): Promise<RouteOrderResult> {
  const { orderId, pharmacyId, currentStatus, attemptNumber = 1 } = params

  // ── 1. Resolve integration tier ───────────────────────────
  const pharmacy = await loadPharmacy(pharmacyId)
  if (!pharmacy) {
    throw new Error(`[routing-engine] pharmacy ${pharmacyId} not found or inactive`)
  }

  const tier = pharmacy.integration_tier

  // BLK-05: TIER_3_HYBRID is not implemented — surface misconfiguration immediately
  if (tier === 'TIER_3_HYBRID') {
    throw new Error(
      `[routing-engine] TIER_3_HYBRID is not yet supported by the routing engine (pharmacy ${pharmacyId})`
    )
  }

  // ── 2. Circuit breaker check ───────────────────────────────
  const { state: cbState, row: cbRow } = await resolveCircuitBreakerState(pharmacyId)

  if (cbState === 'OPEN') {
    console.warn(
      `[routing-engine] circuit OPEN — blocking | pharmacy=${pharmacyId} | order=${orderId}`
    )

    // BLK-01: PAID_PROCESSING → SUBMISSION_FAILED is not a valid transition.
    // Two-step CAS: currentStatus → SUBMISSION_PENDING → SUBMISSION_FAILED.
    try {
      await casTransition({
        orderId,
        expectedStatus: currentStatus,
        newStatus:      'SUBMISSION_PENDING',
        actor:          'routing_engine',
        metadata:       { reason: 'circuit_breaker_open_blocking', pharmacy_id: pharmacyId, tier },
      })
      await casTransition({
        orderId,
        expectedStatus: 'SUBMISSION_PENDING',
        newStatus:      'SUBMISSION_FAILED',
        actor:          'routing_engine',
        metadata:       { reason: 'circuit_breaker_open', pharmacy_id: pharmacyId, tier },
      })
    } catch (casErr) {
      console.error('[routing-engine] CAS SUBMISSION_FAILED (circuit open) error:', casErr)
    }

    return { outcome: 'circuit_open', tier }
  }

  // ── 3. Dispatch primary tier ───────────────────────────────
  //
  // Tier 4 direct: submitTier4Fax owns PAID_PROCESSING → FAX_QUEUED internally.
  // Tier 1/2/3: we CAS to SUBMISSION_PENDING first, then call the adapter.

  let primarySubmissionId: string | undefined

  if (tier === 'TIER_4_FAX') {
    // ── 3a. Direct Tier 4 dispatch ──────────────────────────
    try {
      const result = await submitTier4Fax(orderId)
      primarySubmissionId = result.submissionId

      await recordCircuitSuccess(pharmacyId)
      console.info(`[routing-engine] tier4 direct accepted | order=${orderId}`)
      return { outcome: 'accepted', ...(primarySubmissionId ? { submissionId: primarySubmissionId } : {}), tier }

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[routing-engine] tier4 direct failed | order=${orderId}:`, msg)

      // Tier 4 is the final fallback — no cascade possible
      // NB-3: submitTier4Fax internally CAS-es PAID_PROCESSING → FAX_QUEUED before
      // calling Documo. If Documo then fails, the order is already in FAX_QUEUED when
      // we reach this catch block. The CAS below (expectedStatus: currentStatus which
      // is typically PAID_PROCESSING) will be a no-op (0 rows matched) and the order
      // remains in FAX_QUEUED. This is intentional — the fax-retry cron will pick it
      // up for retry, which is the correct recovery path. The .catch() makes any CAS
      // error non-fatal.
      await casTransition({
        orderId,
        expectedStatus: currentStatus,
        newStatus:      'SUBMISSION_FAILED',
        actor:          'routing_engine',
        metadata:       { tier, reason: cascadeReasonFor(tier), error: msg },
      }).catch(casErr =>
        console.error('[routing-engine] CAS SUBMISSION_FAILED (tier4 direct) error:', casErr)
      )

      return { outcome: 'submission_failed', tier, cascadeReason: cascadeReasonFor(tier) }
    }
  }

  // ── 3b. Tier 1 / 2 / 3 dispatch ────────────────────────────

  // CAS to SUBMISSION_PENDING before calling adapter
  await casTransition({
    orderId,
    expectedStatus: currentStatus,
    newStatus:      'SUBMISSION_PENDING',
    actor:          'routing_engine',
    metadata:       { tier, attempt: attemptNumber },
  })

  type PrimaryOutcome = 'accepted' | 'manual_review' | 'rejected' | 'exhausted'
  let primaryOutcome: PrimaryOutcome = 'exhausted'

  try {
    if (tier === 'TIER_1_API' || tier === 'TIER_3_SPEC') {
      const result = await submitTier1Api(orderId, pharmacyId, tier)
      primarySubmissionId = result.submissionId
      primaryOutcome      = result.outcome === 'accepted' ? 'accepted'
                          : result.outcome === 'rejected' ? 'rejected'
                          : 'exhausted'

    } else {
      // TIER_2_PORTAL
      const result = await submitTier2Portal(orderId, pharmacyId, attemptNumber)
      primarySubmissionId = result.submissionId
      // BLK-03: distinguish acknowledged (PHARMACY_ACKNOWLEDGED), manual_review (stays SUBMISSION_PENDING),
      // and portal_error (cascade to fax)
      primaryOutcome = result.outcome === 'portal_error'   ? 'exhausted'
                     : result.outcome === 'manual_review'  ? 'manual_review'
                     : 'accepted'
    }

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[routing-engine] dispatch error | order=${orderId} | tier=${tier}:`, msg)
    primaryOutcome = 'exhausted'
  }

  // ── 4. Handle primary outcome ──────────────────────────────

  if (primaryOutcome === 'accepted') {
    await recordCircuitSuccess(pharmacyId)

    await casTransition({
      orderId,
      expectedStatus: 'SUBMISSION_PENDING',
      newStatus:      'PHARMACY_ACKNOWLEDGED',
      actor:          'routing_engine',
      metadata:       { tier, submission_id: primarySubmissionId },
    }).catch(err =>
      console.error('[routing-engine] CAS PHARMACY_ACKNOWLEDGED error:', err)
    )

    console.info(`[routing-engine] accepted | order=${orderId} | tier=${tier}`)
    return { outcome: 'accepted', ...(primarySubmissionId ? { submissionId: primarySubmissionId } : {}), tier }
  }

  if (primaryOutcome === 'manual_review') {
    // BLK-03: Tier 2 manual_review — order stays in SUBMISSION_PENDING for ops to review.
    // Do NOT advance to PHARMACY_ACKNOWLEDGED; reset circuit (portal submitted successfully).
    await recordCircuitSuccess(pharmacyId)

    console.warn(
      `[routing-engine] manual_review | order=${orderId} | tier=${tier} | submission=${primarySubmissionId}`
    )
    return { outcome: 'manual_review', ...(primarySubmissionId ? { submissionId: primarySubmissionId } : {}), tier }
  }

  if (primaryOutcome === 'rejected') {
    // Pharmacy explicitly rejected — not a circuit failure.
    // CAS → REROUTE_PENDING for ops to handle.
    await casTransition({
      orderId,
      expectedStatus: 'SUBMISSION_PENDING',
      newStatus:      'REROUTE_PENDING',
      actor:          'routing_engine',
      metadata:       { tier, submission_id: primarySubmissionId, reason: 'pharmacy_rejected' },
    }).catch(err =>
      console.error('[routing-engine] CAS REROUTE_PENDING error:', err)
    )

    console.warn(`[routing-engine] pharmacy rejected | order=${orderId} | tier=${tier}`)
    // BLK-02: return 'reroute_pending', not 'accepted'
    return { outcome: 'reroute_pending', ...(primarySubmissionId ? { submissionId: primarySubmissionId } : {}), tier }
  }

  // ── 5. Primary tier exhausted — increment circuit breaker ─
  const cascadeReason = cascadeReasonFor(tier)

  // BLK-04: when the adapter threw before creating a submission, fall back to orderId
  // to ensure the circuit breaker always gets incremented on hard failures.
  const failureSubmissionId = primarySubmissionId ?? orderId

  await recordCircuitFailure({
    pharmacyId,
    submissionId: failureSubmissionId,
    orderId,
    pharmacySlug: pharmacy.slug,
    tier,
    existingRow:  cbRow,   // NB-06: reuse row already fetched by resolveCircuitBreakerState
  }).catch(err =>
    console.error('[routing-engine] circuit failure record error:', err)
  )

  // ── 6. REQ-ARE-002: Cascade to Tier 4 fax ─────────────────
  // HC-13: This is a fallback safety net — pharmacies.integration_tier is NOT changed.
  console.warn(
    `[routing-engine] primary exhausted, cascading to fax | order=${orderId} | reason=${cascadeReason}`
  )

  // BLK-06: wrap cascade CAS in try/catch — if it fails, we cannot call submitTier4Fax safely
  try {
    await casTransition({
      orderId,
      expectedStatus: 'SUBMISSION_PENDING',
      newStatus:      'FAX_QUEUED',
      actor:          'routing_engine',
      metadata:       {
        cascade_reason:  cascadeReason,
        original_tier:   tier,
        submission_id:   primarySubmissionId,
      },
    })
  } catch (casErr) {
    const casMsg = casErr instanceof Error ? casErr.message : String(casErr)
    console.error(
      `[routing-engine] CAS SUBMISSION_PENDING → FAX_QUEUED failed | order=${orderId}:`, casMsg
    )
    // Cannot safely proceed to fax — return submission_failed
    return {
      outcome:       'submission_failed',
      ...(primarySubmissionId ? { submissionId: primarySubmissionId } : {}),
      tier,
      cascadeReason,
    }
  }

  try {
    // submitTier4Fax internally tries CAS PAID_PROCESSING → FAX_QUEUED on attempt 1;
    // that CAS will be a no-op (order already in FAX_QUEUED from above), which is fine.
    const faxResult = await submitTier4Fax(orderId)

    console.info(
      `[routing-engine] cascade fax accepted | order=${orderId} | fax_submission=${faxResult.submissionId}`
    )

    return {
      outcome:       'cascaded_to_fax',
      submissionId:  faxResult.submissionId,
      tier,
      cascadeReason,
    }

  } catch (faxErr) {
    const faxMsg = faxErr instanceof Error ? faxErr.message : String(faxErr)
    console.error(`[routing-engine] cascade fax failed | order=${orderId}:`, faxMsg)

    // REQ-ARE-004: both primary AND Tier 4 exhausted → SUBMISSION_FAILED
    await casTransition({
      orderId,
      expectedStatus: 'FAX_QUEUED',
      newStatus:      'SUBMISSION_FAILED',
      actor:          'routing_engine',
      metadata:       {
        cascade_reason:        cascadeReason,
        original_tier:         tier,
        primary_submission_id: primarySubmissionId,
        fax_error:             faxMsg,
      },
    }).catch(err =>
      console.error('[routing-engine] CAS SUBMISSION_FAILED (cascade fax fail) error:', err)
    )

    return {
      outcome:       'submission_failed',
      ...(primarySubmissionId ? { submissionId: primarySubmissionId } : {}),
      tier,
      cascadeReason,
    }
  }
}
