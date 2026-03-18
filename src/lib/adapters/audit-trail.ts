// ============================================================
// Adapter Audit Trail Service — WO-46
// ============================================================
//
// Provides the canonical append-only audit trail for all adapter
// submission attempts. Every tier implementation (WO-19 Tier 1,
// WO-20 Tier 2, WO-21 Tier 3, WO-22 Tier 4) calls these functions
// instead of writing to adapter_submissions directly.
//
// Lifecycle (REQ-AAT-001):
//   createSubmissionRecord()  → INSERT with status = PENDING
//   markSubmitted()           → UPDATE status = SUBMITTED, set submitted_at
//   markAcknowledged()        → UPDATE status = ACKNOWLEDGED, set acknowledged_at + external_reference_id
//   markFailed()              → UPDATE status = FAILED
//   markRejected()            → UPDATE status = REJECTED
//   markSubmissionFailed()    → UPDATE status = SUBMISSION_FAILED (all retries + cascade exhausted)
//   markCancelled()           → UPDATE status = CANCELLED (ops action)
//   markPortalError()         → UPDATE status = PORTAL_ERROR (Tier 2 Playwright failure)
//   markManualReview()        → UPDATE status = MANUAL_REVIEW (Tier 2 low confidence)
//
// Append-only invariant (REQ-AAT-005):
//   Each retry creates a NEW row via createSubmissionRecord() with
//   incremented attempt_number. Existing rows are never deleted.
//   The only mutations are status progression updates on the same row.
//
// HIPAA:
//   request_payload and response_payload are stored JSONB.
//   Callers must scrub any patient PHI before passing payloads.
//   The pharmacy API payloads (medication name, quantity, etc.) are
//   clinical — store them encrypted or omit from payload fields if
//   HIPAA policy requires. For now we store them in JSONB and rely
//   on Supabase row-level security (service_role only) for access control.

import { createServiceClient } from '@/lib/supabase/service'

// ============================================================
// TYPES
// ============================================================

export type AdapterSubmissionStatus =
  | 'PENDING'
  | 'SUBMITTED'
  | 'CONFIRMED'
  | 'ACKNOWLEDGED'
  | 'REJECTED'
  | 'FAILED'
  | 'SUBMISSION_FAILED'
  | 'TIMEOUT'
  | 'TIMED_OUT'
  | 'PORTAL_ERROR'
  | 'MANUAL_REVIEW'
  | 'CANCELLED'

export type IntegrationTier =
  | 'TIER_1_API'
  | 'TIER_2_PORTAL'
  | 'TIER_3_SPEC'
  | 'TIER_3_HYBRID'
  | 'TIER_4_FAX'

export interface CreateSubmissionParams {
  orderId: string
  pharmacyId: string
  tier: IntegrationTier
  attemptNumber: number
  metadata?: Record<string, unknown>   // cascade_reason, ops_override, etc.
}

export interface SubmissionRecord {
  submissionId: string
  orderId: string
  pharmacyId: string
  tier: IntegrationTier
  attemptNumber: number
  status: AdapterSubmissionStatus
}

// ============================================================
// CREATE — insert PENDING row before dispatching to pharmacy
// ============================================================
// Called at the START of every submission attempt, before the HTTP
// request / browser session / fax send is initiated.
// Returns the new submission_id used for all subsequent updates.

export async function createSubmissionRecord(
  params: CreateSubmissionParams
): Promise<string> {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('adapter_submissions')
    .insert({
      order_id:       params.orderId,
      pharmacy_id:    params.pharmacyId,
      tier:           params.tier,
      status:         'PENDING',
      attempt_number: params.attemptNumber,
      metadata:       params.metadata ?? null,
    })
    .select('submission_id')
    .single()

  if (error || !data) {
    throw new Error(
      `[audit-trail] createSubmissionRecord failed for order ${params.orderId}: ${error?.message ?? 'no data returned'}`
    )
  }

  return data.submission_id
}

// ============================================================
// SUBMITTED — request sent to pharmacy, awaiting response
// ============================================================
// Called immediately after the HTTP POST / form submit / fax send
// is dispatched. Sets submitted_at for latency calculation.

export async function markSubmitted(
  submissionId: string,
  requestPayload?: Record<string, unknown>
): Promise<void> {
  const supabase = createServiceClient()

  const { error } = await supabase
    .from('adapter_submissions')
    .update({
      status:          'SUBMITTED',
      submitted_at:    new Date().toISOString(),
      request_payload: requestPayload ?? null,
    })
    .eq('submission_id', submissionId)

  if (error) {
    console.error(
      `[audit-trail] markSubmitted failed for submission ${submissionId}:`,
      error.message
    )
  }
}

// ============================================================
// ACKNOWLEDGED — pharmacy confirmed receipt of order
// ============================================================
// Called when pharmacy returns a success response (sync) or fires
// an order.confirmed webhook (async). Sets acknowledged_at for SLA.

export async function markAcknowledged(
  submissionId: string,
  externalReferenceId: string,
  responsePayload?: Record<string, unknown>
): Promise<void> {
  const supabase = createServiceClient()

  const { error } = await supabase
    .from('adapter_submissions')
    .update({
      status:                'ACKNOWLEDGED',
      acknowledged_at:       new Date().toISOString(),
      external_reference_id: externalReferenceId,
      response_payload:      responsePayload ?? null,
    })
    .eq('submission_id', submissionId)

  if (error) {
    console.error(
      `[audit-trail] markAcknowledged failed for submission ${submissionId}:`,
      error.message
    )
  }
}

// ============================================================
// FAILED — transient failure, eligible for retry
// ============================================================
// Called when the pharmacy API returns an error or the HTTP request
// times out, but retries are still available.

export async function markFailed(
  submissionId: string,
  errorCode: string,
  errorMessage: string,
  responsePayload?: Record<string, unknown>
): Promise<void> {
  const supabase = createServiceClient()

  const { error } = await supabase
    .from('adapter_submissions')
    .update({
      status:           'FAILED',
      error_code:       errorCode,
      error_message:    errorMessage,
      response_payload: responsePayload ?? null,
      completed_at:     new Date().toISOString(),
    })
    .eq('submission_id', submissionId)

  if (error) {
    console.error(
      `[audit-trail] markFailed failed for submission ${submissionId}:`,
      error.message
    )
  }
}

// ============================================================
// REJECTED — pharmacy explicitly rejected the order
// ============================================================
// Called when the pharmacy API returns a rejection code (not a
// transient error). No retry — this is a terminal state.

export async function markRejected(
  submissionId: string,
  errorCode: string,
  errorMessage: string,
  responsePayload?: Record<string, unknown>
): Promise<void> {
  const supabase = createServiceClient()

  const { error } = await supabase
    .from('adapter_submissions')
    .update({
      status:           'REJECTED',
      error_code:       errorCode,
      error_message:    errorMessage,
      response_payload: responsePayload ?? null,
      completed_at:     new Date().toISOString(),
    })
    .eq('submission_id', submissionId)

  if (error) {
    console.error(
      `[audit-trail] markRejected failed for submission ${submissionId}:`,
      error.message
    )
  }
}

// ============================================================
// SUBMISSION_FAILED — terminal: all tiers + cascade exhausted
// ============================================================
// Called by the routing engine (WO-23) after both the primary tier
// and the Tier 4 fax cascade have failed all retry attempts.

export async function markSubmissionFailed(
  submissionId: string,
  errorCode: string,
  errorMessage: string,
  metadata?: Record<string, unknown>   // includes cascade_reason
): Promise<void> {
  const supabase = createServiceClient()

  const { error } = await supabase
    .from('adapter_submissions')
    .update({
      status:        'SUBMISSION_FAILED',
      error_code:    errorCode,
      error_message: errorMessage,
      completed_at:  new Date().toISOString(),
      ...(metadata ? { metadata } : {}),
    })
    .eq('submission_id', submissionId)

  if (error) {
    console.error(
      `[audit-trail] markSubmissionFailed failed for submission ${submissionId}:`,
      error.message
    )
  }
}

// ============================================================
// CANCELLED — ops-initiated cancellation
// ============================================================

export async function markCancelled(
  submissionId: string,
  reason: string
): Promise<void> {
  const supabase = createServiceClient()

  const { error } = await supabase
    .from('adapter_submissions')
    .update({
      status:        'CANCELLED',
      error_code:    'ops_cancelled',
      error_message: reason,
      completed_at:  new Date().toISOString(),
    })
    .eq('submission_id', submissionId)

  if (error) {
    console.error(
      `[audit-trail] markCancelled failed for submission ${submissionId}:`,
      error.message
    )
  }
}

// ============================================================
// PORTAL_ERROR — Tier 2 Playwright automation failure
// ============================================================

export async function markPortalError(
  submissionId: string,
  errorCode: string,
  errorMessage: string,
  screenshotUrl?: string
): Promise<void> {
  const supabase = createServiceClient()

  const { error } = await supabase
    .from('adapter_submissions')
    .update({
      status:         'PORTAL_ERROR',
      error_code:     errorCode,
      error_message:  errorMessage,
      screenshot_url: screenshotUrl ?? null,
      completed_at:   new Date().toISOString(),
    })
    .eq('submission_id', submissionId)

  if (error) {
    console.error(
      `[audit-trail] markPortalError failed for submission ${submissionId}:`,
      error.message
    )
  }
}

// ============================================================
// MANUAL_REVIEW — Tier 2 AI confidence below threshold
// ============================================================
// Called when AI vision returns confidence < 0.85. Ops must
// manually verify the submission before it advances.

export async function markManualReview(
  submissionId: string,
  aiConfidenceScore: number,
  screenshotUrl: string
): Promise<void> {
  const supabase = createServiceClient()

  const { error } = await supabase
    .from('adapter_submissions')
    .update({
      status:              'MANUAL_REVIEW',
      ai_confidence_score: aiConfidenceScore,
      screenshot_url:      screenshotUrl,
    })
    .eq('submission_id', submissionId)

  if (error) {
    console.error(
      `[audit-trail] markManualReview failed for submission ${submissionId}:`,
      error.message
    )
  }
}

// ============================================================
// HELPERS
// ============================================================

// Compute latency in milliseconds between submitted_at and acknowledged_at.
// Returns null if either timestamp is missing.
export function computeSubmissionLatencyMs(
  submittedAt: string | null,
  acknowledgedAt: string | null
): number | null {
  if (!submittedAt || !acknowledgedAt) return null
  return new Date(acknowledgedAt).getTime() - new Date(submittedAt).getTime()
}

// Fetch a submission record by ID (for routing engine status checks).
export async function getSubmission(submissionId: string): Promise<{
  submission_id: string
  order_id: string
  pharmacy_id: string
  tier: IntegrationTier
  status: AdapterSubmissionStatus
  attempt_number: number
  submitted_at: string | null
  acknowledged_at: string | null
  external_reference_id: string | null
  error_code: string | null
  metadata: Record<string, unknown> | null
} | null> {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('adapter_submissions')
    .select(
      'submission_id, order_id, pharmacy_id, tier, status, attempt_number, submitted_at, acknowledged_at, external_reference_id, error_code, metadata'
    )
    .eq('submission_id', submissionId)
    .single()

  if (error || !data) return null
  return data as ReturnType<typeof getSubmission> extends Promise<infer T> ? NonNullable<T> : never
}
