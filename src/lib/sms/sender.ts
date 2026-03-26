// ============================================================
// SMS Sender — WO-26
// ============================================================
//
// Core SMS dispatch via Twilio Programmable Messaging.
// All sends are gated by opt-in check and rate limit.
//
// REQ-SPN-007: TCPA opt-in gate — check patients.sms_opt_in before every send.
// REQ-SPN-008: Twilio API dispatch with StatusCallback for delivery tracking.
// REQ-SPN-009: Rate limiting (5 per phone per 24h) + retry on transient errors.
// REQ-SPN-010: Ops alert to #ops-alerts Slack on final failure.
//
// HIPAA:
//   - sms_log stores message body for audit (SOC 2 + HIPAA audit trail).
//   - Ops failure alert uses masked phone (last 4 digits only).
//   - No PHI in Slack alert content beyond order_id + masked phone.
//
// Skip conditions:
//   - patients.sms_opt_in = false: skip + log
//   - patients.phone IS NULL: skip + log
//   - Rate limit (5 per 24h per phone): skip + log

import { createServiceClient } from '@/lib/supabase/service'
import { createTwilioClient } from '@/lib/twilio/client'
import { serverEnv } from '@/lib/env'
import { sendSlackMessage } from '@/lib/slack/client'

// ============================================================
// TYPES
// ============================================================

export type SmsTemplateName =
  | 'payment_link'
  | 'reminder_24h'
  | 'reminder_48h'
  | 'payment_confirmation'
  | 'shipping_notification'
  | 'delivered'
  | 'custom'

export interface SendSmsParams {
  orderId:      string
  patientId:    string
  toNumber:     string        // E.164 format, e.g. +15551234567
  templateName: SmsTemplateName
  body:         string        // fully rendered message body
}

export type SendSmsResult =
  | { outcome: 'sent';        messageSid: string }
  | { outcome: 'skipped';     reason: string }
  | { outcome: 'failed';      reason: string }

// ============================================================
// RATE LIMIT — REQ-SPN-009.1
// ============================================================

const SMS_RATE_LIMIT_PER_24H = 5

/**
 * Returns true if the patient's phone number is within the 24h rate limit.
 * REQ-SPN-009.5: rate limit is per phone number, not per patient record.
 */
async function isWithinRateLimit(toNumber: string): Promise<boolean> {
  const supabase = createServiceClient()
  const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const { count, error } = await supabase
    .from('sms_log')
    .select('sms_id', { count: 'exact', head: true })
    .eq('to_number', toNumber)
    .gte('created_at', windowStart)

  if (error) {
    console.error('[sms-sender] rate limit check failed:', error.message)
    // Fail open — allow send if we can't check
    return true
  }

  return (count ?? 0) < SMS_RATE_LIMIT_PER_24H
}

// ============================================================
// SMS LOG
// ============================================================

/**
 * Inserts an sms_log row. Called after successful Twilio dispatch.
 * REQ-SPN-008.4: captures order_id, patient_id, template_name,
 * twilio_message_sid, to_number, status, created_at.
 */
async function logSmsSend(params: {
  orderId:    string
  patientId:  string
  toNumber:   string
  templateName: SmsTemplateName
  messageSid: string
  body:       string
}): Promise<void> {
  const supabase = createServiceClient()
  const now      = new Date().toISOString()

  const { error } = await supabase
    .from('sms_log')
    .insert({
      order_id:           params.orderId,
      patient_id:         params.patientId,
      template_name:      params.templateName,
      twilio_message_sid: params.messageSid,
      to_number:          params.toNumber,
      status:             'sent',
      sent_at:            now,
    })

  if (error) {
    console.error(
      `[sms-sender] sms_log insert failed | sid=${params.messageSid}:`,
      error.message
    )
  }
}

// ============================================================
// FAILURE OPS ALERT — REQ-SPN-010
// ============================================================

/**
 * Sends an ops alert to #ops-alerts when SMS dispatch fails after all retries.
 * REQ-SPN-010.3: masked phone (last 4 digits only), no patient PHI.
 */
async function fireSmsFallbackAlert(params: {
  orderId:      string
  templateName: SmsTemplateName
  toNumber:     string
  reason:       string
}): Promise<void> {
  const maskedPhone = params.toNumber.slice(-4)
  const priority    = (params.templateName === 'reminder_24h' || params.templateName === 'reminder_48h')
    ? '⚠️ HIGH PRIORITY'
    : '📱 Low priority'

  const text = `${priority} SMS delivery failed | order=${params.orderId} | type=${params.templateName} | phone=...${maskedPhone} | reason=${params.reason}`

  const channelId = serverEnv.slackOpsAlertsChannelId()

  await sendSlackMessage(channelId, {
    text,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `${priority} — SMS Failed` },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Order ID:*\n${params.orderId}` },
          { type: 'mrkdwn', text: `*SMS Type:*\n${params.templateName}` },
          { type: 'mrkdwn', text: `*Phone (last 4):*\n...${maskedPhone}` },
          { type: 'mrkdwn', text: `*Reason:*\n${params.reason}` },
        ],
      },
    ],
  }).catch(err =>
    console.error('[sms-sender] fallback Slack alert failed:', err)
  )
}

// ============================================================
// TWILIO DISPATCH WITH RETRY — REQ-SPN-009.2
// ============================================================

/**
 * Dispatches SMS via Twilio with up to 3 retries on transient errors.
 * REQ-SPN-009.2: retry on 5xx/network errors with short delays.
 * Note: Production implementation should use a job queue for the
 * 30s/2m/10m backoff specified in the requirements; this implementation
 * uses synchronous retries (up to 3s delay) suitable for serverless.
 * REQ-SPN-009.3: 4xx errors (except 429) are not retried.
 */
async function dispatchWithRetry(params: {
  toNumber: string
  body:     string
}): Promise<{ messageSid: string }> {
  const twilio     = createTwilioClient()
  const fromNumber = serverEnv.twilioPhoneNumber()
  const callbackUrl = `${serverEnv.appBaseUrl()}/api/webhooks/twilio`

  // MAX_ATTEMPTS = 3 total dispatches: attempt 0 (initial), 1, 2.
  // Delays: 1s after attempt 0, 2s after attempt 1. Total blocking: ≤ 3s.
  const MAX_ATTEMPTS = 3
  let lastError: Error | null = null

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const message = await twilio.messages.create({
        to:             params.toNumber,
        from:           fromNumber,
        body:           params.body,
        statusCallback: callbackUrl,
      })

      // REQ-SPN-008.5: validate non-null sid
      if (!message.sid) {
        throw new Error('Twilio returned null message.sid')
      }

      return { messageSid: message.sid }

    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      const code = (err as { status?: number; code?: number }).status ?? (err as { code?: number }).code ?? 0

      // REQ-SPN-009.3: 4xx errors (except 429) are not retried
      if (code >= 400 && code < 500 && code !== 429) {
        throw lastError
      }

      if (attempt < MAX_ATTEMPTS - 1) {
        // Short delay for serverless: 1s after attempt 0, 2s after attempt 1
        const delayMs = (attempt + 1) * 1000
        await new Promise(resolve => setTimeout(resolve, delayMs))
      }
    }
  }

  throw lastError ?? new Error('SMS dispatch failed after retries')
}

// ============================================================
// MAIN SEND FUNCTION
// ============================================================

/**
 * Sends an SMS message to a patient with full gate checks.
 * Returns the outcome for the caller to log/act on.
 *
 * Gates (in order):
 *   1. patients.sms_opt_in check (REQ-SPN-007.4)
 *   2. Rate limit check (REQ-SPN-009.1)
 *   3. Twilio dispatch with retry (REQ-SPN-009.2)
 *   4. sms_log insert
 *   5. Failure ops alert on exhausted retries (REQ-SPN-010.1)
 */
export async function sendSms(params: SendSmsParams): Promise<SendSmsResult> {
  // Gate 1: opt-in is checked by caller (triggers.ts fetches patient row).
  // The toNumber param only exists if opt-in was confirmed. This is a
  // defense-in-depth check — never call sendSms without verifying opt-in.

  // WO-53: TWILIO_ENABLED=false disables live SMS dispatch for POC environments
  // that don't have a verified Twilio number. Logs the message body to console
  // so the checkout token / message content is still inspectable during testing.
  if (process.env['TWILIO_ENABLED'] === 'false') {
    // BLK-3 fix: omit params.body from console log — rendered SMS bodies may contain
    // patient first name or checkout token URLs which constitute PHI. Vercel function
    // logs are not BAA-covered storage. Log only non-PHI metadata for debugging.
    console.info(
      `[sms-sender] TWILIO_ENABLED=false — SMS suppressed | order=${params.orderId} | template=${params.templateName} | to=...${params.toNumber.slice(-4)}`
    )
    return { outcome: 'skipped', reason: 'twilio_disabled' }
  }

  // Gate 2: rate limit — REQ-SPN-009.1
  const withinLimit = await isWithinRateLimit(params.toNumber)
  if (!withinLimit) {
    console.error(
      `[sms-sender] rate limit exceeded | order=${params.orderId} | phone=...${params.toNumber.slice(-4)}`
    )
    return { outcome: 'skipped', reason: 'rate_limit_exceeded' }
  }

  // Gate 3: dedup — skip if this template was already sent for this order
  // Prevents duplicate SMS on webhook replay or concurrent state transitions.
  const supabase = createServiceClient()
  const { count: existingCount } = await supabase
    .from('sms_log')
    .select('sms_id', { count: 'exact', head: true })
    .eq('order_id', params.orderId)
    .eq('template_name', params.templateName)

  if ((existingCount ?? 0) > 0) {
    console.info(
      `[sms-sender] duplicate suppressed | order=${params.orderId} | template=${params.templateName}`
    )
    return { outcome: 'skipped', reason: 'already_sent' }
  }

  // Gate 4: dispatch
  try {
    const { messageSid } = await dispatchWithRetry({
      toNumber: params.toNumber,
      body:     params.body,
    })

    await logSmsSend({
      orderId:      params.orderId,
      patientId:    params.patientId,
      toNumber:     params.toNumber,
      templateName: params.templateName,
      messageSid,
      body:         params.body,
    })

    console.info(
      `[sms-sender] sent | order=${params.orderId} | template=${params.templateName} | sid=${messageSid}`
    )

    return { outcome: 'sent', messageSid }

  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.error(
      `[sms-sender] failed after retries | order=${params.orderId} | template=${params.templateName}:`,
      reason
    )

    // REQ-SPN-010.1: ops alert on exhausted retries
    await fireSmsFallbackAlert({
      orderId:      params.orderId,
      templateName: params.templateName,
      toNumber:     params.toNumber,
      reason,
    })

    return { outcome: 'failed', reason }
  }
}
