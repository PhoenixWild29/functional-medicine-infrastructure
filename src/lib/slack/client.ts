// ============================================================
// Slack Client — WO-25 (extended from WO-24 stub)
// ============================================================
//
// Two sending mechanisms:
//   1. sendSlackAlert(payload)  — Incoming Webhook (legacy, one channel).
//      Used by non-SLA alerting (adapter failures, DLQ entries).
//   2. sendSlackMessage(channel, payload) — chat.postMessage bot token.
//      Used by WO-25 SLA breach alerts for channel + DM routing.
//
// PHI Boundary — ONLY these fields are permitted in Slack messages:
//   - order_id (UUID / internal reference)
//   - order status (enum value)
//   - integration tier (TIER_1_API | TIER_2_PORTAL | TIER_3_SPEC | TIER_4_FAX)
//   - pharmacy name / slug
//   - cascade status (non-PHI operational state)
//   - elapsed/overdue time metrics
//
// NEVER include: patient names, medication names, phone numbers, addresses,
// NPI numbers, clinical data, Stripe payment details, or any PHI.
//
// REQ-SAI-002: Standard template with V2.0 fields
// REQ-SAI-003: Four specific SLA type templates
// REQ-SAI-004: Block Kit structure — header → section(s) → divider → actions
// REQ-SAI-007: PHI boundary enforcement at template function signature level

import { serverEnv } from '@/lib/env'
import { buildOpsAlert, type SafeSlackPayload, type OpsAlertDetailValue, type OpsAlertDetailKey } from './ops-alert'

export { buildOpsAlert, opsOrderUrl, type SafeSlackPayload, type SlackAlertPayload, type SlackBlock, type SlackActionElement } from './ops-alert'


// ============================================================
// SHARED BLOCK KIT TYPES
// ============================================================

export async function sendSlackAlert(payload: SafeSlackPayload): Promise<void> {
  const webhookUrl = serverEnv.slackWebhookUrl()

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Slack alert failed: ${response.status} ${body}`)
  }
}

// ============================================================
// SEND — chat.postMessage (bot token, supports channel + DM)
// ============================================================

/**
 * Posts a Block Kit message to any Slack channel or user (DM).
 * `channelOrUserId` is either a channel ID (C...) or a user ID (U...).
 *
 * REQ-SAI-001: Tier 1 → channel ID, Tier 2 → user ID for DM.
 * REQ-SAI-004.5: fallback `text` is required for non-Block-Kit clients.
 */
export async function sendSlackMessage(
  channelOrUserId: string,
  payload:         SafeSlackPayload
): Promise<{ ts: string }> {
  const token = serverEnv.slackBotToken()

  const body = {
    channel: channelOrUserId,
    text:    payload.text,
    blocks:  payload.blocks,
  }

  const response = await fetch('https://slack.com/api/chat.postMessage', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  })

  if (!response.ok) {
    throw new Error(`Slack chat.postMessage HTTP error: ${response.status}`)
  }

  const result = await response.json() as { ok: boolean; error?: string; ts?: string }
  if (!result.ok) {
    throw new Error(`Slack chat.postMessage API error: ${result.error ?? 'unknown'}`)
  }

  return { ts: result.ts ?? '' }
}

// ============================================================
// BLOCK KIT HELPERS
// ============================================================

// ============================================================
// ALERT BUILDERS: every one goes through buildOpsAlert (./ops-alert)
// ============================================================
//
// The names are the ones callers already use. Each builder maps its
// parameters onto the allow-list; free text (a cascade history, an adapter
// error, a database error, a pharmacy rejection reason) is never sent. See
// ./ops-alert for the rule.

/** Whole minutes past a deadline. */
function overdueMinutes(deadlineAt: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(deadlineAt).getTime()) / 60000))
}

/** Common params for all SLA breach templates. PHI fields excluded by type design. */
export interface SlaBreachTemplateParams {
  orderId:          string
  slaType:          string
  deadlineAt:       string    // ISO string, used to compute overdue minutes
  orderStatus:      string
  pharmacySlug:     string
  integrationTier:  string
  escalationTier:   number
}

/** Extended params for adapter-submission SLA types (V2.0 fields). */
export interface AdapterSlaTemplateParams extends SlaBreachTemplateParams {
  /** Not sent (free text). Kept so callers need not change. */
  cascadeStatus?: string
}

/** Params for the SUBMISSION_FAILED critical alert. */
export interface SubmissionFailedTemplateParams {
  orderId:       string
  pharmacySlug:  string
  /** The tier that failed last, as a code (e.g. TIER_1_API). */
  failedTier?:   string | null
  /** The order could not be moved to SUBMISSION_FAILED. */
  statusNotSet?: boolean
}

function slaDetails(params: SlaBreachTemplateParams) {
  return {
    sla_type:         params.slaType,
    overdue_minutes:  overdueMinutes(params.deadlineAt),
    integration_tier: params.integrationTier,
    escalation_tier:  params.escalationTier,
  }
}

/**
 * Generic SLA breach template. Used for: PHARMACY_CONFIRMATION, SHIPPING,
 * PAYMENT, STATUS_UPDATE, REROUTE_RESOLUTION, FAX_DELIVERY, PHARMACY_ACKNOWLEDGE.
 * REQ-SAI-002: [Acknowledge] [Open in ops].
 */
export function buildSlaBreachAlert(params: SlaBreachTemplateParams): SafeSlackPayload {
  return buildOpsAlert({
    type: 'sla_breach', orderId: params.orderId, pharmacy: params.pharmacySlug, status: params.orderStatus,
    details: slaDetails(params), actions: 'sla',
  })
}

/** ADAPTER_SUBMISSION_ACK breach (REQ-SAI-003.2): auto-cascade in progress. */
export function buildAdapterSubmissionAckAlert(params: AdapterSlaTemplateParams): SafeSlackPayload {
  return buildOpsAlert({
    type: 'sla_breach', orderId: params.orderId, pharmacy: params.pharmacySlug, status: params.orderStatus,
    details: slaDetails(params), notes: ['auto_cascade'], actions: 'sla',
  })
}

/** PHARMACY_COMPOUNDING_ACK breach (REQ-SAI-003.3). */
export function buildPharmacyCompoundingAckAlert(params: SlaBreachTemplateParams): SafeSlackPayload {
  return buildOpsAlert({
    type: 'sla_breach', orderId: params.orderId, pharmacy: params.pharmacySlug, status: params.orderStatus,
    details: slaDetails(params), notes: ['confirm_compounding'], actions: 'sla',
  })
}

/** PHARMACY_ACKNOWLEDGE (Tier 4 fax) breach (REQ-SAI-003.1). */
export function buildPharmacyAckFaxAlert(params: SlaBreachTemplateParams): SafeSlackPayload {
  return buildOpsAlert({
    type: 'sla_breach', orderId: params.orderId, pharmacy: params.pharmacySlug, status: params.orderStatus,
    details: { ...slaDetails(params), integration_tier: 'TIER_4_FAX' }, notes: ['confirm_fax_receipt'], actions: 'sla',
  })
}

/** SUBMISSION_FAILED critical (REQ-SAI-003.4): [Reroute] [Manual Fax] [Refund] [Open in ops]. */
export function buildSubmissionFailedAlert(params: SubmissionFailedTemplateParams): SafeSlackPayload {
  return buildOpsAlert({
    type: 'submission_failed', orderId: params.orderId, pharmacy: params.pharmacySlug, status: 'SUBMISSION_FAILED',
    details: { failed_tier: params.failedTier ?? null },
    notes: ['manual_intervention', ...(params.statusNotSet ? ['status_not_set' as const] : []), 'free_text_withheld'],
    actions: 'submission_failed',
  })
}

/** Re-fire for an unacknowledged Tier 1 alert after 15 minutes (REQ-SAI-006.1). */
export function buildReFireAlert(params: SlaBreachTemplateParams): SafeSlackPayload {
  return buildOpsAlert({
    type: 'sla_unacknowledged', orderId: params.orderId, pharmacy: params.pharmacySlug, status: params.orderStatus,
    details: slaDetails(params), actions: 'sla',
  })
}

/**
 * AUDIT ROW NOT WRITTEN: order_status_history insert failed. The alert
 * carries what record_order_status_change() needs to rebuild the row by
 * hand: order, statuses, actor (a staff user id, ops email or system
 * name), source and time. The database error stays in the server log.
 */
export function buildStatusHistoryWriteFailedAlert(params: {
  orderId:   string
  oldStatus: string
  newStatus: string
  actor:     string
  source:    string
  failedAt:  string
  /** Logged by the caller, never sent to Slack. */
  error?:    string
}): SafeSlackPayload {
  return buildOpsAlert({
    type: 'status_history_write_failed', orderId: params.orderId, status: params.newStatus,
    details: { from_status: params.oldStatus, actor: params.actor, source: params.source, failed_at: params.failedAt },
  })
}

/** The only values the Slack "Code" field of an adapter-failure alert may carry. */
export const ADAPTER_ERROR_CODES = [
  'order_rejected',
  'pharmacy_rejected',
  'fax_send_failed',
  'circuit_breaker_opened',
  'fax_sent_status_not_updated',
  'pharmacy_not_licensed',
  'fax_permanently_failed',
  'stripe_dispute',
  'stripe_dispute_group',
  'stripe_transfer_failed',
] as const
export type AdapterErrorCode = typeof ADAPTER_ERROR_CODES[number]
const ADAPTER_ERROR_CODE_SET: ReadonlySet<string> = new Set(ADAPTER_ERROR_CODES)

/**
 * A pharmacy submission problem. `errorCode` is one of OUR fixed codes
 * (ADAPTER_ERROR_CODES); anything else, such as a pharmacy's rejection
 * code, is sent as "unknown". Never pass pharmacy text here. The code is
 * set last, so `details` cannot replace it.
 */
export function buildAdapterFailureAlert(params: {
  orderId:         string
  pharmacySlug:    string
  integrationTier: string
  errorCode:       AdapterErrorCode
  type?:           'adapter_failure' | 'pharmacy_rejected' | 'fax_failed' | 'stripe_dispute' | 'stripe_transfer_failed'
  status?:         string | null
  details?:        Partial<Record<Exclude<OpsAlertDetailKey, 'code'>, OpsAlertDetailValue>>
}): SafeSlackPayload {
  const code = ADAPTER_ERROR_CODE_SET.has(params.errorCode) ? params.errorCode : 'unknown'
  return buildOpsAlert({
    type: params.type ?? 'adapter_failure', orderId: params.orderId, pharmacy: params.pharmacySlug, status: params.status ?? null,
    details: { integration_tier: params.integrationTier, ...params.details, code },
  })
}
