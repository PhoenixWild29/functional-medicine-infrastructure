// ============================================================
// Adapter Routing Engine — WO-23
// ============================================================
//
// Implements REQ-ARE-001 through REQ-ARE-005 (FRD 4 v2.0, Sub-Feature 4e).
//
// Orchestration flow:
//   1. Claim the order: CAS currentStatus → SUBMISSION_PENDING. Only the
//      caller that wins the claim submits (exactly-once submission).
//   2. Read pharmacies.integration_tier for target pharmacy (REQ-ARE-001)
//   3. Check circuit breaker state (REQ-ARE-003)
//      OPEN     → SUBMISSION_FAILED + alert, return circuit_open
//      HALF_OPEN → allow one test request, then evaluate
//      CLOSED   → proceed normally
//   4. Dispatch to the appropriate adapter:
//        TIER_1_API / TIER_3_SPEC → submitTier1Api(orderId, pharmacyId, tier)
//        TIER_2_PORTAL            → submitTier2Portal(orderId, pharmacyId, attemptNumber)
//        TIER_4_FAX               → submitTier4Fax(orderId)
//        TIER_3_HYBRID            → unsupported: SUBMISSION_FAILED + alert
//   5. CAS order status transitions based on adapter outcome, with SLAs
//   6. Update circuit breaker failure count on error
//   7. Cascade to Tier 4 fax on Tier 1/2/3 failure (REQ-ARE-002)
//   8. SUBMISSION_FAILED + Slack alert only after both primary tier AND
//      Tier 4 exhausted, or on any other failure after the claim (REQ-ARE-004)
//
// CAS transitions owned by this engine:
//   currentStatus → SUBMISSION_PENDING          (the claim; every tier)
//   SUBMISSION_PENDING → PHARMACY_ACKNOWLEDGED  (Tier 1/2/3 accepted)
//   SUBMISSION_PENDING → REROUTE_PENDING        (pharmacy rejected order)
//   SUBMISSION_PENDING → FAX_QUEUED             (fax sent: Tier 4 direct or cascade)
//   SUBMISSION_PENDING → SUBMISSION_FAILED      (any failure)
//   FAX_QUEUED → FAX_FAILED                     (ops fax send failed; submitQueuedFax)
//   (Tier 2 manual_review: order stays in SUBMISSION_PENDING — ops reviews screenshot)
//
// Callers: the Stripe webhook (after the response), the submit-paid-orders
// cron (stranded PAID_PROCESSING orders), /api/adapters/route-order, and
// the ops actions retry_submission (routeOrder) and force_fax / retry_fax
// (submitQueuedFax).
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
import { sendSlackAlert, buildAdapterFailureAlert, buildSubmissionFailedAlert } from '@/lib/slack/client'
import { createSlasForTransition, upsertFaxDeliverySla } from '@/lib/sla/creator'
import { resolveSlasForTransition } from '@/lib/sla/resolver'
import type { IntegrationTier } from '@/lib/adapters/audit-trail'
import { pharmacySubmissionsEnabled } from '@/lib/adapters/submission-switch'
import { checkOrderLicensure, normalizeFacilityType } from '@/lib/compliance/pharmacy-licensure'

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
  /**
   * not_claimed: the order had already left currentStatus; nothing was submitted.
   * submissions_disabled: PHARMACY_SUBMISSIONS_ENABLED is off; the order was not touched.
   */
  outcome:        'accepted' | 'manual_review' | 'reroute_pending' | 'cascaded_to_fax' | 'submission_failed' | 'circuit_open' | 'not_claimed' | 'submissions_disabled'
  submissionId?:  string
  /** null when the pharmacy is missing or inactive */
  tier:           IntegrationTier | null
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

  const { data: row, error } = await supabase
    .from('circuit_breaker_state')
    .select('*')
    .eq('pharmacy_id', pharmacyId)
    .maybeSingle()

  // A failed read is not a CLOSED circuit: stop rather than submit blind.
  if (error) {
    throw new Error(
      `[routing-engine] circuit breaker state for pharmacy ${pharmacyId} could not be read: ${error.message}`
    )
  }

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

  const { error } = await supabase
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

  if (error) {
    // The submission already succeeded; a stale failure count only makes
    // the breaker trip sooner. Log it, don't fail the submission.
    console.error(
      `[routing-engine] failed to reset circuit to CLOSED for pharmacy=${pharmacyId}:`,
      error.message
    )
  }
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
        errorCode:     'circuit_breaker_opened',
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
  facility_type?: string | null
} | null> {
  const supabase = createServiceClient()

  // NB-04: use maybeSingle() so a missing pharmacy returns null (not a throw)
  const { data, error } = await supabase
    .from('pharmacies')
    .select('integration_tier, name, slug, facility_type')
    .eq('pharmacy_id', pharmacyId)
    .eq('is_active', true)
    .maybeSingle()

  if (error) {
    throw new Error(`[routing-engine] pharmacy ${pharmacyId} could not be read: ${error.message}`)
  }

  return data as { integration_tier: IntegrationTier; name: string; slug: string; facility_type?: string | null } | null
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
// FAILURE AND HAND-OFF HELPERS
// ============================================================

/**
 * Lands a claimed order (SUBMISSION_PENDING) in SUBMISSION_FAILED and tells
 * ops (REQ-ARE-004). Every failure after the claim ends here, so no failure
 * leaves an order in SUBMISSION_PENDING or PAID_PROCESSING.
 *
 * The Slack alert carries a reason code only: adapter error text can echo
 * patient details, so it goes to the status history (RLS-protected), never
 * to Slack.
 */
async function failSubmission(params: {
  orderId:       string
  pharmacySlug:  string
  tier:          IntegrationTier | null
  reason:        string
  error?:        string
  submissionId?: string
}): Promise<void> {
  const { orderId, pharmacySlug, tier, reason, error, submissionId } = params

  let transitioned = false
  let casFailed = false
  try {
    const cas = await casTransition({
      orderId,
      expectedStatus: 'SUBMISSION_PENDING',
      newStatus:      'SUBMISSION_FAILED',
      actor:          'routing_engine',
      metadata:       {
        tier,
        reason,
        ...(error ? { error } : {}),
        ...(submissionId ? { submission_id: submissionId } : {}),
      },
    })
    transitioned = !cas.wasAlreadyTransitioned
  } catch (casErr) {
    // The order is stuck in SUBMISSION_PENDING. Its SLA still fires, and the
    // alert below tells ops now.
    casFailed = true
    console.error(`[routing-engine] CAS SUBMISSION_FAILED error | order=${orderId}:`, casErr)
  }

  // Someone else already moved the order on: nothing failed from their view.
  if (!transitioned && !casFailed) return

  if (transitioned) await resolveSlasForTransition(orderId, 'SUBMISSION_FAILED')

  console.error(`[routing-engine] SUBMISSION_FAILED | order=${orderId} | tier=${tier ?? 'unknown'} | reason=${reason}`)
  await sendSlackAlert(
    buildSubmissionFailedAlert({
      orderId,
      pharmacySlug,
      // The adapter's error text is logged above, never sent to Slack.
      failedTier:     tier ?? null,
      statusNotSet:   casFailed,
    })
  ).catch(slackErr =>
    console.error('[routing-engine] Slack SUBMISSION_FAILED alert failed:', slackErr)
  )
}

/**
 * Moves an order whose fax has gone out from SUBMISSION_PENDING to
 * FAX_QUEUED and starts the FAX_DELIVERY SLA. The fax is already sent, so
 * a failure here must NOT fail the submission (ops would fax it again): it
 * alerts instead.
 */
async function markFaxQueued(params: {
  orderId:      string
  pharmacySlug: string
  metadata:     Record<string, unknown>
}): Promise<void> {
  const { orderId, pharmacySlug, metadata } = params
  try {
    const cas = await casTransition({
      orderId,
      expectedStatus: 'SUBMISSION_PENDING',
      newStatus:      'FAX_QUEUED',
      actor:          'routing_engine',
      metadata,
    })
    if (!cas.wasAlreadyTransitioned) {
      await upsertFaxDeliverySla(orderId)
      await resolveSlasForTransition(orderId, 'FAX_QUEUED')
    }
  } catch (casErr) {
    console.error(`[routing-engine] fax sent but FAX_QUEUED not recorded | order=${orderId}:`, casErr)
    await sendSlackAlert(
      buildAdapterFailureAlert({
        orderId,
        pharmacySlug,
        integrationTier: 'TIER_4_FAX',
        errorCode:       'fax_sent_status_not_updated',
      })
    ).catch(slackErr =>
      console.error('[routing-engine] Slack fax-status alert failed:', slackErr)
    )
  }
}

// ============================================================
// MAIN ROUTING FUNCTION
// ============================================================
//
// The claim: the first thing routeOrder does with an order is CAS it from
// the status it was called with into SUBMISSION_PENDING. Only the caller
// that makes that transition submits. A redelivered webhook, the
// stranded-order cron, or two ops clicks find the order already moved and
// return 'not_claimed' without calling any adapter. That is what makes a
// paid order go to its pharmacy exactly once.
//
// Every tier, Tier 4 included, is submitted while the order sits in
// SUBMISSION_PENDING, so every failure has a legal way into
// SUBMISSION_FAILED (PAID_PROCESSING and FAX_QUEUED have none).

export async function routeOrder(params: RouteOrderParams): Promise<RouteOrderResult> {
  const { orderId, pharmacyId, currentStatus, attemptNumber = 1 } = params

  // ── 0. Kill switch ────────────────────────────────────────
  // Off: do not claim. The order stays in currentStatus with no SLA rows,
  // ready to be submitted once the owner turns submissions on.
  if (!pharmacySubmissionsEnabled()) {
    console.info(
      `[routing-engine] pharmacy submissions are turned off | order=${orderId} not claimed, stays ${currentStatus}`
    )
    return { outcome: 'submissions_disabled', tier: null }
  }

  // ── 1. Claim ──────────────────────────────────────────────
  const claim = await casTransition({
    orderId,
    expectedStatus: currentStatus,
    newStatus:      'SUBMISSION_PENDING',
    actor:          'routing_engine',
    metadata:       { pharmacy_id: pharmacyId, attempt: attemptNumber },
  })
  if (claim.wasAlreadyTransitioned) {
    console.info(
      `[routing-engine] not claimed | order=${orderId} already left ${currentStatus} | nothing submitted`
    )
    return { outcome: 'not_claimed', tier: null }
  }

  // ── 2. Submit. Nothing after the claim may escape: an order that is
  //       claimed and then abandoned would sit in SUBMISSION_PENDING. ──
  let pharmacy: Awaited<ReturnType<typeof loadPharmacy>> = null
  try {
    // REQ-ARE-001: resolve the integration tier
    pharmacy = await loadPharmacy(pharmacyId)
    return await submitClaimedOrder({ orderId, pharmacyId, pharmacy, attemptNumber })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[routing-engine] unexpected error after claim | order=${orderId}:`, msg)
    const tier = pharmacy?.integration_tier ?? null
    await failSubmission({ orderId, pharmacySlug: pharmacy?.slug ?? pharmacyId, tier, reason: 'routing_error', error: msg })
    return { outcome: 'submission_failed', tier }
  }
}

async function submitClaimedOrder(params: {
  orderId:       string
  pharmacyId:    string
  pharmacy:      Awaited<ReturnType<typeof loadPharmacy>>
  attemptNumber: number
}): Promise<RouteOrderResult> {
  const { orderId, pharmacyId, pharmacy, attemptNumber } = params

  if (!pharmacy) {
    await failSubmission({ orderId, pharmacySlug: pharmacyId, tier: null, reason: 'pharmacy_not_found_or_inactive' })
    return { outcome: 'submission_failed', tier: null }
  }

  const tier = pharmacy.integration_tier
  const pharmacySlug = pharmacy.slug

  // BLK-05: TIER_3_HYBRID is not implemented. Fail loudly, never hang.
  if (tier === 'TIER_3_HYBRID') {
    await failSubmission({ orderId, pharmacySlug, tier, reason: 'tier3_hybrid_unsupported' })
    return { outcome: 'submission_failed', tier }
  }

  // ── C5: licensure, re-checked before anything is sent ──────
  // The license may have expired, or the order been rerouted, since it
  // was signed. Not licensed for the shipping state (or not for sterile
  // compounding when the product is sterile) → SUBMISSION_FAILED with an
  // alert, so ops can reroute. A read that fails throws: routeOrder lands
  // it in SUBMISSION_FAILED as a routing error; nothing is sent blind.
  const licensure = await checkOrderLicensure(createServiceClient(), {
    orderId, pharmacyId, pharmacyName: pharmacy.name, facilityType: normalizeFacilityType(pharmacy.facility_type),
  })
  if (!licensure.ok) {
    console.warn(`[routing-engine] not licensed | order=${orderId} | pharmacy=${pharmacyId} | problem=${licensure.problem}`)
    await failSubmission({ orderId, pharmacySlug, tier, reason: 'pharmacy_not_licensed', error: licensure.message })
    return { outcome: 'submission_failed', tier }
  }

  // ── Circuit breaker check ──────────────────────────────────
  const { state: cbState, row: cbRow } = await resolveCircuitBreakerState(pharmacyId)

  if (cbState === 'OPEN') {
    console.warn(
      `[routing-engine] circuit OPEN — blocking | pharmacy=${pharmacyId} | order=${orderId}`
    )
    await failSubmission({ orderId, pharmacySlug, tier, reason: 'circuit_breaker_open' })
    return { outcome: 'circuit_open', tier }
  }

  // ── Tier 4 direct ──────────────────────────────────────────
  if (tier === 'TIER_4_FAX') {
    // Started before the send, so an order whose function dies mid-send
    // still breaches an SLA instead of disappearing.
    await upsertFaxDeliverySla(orderId)

    let faxResult: Awaited<ReturnType<typeof submitTier4Fax>>
    try {
      faxResult = await submitTier4Fax(orderId)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[routing-engine] tier4 direct failed | order=${orderId}:`, msg)
      // Tier 4 is the final fallback — no cascade possible
      await failSubmission({ orderId, pharmacySlug, tier, reason: 'tier4_fax_send_failed', error: msg })
      return { outcome: 'submission_failed', tier }
    }

    await recordCircuitSuccess(pharmacyId)
    await markFaxQueued({
      orderId,
      pharmacySlug,
      metadata: { tier, submission_id: faxResult.submissionId, documo_fax_id: faxResult.documoFaxId },
    })
    console.info(`[routing-engine] tier4 direct accepted | order=${orderId}`)
    return { outcome: 'accepted', submissionId: faxResult.submissionId, tier }
  }

  // ── Tier 1 / 2 / 3 dispatch ────────────────────────────────
  // REQ-SLM-005: the ADAPTER_SUBMISSION_ACK SLA starts with the claim, before
  // the pharmacy is called, so sla-check's fax cascade covers an adapter
  // that never answers.
  await createSlasForTransition({ orderId, newStatus: 'SUBMISSION_PENDING', pharmacyId, tier })

  type PrimaryOutcome = 'accepted' | 'manual_review' | 'rejected' | 'exhausted'
  let primaryOutcome: PrimaryOutcome = 'exhausted'
  let primarySubmissionId: string | undefined

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

  const withSubmission = primarySubmissionId ? { submissionId: primarySubmissionId } : {}

  if (primaryOutcome === 'accepted') {
    await recordCircuitSuccess(pharmacyId)

    try {
      const cas = await casTransition({
        orderId,
        expectedStatus: 'SUBMISSION_PENDING',
        newStatus:      'PHARMACY_ACKNOWLEDGED',
        actor:          'routing_engine',
        metadata:       { tier, submission_id: primarySubmissionId },
      })
      if (!cas.wasAlreadyTransitioned) {
        await createSlasForTransition({ orderId, newStatus: 'PHARMACY_ACKNOWLEDGED', pharmacyId, tier })
        await resolveSlasForTransition(orderId, 'PHARMACY_ACKNOWLEDGED')
      }
    } catch (err) {
      // The pharmacy has the order. Its ADAPTER_SUBMISSION_ACK SLA is still
      // open, so a pharmacy webhook (or the SLA) settles the status.
      console.error('[routing-engine] CAS PHARMACY_ACKNOWLEDGED error:', err)
    }

    console.info(`[routing-engine] accepted | order=${orderId} | tier=${tier}`)
    return { outcome: 'accepted', ...withSubmission, tier }
  }

  if (primaryOutcome === 'manual_review') {
    // BLK-03: Tier 2 manual_review — order stays in SUBMISSION_PENDING for ops to review.
    // Do NOT advance to PHARMACY_ACKNOWLEDGED; reset circuit (portal submitted successfully).
    await recordCircuitSuccess(pharmacyId)

    console.warn(
      `[routing-engine] manual_review | order=${orderId} | tier=${tier} | submission=${primarySubmissionId}`
    )
    return { outcome: 'manual_review', ...withSubmission, tier }
  }

  if (primaryOutcome === 'rejected') {
    // Pharmacy explicitly rejected — not a circuit failure.
    // CAS → REROUTE_PENDING for ops to handle.
    try {
      const cas = await casTransition({
        orderId,
        expectedStatus: 'SUBMISSION_PENDING',
        newStatus:      'REROUTE_PENDING',
        actor:          'routing_engine',
        metadata:       { tier, submission_id: primarySubmissionId, reason: 'pharmacy_rejected' },
      })
      if (!cas.wasAlreadyTransitioned) await resolveSlasForTransition(orderId, 'REROUTE_PENDING')
    } catch (err) {
      console.error('[routing-engine] CAS REROUTE_PENDING error:', err)
    }

    await sendSlackAlert(
      buildAdapterFailureAlert({ orderId, pharmacySlug, integrationTier: tier, errorCode: 'pharmacy_rejected' })
    ).catch(slackErr =>
      console.error('[routing-engine] Slack pharmacy-rejected alert failed:', slackErr)
    )

    console.warn(`[routing-engine] pharmacy rejected | order=${orderId} | tier=${tier}`)
    // BLK-02: return 'reroute_pending', not 'accepted'
    return { outcome: 'reroute_pending', ...withSubmission, tier }
  }

  // ── Primary tier exhausted — increment circuit breaker ─────
  const cascadeReason = cascadeReasonFor(tier)

  // BLK-04: when the adapter threw before creating a submission, fall back to orderId
  // to ensure the circuit breaker always gets incremented on hard failures.
  await recordCircuitFailure({
    pharmacyId,
    submissionId: primarySubmissionId ?? orderId,
    orderId,
    pharmacySlug,
    tier,
    existingRow:  cbRow,   // NB-06: reuse row already fetched by resolveCircuitBreakerState
  }).catch(err =>
    console.error('[routing-engine] circuit failure record error:', err)
  )

  // ── REQ-ARE-002: Cascade to Tier 4 fax ─────────────────────
  // HC-13: This is a fallback safety net — pharmacies.integration_tier is NOT changed.
  // The fax is sent while the order is still SUBMISSION_PENDING, so a failed
  // fax can still go to SUBMISSION_FAILED (FAX_QUEUED cannot).
  console.warn(
    `[routing-engine] primary exhausted, cascading to fax | order=${orderId} | reason=${cascadeReason}`
  )

  let faxResult: Awaited<ReturnType<typeof submitTier4Fax>>
  try {
    faxResult = await submitTier4Fax(orderId)
  } catch (faxErr) {
    const faxMsg = faxErr instanceof Error ? faxErr.message : String(faxErr)
    console.error(`[routing-engine] cascade fax failed | order=${orderId}:`, faxMsg)

    // REQ-ARE-004: both primary AND Tier 4 exhausted → SUBMISSION_FAILED
    await failSubmission({
      orderId,
      pharmacySlug,
      tier,
      reason:  `${cascadeReason}; cascade fax failed`,
      error:   faxMsg,
      ...withSubmission,
    })
    return { outcome: 'submission_failed', ...withSubmission, tier, cascadeReason }
  }

  await markFaxQueued({
    orderId,
    pharmacySlug,
    metadata: {
      cascade_reason:        cascadeReason,
      original_tier:         tier,
      primary_submission_id: primarySubmissionId,
      submission_id:         faxResult.submissionId,
    },
  })

  console.info(
    `[routing-engine] cascade fax accepted | order=${orderId} | fax_submission=${faxResult.submissionId}`
  )
  return { outcome: 'cascaded_to_fax', submissionId: faxResult.submissionId, tier, cascadeReason }
}

// ============================================================
// OPS FAX (force_fax / retry_fax)
// ============================================================

export interface SubmitQueuedFaxResult {
  /** not_licensed: C5, the pharmacy cannot lawfully fill it; moved to FAX_FAILED, nothing sent. */
  outcome:       'accepted' | 'fax_failed' | 'not_claimed' | 'submissions_disabled' | 'not_licensed'
  submissionId?: string
}

/**
 * Sends the fax for an order that ops has already claimed into FAX_QUEUED
 * (force_fax from SUBMISSION_FAILED / FAX_FAILED, retry_fax from
 * FAX_FAILED). The claim CAS is the caller's; this only re-checks that the
 * order is still FAX_QUEUED before sending.
 *
 * A send that fails moves the order to FAX_FAILED (FAX_QUEUED has no legal
 * way to SUBMISSION_FAILED) and alerts, so ops can retry it again.
 */
export async function submitQueuedFax(params: {
  orderId:    string
  pharmacyId: string
}): Promise<SubmitQueuedFaxResult> {
  const { orderId, pharmacyId } = params

  if (!pharmacySubmissionsEnabled()) {
    console.info(`[routing-engine] pharmacy submissions are turned off | ops fax for order=${orderId} not sent`)
    return { outcome: 'submissions_disabled' }
  }

  const supabase = createServiceClient()

  const { data: order, error } = await supabase
    .from('orders')
    .select('order_id, status')
    .eq('order_id', orderId)
    .maybeSingle()

  // A failed read does not stop the send: the caller has just claimed the
  // order into FAX_QUEUED, so the re-check is only a guard against a stale call.
  if (error) {
    console.error(`[routing-engine] ops fax: order ${orderId} could not be re-read; sending on the caller's claim:`, error.message)
  } else if (!order || order.status !== 'FAX_QUEUED') {
    console.info(
      `[routing-engine] ops fax skipped | order=${orderId} | status=${order?.status ?? 'not_found'}`
    )
    return { outcome: 'not_claimed' }
  }

  // C5: the same licensure rule as routeOrder, before the fax goes out.
  const faxPharmacy = await loadPharmacy(pharmacyId)
  const licensure = faxPharmacy
    ? await checkOrderLicensure(supabase, {
        orderId, pharmacyId, pharmacyName: faxPharmacy.name, facilityType: normalizeFacilityType(faxPharmacy.facility_type),
      })
    : { ok: false as const, problem: 'no_license' as const, message: 'The pharmacy is not active.' }
  if (!licensure.ok) {
    console.warn(`[routing-engine] ops fax not sent: not licensed | order=${orderId} | pharmacy=${pharmacyId} | problem=${licensure.problem}`)
    await casTransition({
      orderId,
      expectedStatus: 'FAX_QUEUED',
      newStatus:      'FAX_FAILED',
      actor:          'routing_engine',
      metadata:       { reason: 'pharmacy_not_licensed', error: licensure.message },
    }).catch(casErr =>
      console.error('[routing-engine] CAS FAX_FAILED (not licensed) error:', casErr)
    )
    await sendSlackAlert(
      buildAdapterFailureAlert({
        orderId,
        pharmacySlug:    faxPharmacy?.slug ?? pharmacyId,
        integrationTier: 'TIER_4_FAX',
        errorCode:       'pharmacy_not_licensed',
      })
    ).catch(slackErr =>
      console.error('[routing-engine] Slack not-licensed alert failed:', slackErr)
    )
    return { outcome: 'not_licensed' }
  }

  await upsertFaxDeliverySla(orderId)

  try {
    const result = await submitTier4Fax(orderId)
    console.info(`[routing-engine] ops fax sent | order=${orderId} | submission=${result.submissionId}`)
    return { outcome: 'accepted', submissionId: result.submissionId }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[routing-engine] ops fax failed | order=${orderId}:`, msg)

    await casTransition({
      orderId,
      expectedStatus: 'FAX_QUEUED',
      newStatus:      'FAX_FAILED',
      actor:          'routing_engine',
      metadata:       { reason: 'ops_fax_send_failed', error: msg },
    }).catch(casErr =>
      console.error('[routing-engine] CAS FAX_FAILED (ops fax) error:', casErr)
    )

    const pharmacy = await loadPharmacy(pharmacyId).catch(() => null)
    await sendSlackAlert(
      buildAdapterFailureAlert({
        orderId,
        pharmacySlug:    pharmacy?.slug ?? pharmacyId,
        integrationTier: 'TIER_4_FAX',
        errorCode:       'fax_send_failed',
      })
    ).catch(slackErr =>
      console.error('[routing-engine] Slack ops-fax alert failed:', slackErr)
    )
    return { outcome: 'fax_failed' }
  }
}
