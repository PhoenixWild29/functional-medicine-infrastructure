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


// ============================================================
// SHARED BLOCK KIT TYPES
// ============================================================

export interface SlackAlertPayload {
  text: string
  blocks?: SlackBlock[]
}

export interface SlackBlock {
  type: 'section' | 'divider' | 'header' | 'actions'
  text?: { type: 'mrkdwn' | 'plain_text'; text: string }
  fields?: Array<{ type: 'mrkdwn' | 'plain_text'; text: string }>
  elements?: SlackActionElement[]
}

export interface SlackActionElement {
  type: 'button'
  text: { type: 'plain_text'; text: string; emoji?: boolean }
  action_id: string
  value: string
  style?: 'primary' | 'danger'
  url?: string
}

// ============================================================
// SEND — INCOMING WEBHOOK (legacy)
// ============================================================

export async function sendSlackAlert(payload: SlackAlertPayload): Promise<void> {
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
  payload:         SlackAlertPayload
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

/**
 * Dashboard deep-link URL for an order (auth-gated).
 * BLK-03 fix: Slack button `url` field requires an absolute HTTPS URL.
 * APP_BASE_URL env var provides the base (e.g. https://app.compoundiq.com).
 */
function orderUrl(orderId: string): string {
  const base = serverEnv.appBaseUrl().replace(/\/$/, '')
  return `${base}/dashboard/orders/${orderId}`
}

/** Overdue duration string from deadline timestamp. */
function overdueLabel(deadlineAt: string): string {
  const diffMs = Date.now() - new Date(deadlineAt).getTime()
  const mins   = Math.max(0, Math.round(diffMs / 60000))
  if (mins < 60) return `${mins} min`
  const hrs = Math.floor(mins / 60)
  const rem = mins % 60
  return rem > 0 ? `${hrs}h ${rem}min` : `${hrs}h`
}

/** Standard two-button action block: [Acknowledge] [View Order]. */
function standardActions(orderId: string): SlackBlock {
  return {
    type: 'actions',
    elements: [
      {
        type:      'button',
        text:      { type: 'plain_text', text: 'Acknowledge', emoji: true },
        action_id: 'sla_acknowledge',
        value:     orderId,
        style:     'primary',
      },
      {
        type:      'button',
        text:      { type: 'plain_text', text: 'View Order', emoji: true },
        action_id: 'view_order',
        value:     orderId,
        url:       orderUrl(orderId),
      },
    ],
  }
}

// ============================================================
// TEMPLATE PARAMS — PHI boundary enforced at type level
// ============================================================

/** Common params for all SLA breach templates. PHI fields excluded by type design. */
export interface SlaBreachTemplateParams {
  orderId:          string
  slaType:          string
  deadlineAt:       string    // ISO string — used to compute overdue duration
  orderStatus:      string
  pharmacySlug:     string
  integrationTier:  string
  escalationTier:   number
}

/** Extended params for adapter-submission SLA types (V2.0 fields). */
export interface AdapterSlaTemplateParams extends SlaBreachTemplateParams {
  cascadeStatus?: string   // e.g. "Tier 1 failed → Cascading to Tier 4 (fax)"
}

/** Params for SUBMISSION_FAILED critical alert. */
export interface SubmissionFailedTemplateParams {
  orderId:       string
  pharmacySlug:  string
  cascadeHistory: string   // e.g. "Tier 1 (API timeout) → Tier 4 (fax queue full) → ALL TIERS EXHAUSTED"
}

// ============================================================
// TEMPLATE BUILDERS — REQ-SAI-002, REQ-SAI-003
// ============================================================

/**
 * Generic SLA breach template. Used for: PHARMACY_CONFIRMATION, SHIPPING,
 * PAYMENT, STATUS_UPDATE, REROUTE_RESOLUTION, FAX_DELIVERY, PHARMACY_ACKNOWLEDGE.
 *
 * REQ-SAI-002: Standard fields + action buttons [Acknowledge] [View Order].
 */
export function buildSlaBreachAlert(params: SlaBreachTemplateParams): SlackAlertPayload {
  const overdue = overdueLabel(params.deadlineAt)
  const fallback = `SLA Breach: ${params.slaType} — Order ${params.orderId} — overdue by ${overdue}`

  return {
    text: fallback,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `⚠️ SLA Breach: ${params.slaType}` },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Order ID:*\n<${orderUrl(params.orderId)}|${params.orderId}>` },
          { type: 'mrkdwn', text: `*Overdue By:*\n${overdue}` },
          { type: 'mrkdwn', text: `*Order Status:*\n${params.orderStatus}` },
          { type: 'mrkdwn', text: `*Pharmacy:*\n${params.pharmacySlug}` },
          { type: 'mrkdwn', text: `*Integration Tier:*\n${params.integrationTier}` },
          { type: 'mrkdwn', text: `*Escalation Tier:*\n${params.escalationTier}` },
        ],
      },
      { type: 'divider' },
      standardActions(params.orderId),
    ],
  }
}

/**
 * ADAPTER_SUBMISSION_ACK breach template (REQ-SAI-003.2).
 * Includes V2.0 Cascade Status field.
 * Action: Auto-cascade in progress — monitor for resolution.
 */
export function buildAdapterSubmissionAckAlert(
  params: AdapterSlaTemplateParams
): SlackAlertPayload {
  const overdue  = overdueLabel(params.deadlineAt)
  const cascade  = params.cascadeStatus ?? 'N/A'
  const fallback = `SLA Breach: ADAPTER_SUBMISSION_ACK — Order ${params.orderId} — overdue by ${overdue}`

  return {
    text: fallback,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '⚠️ SLA Breach: ADAPTER_SUBMISSION_ACK' },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Order ID:*\n<${orderUrl(params.orderId)}|${params.orderId}>` },
          { type: 'mrkdwn', text: `*Overdue By:*\n${overdue}` },
          { type: 'mrkdwn', text: `*Order Status:*\n${params.orderStatus}` },
          { type: 'mrkdwn', text: `*Pharmacy:*\n${params.pharmacySlug}` },
          { type: 'mrkdwn', text: `*Integration Tier:*\n${params.integrationTier}` },
          { type: 'mrkdwn', text: `*Cascade Status:*\n${cascade}` },
        ],
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: '> Auto-cascade in progress. Monitor for resolution.' },
      },
      { type: 'divider' },
      standardActions(params.orderId),
    ],
  }
}

/**
 * PHARMACY_COMPOUNDING_ACK breach template (REQ-SAI-003.3).
 * Action: Contact pharmacy to confirm compounding has begun.
 */
export function buildPharmacyCompoundingAckAlert(
  params: SlaBreachTemplateParams
): SlackAlertPayload {
  const overdue  = overdueLabel(params.deadlineAt)
  const fallback = `SLA Breach: PHARMACY_COMPOUNDING_ACK — Order ${params.orderId} — overdue by ${overdue}`

  return {
    text: fallback,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '⚠️ SLA Breach: PHARMACY_COMPOUNDING_ACK' },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Order ID:*\n<${orderUrl(params.orderId)}|${params.orderId}>` },
          { type: 'mrkdwn', text: `*Overdue By:*\n${overdue}` },
          { type: 'mrkdwn', text: `*Order Status:*\n${params.orderStatus}` },
          { type: 'mrkdwn', text: `*Pharmacy:*\n${params.pharmacySlug}` },
          { type: 'mrkdwn', text: `*Integration Tier:*\n${params.integrationTier}` },
          { type: 'mrkdwn', text: `*Escalation Tier:*\n${params.escalationTier}` },
        ],
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: '> Contact pharmacy to confirm compounding has begun.' },
      },
      { type: 'divider' },
      standardActions(params.orderId),
    ],
  }
}

/**
 * PHARMACY_ACKNOWLEDGE (Tier 4 fax) breach template (REQ-SAI-003.1).
 * Action: Call pharmacy to confirm receipt.
 */
export function buildPharmacyAckFaxAlert(
  params: SlaBreachTemplateParams
): SlackAlertPayload {
  const overdue  = overdueLabel(params.deadlineAt)
  const fallback = `SLA Breach: PHARMACY_ACKNOWLEDGE — Order ${params.orderId} — overdue by ${overdue}`

  return {
    text: fallback,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '⚠️ SLA Breach: PHARMACY_ACKNOWLEDGE (Tier 4)' },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Order ID:*\n<${orderUrl(params.orderId)}|${params.orderId}>` },
          { type: 'mrkdwn', text: `*Overdue By:*\n${overdue}` },
          { type: 'mrkdwn', text: `*Order Status:*\n${params.orderStatus}` },
          { type: 'mrkdwn', text: `*Pharmacy:*\n${params.pharmacySlug}` },
          { type: 'mrkdwn', text: `*Integration Tier:*\nTier 4 — Fax` },
          { type: 'mrkdwn', text: `*Escalation Tier:*\n${params.escalationTier}` },
        ],
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: '> Call pharmacy to confirm receipt of fax.' },
      },
      { type: 'divider' },
      standardActions(params.orderId),
    ],
  }
}

/**
 * SUBMISSION_FAILED CRITICAL template (REQ-SAI-003.4).
 * Four-button layout: [Reroute] [Manual Fax] [Refund] [View Order].
 */
export function buildSubmissionFailedAlert(
  params: SubmissionFailedTemplateParams
): SlackAlertPayload {
  const fallback = `CRITICAL: SUBMISSION_FAILED — Order ${params.orderId} — Manual intervention required`

  return {
    text: fallback,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '🔴 CRITICAL: SUBMISSION_FAILED' },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Order ID:*\n<${orderUrl(params.orderId)}|${params.orderId}>` },
          { type: 'mrkdwn', text: `*Pharmacy:*\n${params.pharmacySlug}` },
        ],
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Cascade History:*\n${params.cascadeHistory}`,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '> ⚠️ *Manual intervention required:* Reroute, manual fax, or refund.',
        },
      },
      { type: 'divider' },
      {
        type: 'actions',
        elements: [
          {
            type:      'button',
            text:      { type: 'plain_text', text: 'Reroute', emoji: true },
            action_id: 'order_reroute',
            value:     params.orderId,
            style:     'primary',
          },
          {
            type:      'button',
            text:      { type: 'plain_text', text: 'Manual Fax', emoji: true },
            action_id: 'manual_fax',
            value:     params.orderId,
          },
          {
            type:      'button',
            text:      { type: 'plain_text', text: 'Refund', emoji: true },
            action_id: 'order_refund',
            value:     params.orderId,
            style:     'danger',
          },
          {
            type:      'button',
            text:      { type: 'plain_text', text: 'View Order', emoji: true },
            action_id: 'view_order',
            value:     params.orderId,
            url:       orderUrl(params.orderId),
          },
        ],
      },
    ],
  }
}

/**
 * Re-fire alert appended to an existing Tier 1 message when unacknowledged
 * after 15 minutes. Sent to #ops-alerts (REQ-SAI-006.1).
 */
export function buildReFireAlert(params: SlaBreachTemplateParams): SlackAlertPayload {
  const overdue  = overdueLabel(params.deadlineAt)
  const fallback = `⚠ UNACKNOWLEDGED: SLA Breach ${params.slaType} — Order ${params.orderId} — overdue by ${overdue}`

  return {
    text: fallback,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '⚠️ UNACKNOWLEDGED — Re-firing Alert' },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `⚠ UNACKNOWLEDGED — Re-firing alert. Escalating to ops manager.\n*Order:* <${orderUrl(params.orderId)}|${params.orderId}> | *SLA:* ${params.slaType} | *Overdue:* ${overdue}`,
        },
      },
      { type: 'divider' },
      standardActions(params.orderId),
    ],
  }
}

// ============================================================
// LEGACY BUILDER — kept for backward compatibility
// ============================================================

export function buildAdapterFailureAlert(params: {
  orderId: string
  pharmacySlug: string
  integrationTier: string
  errorCode: string
}): SlackAlertPayload {
  return {
    text: `Adapter Failure — Order ${params.orderId}`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '🔴 Adapter Submission Failed' },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Order ID:*\n${params.orderId}` },
          { type: 'mrkdwn', text: `*Pharmacy:*\n${params.pharmacySlug}` },
          { type: 'mrkdwn', text: `*Tier:*\n${params.integrationTier}` },
          { type: 'mrkdwn', text: `*Error Code:*\n${params.errorCode}` },
        ],
      },
    ],
  }
}
