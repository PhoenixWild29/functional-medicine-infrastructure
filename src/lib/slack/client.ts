import { serverEnv } from '@/lib/env'

// Slack Incoming Webhook client — fetch-based (no SDK).
// Usage: Ops alerting for SLA breaches, adapter failures, DLQ entries, disputes.
//
// PHI Boundary — ONLY these fields are permitted in Slack messages:
//   - order_id (UUID)
//   - order status (enum value)
//   - integration tier (TIER_1_API | TIER_2_PORTAL | TIER_3_HYBRID | TIER_4_FAX)
//   - pharmacy name / slug
//   - error codes and technical details
//
// NEVER include: patient names, medication names, phone numbers, addresses,
// NPI numbers, clinical data, Stripe payment details, or any PHI.

export interface SlackAlertPayload {
  text: string
  blocks?: SlackBlock[]
}

export interface SlackBlock {
  type: 'section' | 'divider' | 'header'
  text?: { type: 'mrkdwn' | 'plain_text'; text: string }
  fields?: Array<{ type: 'mrkdwn' | 'plain_text'; text: string }>
}

export async function sendSlackAlert(payload: SlackAlertPayload): Promise<void> {
  const webhookUrl = serverEnv.slackWebhookUrl()

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000), // 10s timeout for Slack
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Slack alert failed: ${response.status} ${body}`)
  }
}

// Pre-built alert constructors — enforce PHI boundary at call site

export function buildSlaBreachAlert(params: {
  orderId: string
  slaType: string
  pharmacySlug: string
  escalationTier: number
}): SlackAlertPayload {
  return {
    text: `SLA Breach — Order ${params.orderId}`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '⚠️ SLA Breach Detected' },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Order ID:*\n${params.orderId}` },
          { type: 'mrkdwn', text: `*SLA Type:*\n${params.slaType}` },
          { type: 'mrkdwn', text: `*Pharmacy:*\n${params.pharmacySlug}` },
          { type: 'mrkdwn', text: `*Escalation Tier:*\n${params.escalationTier}` },
        ],
      },
    ],
  }
}

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
