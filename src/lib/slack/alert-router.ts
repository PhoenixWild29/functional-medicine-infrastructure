// ============================================================
// SLA Alert Router — WO-25
// ============================================================
//
// Routes SLA breach alerts to the correct channel based on escalation tier:
//   Tier 1 → Slack #ops-alerts channel (SLACK_OPS_ALERTS_CHANNEL_ID)
//   Tier 2 → Slack DM to on-call ops lead (SLACK_OPS_MANAGER_USER_ID)
//            Paused if SLA is already acknowledged (REQ-SAI-005.3)
//   Tier 3 → PagerDuty Events API v2 (PAGERDUTY_ROUTING_KEY)
//            NOT paused by acknowledgment (REQ-SAI-005.4)
//
// REQ-SAI-001: Channel routing per escalation tier
// REQ-SAI-002: Standard V2.0 template fields
// REQ-SAI-003: SLA-type-specific template selection
// REQ-SAI-007: PHI boundary — template selection based on sla_type only
// REQ-SAI-009: Deduplication via escalation_tier field (enforced upstream
//   in escalateSla CAS guard — alert router trusts the caller)
//
// Notifications log: records sent channel to prevent re-fire duplicate
// (used by sla-refire cron — REQ-SAI-009.2 / REQ-SAI-006.4).

import { createServiceClient } from '@/lib/supabase/service'
import { serverEnv } from '@/lib/env'
import {
  sendSlackMessage,
  buildSlaBreachAlert,
  buildAdapterSubmissionAckAlert,
  buildPharmacyCompoundingAckAlert,
  buildPharmacyAckFaxAlert,
  buildSubmissionFailedAlert,   // BLK-07: needed for SUBMISSION_FAILED routing
  buildReFireAlert,
  type SlaBreachTemplateParams,
  type SlackAlertPayload,
} from '@/lib/slack/client'
import { triggerSlaEscalation } from '@/lib/pagerduty/client'

// ============================================================
// TYPES
// ============================================================

export interface RouteSlaAlertParams {
  orderId:          string
  slaType:          string
  deadlineAt:       string
  orderStatus:      string
  pharmacySlug:     string
  integrationTier:  string
  escalationTier:   number      // the NEW tier after escalation
  acknowledgedAt:   string | null
  cascadeStatus?:   string
  cascadeHistory?:  string      // for SUBMISSION_FAILED alerts
}

// Channel values for notifications log
type NotificationChannel = 'slack_channel' | 'slack_dm' | 'pagerduty' | 'slack_refire'

// ============================================================
// NOTIFICATIONS LOG — dedup and audit trail
// ============================================================

async function logNotification(
  orderId:  string,
  slaType:  string,
  tier:     number,
  channel:  NotificationChannel
): Promise<boolean> {
  const supabase = createServiceClient()

  const { error } = await supabase
    .from('sla_notifications_log')
    .insert({
      order_id:        orderId,
      sla_type:        slaType,
      escalation_tier: tier,
      channel,
    })

  // Unique constraint violation = already logged = duplicate — skip
  if (error) {
    if (error.code === '23505') return false   // duplicate, skip send
    console.error('[alert-router] notifications log insert failed:', error.message)
  }

  return !error
}

// ============================================================
// TEMPLATE SELECTOR — REQ-SAI-003
// ============================================================

function selectTemplate(params: RouteSlaAlertParams): SlackAlertPayload {
  const base: SlaBreachTemplateParams = {
    orderId:         params.orderId,
    slaType:         params.slaType,
    deadlineAt:      params.deadlineAt,
    orderStatus:     params.orderStatus,
    pharmacySlug:    params.pharmacySlug,
    integrationTier: params.integrationTier,
    escalationTier:  params.escalationTier,
  }

  switch (params.slaType) {
    case 'ADAPTER_SUBMISSION_ACK':
      return buildAdapterSubmissionAckAlert({ ...base, ...(params.cascadeStatus !== undefined ? { cascadeStatus: params.cascadeStatus } : {}) })

    case 'PHARMACY_COMPOUNDING_ACK':
      return buildPharmacyCompoundingAckAlert(base)

    case 'PHARMACY_ACKNOWLEDGE':
      return buildPharmacyAckFaxAlert(base)

    case 'SUBMISSION_FAILED':
      // BLK-07: SUBMISSION_FAILED uses its own four-button critical template
      return buildSubmissionFailedAlert({
        orderId:        params.orderId,
        pharmacySlug:   params.pharmacySlug,
        cascadeHistory: params.cascadeHistory ?? 'All submission tiers exhausted',
      })

    default:
      return buildSlaBreachAlert(base)
  }
}

// ============================================================
// BREACH DURATION HELPER
// ============================================================

function breachDurationMinutes(deadlineAt: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(deadlineAt).getTime()) / 60000))
}

// ============================================================
// MAIN ROUTER — REQ-SAI-001
// ============================================================

/**
 * Routes an SLA breach alert to the correct channel for the given escalation tier.
 * Called from the sla-check cron after a successful escalateSla() CAS.
 */
export async function routeSlaAlert(params: RouteSlaAlertParams): Promise<void> {
  const { orderId, slaType, escalationTier } = params

  // BLK-07: SUBMISSION_FAILED is a critical alert that always goes to #ops-alerts,
  // regardless of escalation tier. It is not tier-gated the same way as standard SLAs.
  // REQ-SAI-003.4: four-button layout: [Reroute] [Manual Fax] [Refund] [View Order].
  if (slaType === 'SUBMISSION_FAILED') {
    const payload   = selectTemplate(params)
    const channelId = serverEnv.slackOpsAlertsChannelId()

    try {
      await sendSlackMessage(channelId, payload)
      // REQ-SAI-009.3: log with current tier to deduplicate per-tier
      await logNotification(orderId, slaType, escalationTier, 'slack_channel')
    } catch (err) {
      console.error(`[alert-router] SUBMISSION_FAILED alert failed | order=${orderId}:`, err)
    }
    return
  }

  switch (escalationTier) {

    // ── Tier 1: #ops-alerts channel ──────────────────────────
    case 1: {
      const payload   = selectTemplate(params)
      const channelId = serverEnv.slackOpsAlertsChannelId()

      // BLK-05 fix: send first, then log. If send fails, log is not inserted
      // so the next cron run will retry. .catch swallows the error after logging.
      try {
        await sendSlackMessage(channelId, payload)
        await logNotification(orderId, slaType, 1, 'slack_channel')
      } catch (err) {
        console.error(`[alert-router] Tier 1 Slack send failed | order=${orderId}:`, err)
      }
      break
    }

    // ── Tier 2: DM to on-call ops lead ───────────────────────
    // REQ-SAI-005.3: skip DM if SLA already acknowledged
    case 2: {
      if (params.acknowledgedAt !== null) {
        console.info(
          `[alert-router] Tier 2 suppressed — SLA acknowledged | order=${orderId} | sla=${slaType}`
        )
        return
      }

      const payload = selectTemplate(params)
      let   targetId = ''
      // NB-04 fix: track whether we are sending to a DM or fallback channel
      let   channel: NotificationChannel = 'slack_dm'

      try {
        targetId = serverEnv.slackOpsManagerUserId()
      } catch {
        // SLACK_OPS_MANAGER_USER_ID not set — fall back to #ops-alerts (AC-SAI-001.2)
        console.warn('[alert-router] SLACK_OPS_MANAGER_USER_ID not set — falling back to #ops-alerts')
        targetId = serverEnv.slackOpsAlertsChannelId()
        channel  = 'slack_channel'
      }

      // BLK-05 fix: send first, log on success
      try {
        await sendSlackMessage(targetId, payload)
        await logNotification(orderId, slaType, 2, channel)
      } catch (err) {
        console.error(`[alert-router] Tier 2 DM failed | order=${orderId}:`, err)
      }
      break
    }

    // ── Tier 3: PagerDuty — NOT paused by acknowledgment ─────
    // REQ-SAI-005.4: Tier 3 fires regardless of acknowledged_at
    case 3: {
      // BLK-05 fix: send first, log on success
      try {
        await triggerSlaEscalation({
          orderId,
          slaType,
          escalationTier,
          pharmacySlug:          params.pharmacySlug,
          integrationTier:       params.integrationTier,
          ...(params.cascadeStatus !== undefined ? { cascadeStatus: params.cascadeStatus } : {}),
          breachDurationMinutes: breachDurationMinutes(params.deadlineAt),
        })
        await logNotification(orderId, slaType, 3, 'pagerduty')
      } catch (err) {
        console.error(`[alert-router] PagerDuty trigger failed | order=${orderId}:`, err)
      }
      break
    }

    default:
      console.warn(`[alert-router] unexpected escalationTier=${escalationTier} | order=${orderId}`)
  }
}

// ============================================================
// RE-FIRE ROUTER — REQ-SAI-006
// ============================================================

/**
 * Sends the 15-minute re-fire alert for an unacknowledged Tier 1 breach.
 * Fires to #ops-alerts (re-fire) + DM to ops manager.
 * One-shot: uses 'slack_refire' channel in notifications log.
 *
 * BLK-06 fix: returns `true` if the re-fire was sent, `false` if skipped.
 * Callers use the return value to correctly increment fired vs skipped counters.
 *
 * BLK-05 fix: sends first, logs on success.
 */
export async function routeReFireAlert(params: RouteSlaAlertParams): Promise<boolean> {
  const { orderId, slaType } = params

  const base: SlaBreachTemplateParams = {
    orderId:         params.orderId,
    slaType:         params.slaType,
    deadlineAt:      params.deadlineAt,
    orderStatus:     params.orderStatus,
    pharmacySlug:    params.pharmacySlug,
    integrationTier: params.integrationTier,
    escalationTier:  1,
  }

  const reFirePayload = buildReFireAlert(base)
  const channelId     = serverEnv.slackOpsAlertsChannelId()

  // REQ-SAI-006.1: Re-send to #ops-alerts with unacknowledged note.
  // BLK-05 fix: send first, log after. If send fails, log is not inserted
  // and the next cron run will retry.
  try {
    await sendSlackMessage(channelId, reFirePayload)
  } catch (err) {
    console.error(`[alert-router] re-fire channel send failed | order=${orderId}:`, err)
    return false
  }

  // REQ-SAI-006.4: One-shot guard — log after successful send.
  // If this insert fails (duplicate), another run already sent the re-fire.
  const logged = await logNotification(orderId, slaType, 1, 'slack_refire')
  if (!logged) {
    console.info(`[alert-router] re-fire already sent by concurrent run | order=${orderId}`)
    // Channel message was already sent but log says it was a duplicate — acceptable
    // race condition; at most two re-fires can be sent in concurrent cron overlap.
    return false
  }

  // REQ-SAI-006.2: DM to ops manager
  let managerId = ''
  try {
    managerId = serverEnv.slackOpsManagerUserId()
  } catch {
    console.warn('[alert-router] SLACK_OPS_MANAGER_USER_ID not set — skipping manager DM for re-fire')
    return true   // channel send succeeded; DM skipped due to missing config
  }

  await sendSlackMessage(managerId, reFirePayload).catch(err =>
    console.error(`[alert-router] re-fire manager DM failed | order=${orderId}:`, err)
  )

  return true
}
