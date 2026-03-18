// ============================================================
// Twilio SMS Status Callback Handler — WO-16
// POST /api/webhooks/twilio
// ============================================================
//
// Handles SMS delivery status updates from Twilio:
//   queued, sent, delivered, undelivered, failed
//
// Pipeline:
//   1. Receive  — read raw body (application/x-www-form-urlencoded)
//   2. Authenticate — X-Twilio-Signature HMAC-SHA1 validation
//                     (full URL + sorted form params in HMAC)
//   3. Extract  — MessageSid (idempotency key), MessageStatus, ErrorCode
//   4. Update   — sms_log row with status + appropriate timestamp
//   5. Fallback — on undelivered/failed:
//                 (a) clinic_notifications row for MA in-app alert
//                 (b) check patient.email for email fallback intent
//                 (c) Slack ops alert
//   6. Respond  — HTTP 200 always (prevents Twilio retry storms)
//
// HIPAA Boundary:
//   sms_log stores order_id, template_name, MessageSid, status, error_code,
//   and timestamps — no message body or PHI content.
//   Patient email is checked for fallback eligibility but never logged.
//   Slack alert contains only order_id, template name, and error code.
//
// Note on persistent failure rate monitoring (REQ-TWH-006):
//   Per-event failure rate is not computable here; aggregate rate alerting
//   (>3% across 1,000 orders/month) is handled by the SLA cron (WO-17).
//
// Returns HTTP 403 for signature verification failures.
// All other outcomes return 200.

import { NextRequest, NextResponse } from 'next/server'
import { validateTwilioWebhook } from '@/lib/twilio/client'
import { createServiceClient } from '@/lib/supabase/service'
import { sendSlackAlert } from '@/lib/slack/client'
import type { SlackAlertPayload } from '@/lib/slack/client'

// ============================================================
// TYPES
// ============================================================

type TwilioMessageStatus = 'queued' | 'sent' | 'delivered' | 'undelivered' | 'failed'

// ============================================================
// ROUTE HANDLER
// ============================================================

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Step 1: Read raw body — Twilio sends application/x-www-form-urlencoded, NOT JSON
  const rawBody = await request.text()
  const signature = request.headers.get('x-twilio-signature') ?? ''

  // Step 2: Parse form params — required BEFORE signature validation
  // Twilio HMAC is computed over: URL + alphabetically sorted POST params
  const formParams: Record<string, string> = {}
  new URLSearchParams(rawBody).forEach((value, key) => {
    formParams[key] = value
  })

  // Validate X-Twilio-Signature using full request URL (includes any query params)
  const isValid = validateTwilioWebhook(signature, request.url, formParams)
  if (!isValid) {
    const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
    console.error(`[twilio-webhook] signature verification failed | ip=${ip}`)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
  }

  // Step 3: Extract key fields from the form payload
  const messageSid = formParams['MessageSid'] ?? ''
  const messageStatus = (formParams['MessageStatus'] ?? '') as TwilioMessageStatus
  const errorCode = formParams['ErrorCode'] ?? null
  const errorMessage = formParams['ErrorMessage'] ?? null

  if (!messageSid || !messageStatus) {
    // Unexpected payload shape — return 200 to stop Twilio retries
    console.error('[twilio-webhook] missing required fields MessageSid or MessageStatus')
    return NextResponse.json({ status: 'ok' }, { status: 200 })
  }

  const supabase = createServiceClient()

  // Step 4: Update sms_log — idempotent (UPDATE is safe to repeat)
  // Build timestamp fields per status
  const now = new Date().toISOString()
  const timestampUpdate: Partial<Record<string, string>> = {}

  if (messageStatus === 'sent') {
    timestampUpdate.sent_at = now
  } else if (messageStatus === 'delivered') {
    timestampUpdate.delivered_at = now
  } else if (messageStatus === 'undelivered' || messageStatus === 'failed') {
    timestampUpdate.failed_at = now
  }

  const { data: smsRow, error: updateError } = await supabase
    .from('sms_log')
    .update({
      status: messageStatus,
      ...(errorCode ? { error_code: errorCode } : {}),
      ...(errorMessage ? { error_message: errorMessage } : {}),
      ...timestampUpdate,
    })
    .eq('twilio_message_sid', messageSid)
    .select('sms_id, order_id, patient_id, template_name')
    .single()

  if (updateError || !smsRow) {
    // No matching row — message may have been sent outside this platform,
    // or sms_log insert hasn't been committed yet (race condition).
    // Return 200 — Twilio should not retry this event.
    console.warn(
      `[twilio-webhook] no sms_log row for MessageSid=${messageSid} status=${messageStatus}`
    )
    return NextResponse.json({ status: 'ok' }, { status: 200 })
  }

  console.info(
    `[twilio-webhook] ${messageStatus} | sid=${messageSid} | order=${smsRow.order_id ?? 'none'}${errorCode ? ` | error=${errorCode}` : ''}`
  )

  // Step 5: Fallback escalation for undelivered/failed (REQ-TWH-004)
  if (messageStatus === 'undelivered' || messageStatus === 'failed') {
    await handleSmsFailureFallback({
      orderId: smsRow.order_id,
      patientId: smsRow.patient_id,
      templateName: smsRow.template_name,
      messageSid,
      messageStatus,
      errorCode,
    })
  }

  // Step 6: Always 200 — prevents Twilio retry storms
  return NextResponse.json({ status: 'ok' }, { status: 200 })
}

// Return 405 for all non-POST methods
export function GET()    { return new NextResponse(null, { status: 405 }) }
export function PUT()    { return new NextResponse(null, { status: 405 }) }
export function PATCH()  { return new NextResponse(null, { status: 405 }) }
export function DELETE() { return new NextResponse(null, { status: 405 }) }

// ============================================================
// FALLBACK ESCALATION (REQ-TWH-004)
// ============================================================
// Two-path escalation when SMS delivery fails:
//   (a) Insert clinic_notifications row → MA sees in-app alert in Clinic App
//   (b) Check patient.email → log intent for email fallback (email service FRD 5)
//   (c) Slack ops alert for visibility

interface SmsFailureParams {
  orderId: string | null
  patientId: string | null
  templateName: string
  messageSid: string
  messageStatus: string
  errorCode: string | null
}

async function handleSmsFailureFallback(params: SmsFailureParams): Promise<void> {
  const { orderId, patientId, templateName, messageSid, messageStatus, errorCode } = params
  const supabase = createServiceClient()

  // (a) In-app MA alert — requires order to resolve clinic_id
  if (orderId) {
    const { data: order } = await supabase
      .from('orders')
      .select('clinic_id')
      .eq('order_id', orderId)
      .single()

    if (order?.clinic_id) {
      await supabase
        .from('clinic_notifications')
        .insert({
          clinic_id: order.clinic_id,
          order_id: orderId,
          notification_type: 'sms_failed',
          message: `SMS delivery ${messageStatus} for order ${orderId}. Template: ${templateName}. Error code: ${errorCode ?? 'N/A'}. Please contact patient directly to ensure they received their ${templateName === 'payment_link' ? 'payment link' : 'notification'}.`,
        })
        .catch(err =>
          console.error('[twilio-webhook] failed to insert clinic_notification:', err)
        )
    }
  }

  // (b) Email fallback — check patient.email for payment_link failures
  // Email delivery implementation is Out of Scope (FRD 5 email service integration).
  // Intent is logged here; email service will consume from clinic_notifications.
  if (patientId && templateName === 'payment_link') {
    const { data: patient } = await supabase
      .from('patients')
      .select('email')
      .eq('patient_id', patientId)
      .single()

    if (patient?.email) {
      // Patient has email on file — email fallback is eligible.
      // FRD 5 email service will process the clinic_notifications row above
      // and send the payment link via email.
      console.info(
        `[twilio-webhook] email fallback eligible | patient=${patientId} | order=${orderId}`
      )
    } else {
      console.info(
        `[twilio-webhook] no email on file for patient ${patientId} — no email fallback`
      )
    }
  }

  // (c) Slack ops alert
  if (orderId) {
    await sendSlackAlert(
      buildSmsFailureAlert({ orderId, templateName, messageStatus, errorCode, messageSid })
    ).catch(err =>
      console.error('[twilio-webhook] failed to send SMS failure Slack alert:', err)
    )
  }
}

// ============================================================
// SLACK ALERT BUILDER
// ============================================================

function buildSmsFailureAlert(params: {
  orderId: string
  templateName: string
  messageStatus: string
  errorCode: string | null
  messageSid: string
}): SlackAlertPayload {
  return {
    text: `SMS Delivery Failed — Order ${params.orderId}`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: 'SMS Delivery Failed' },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Order ID:*\n${params.orderId}` },
          { type: 'mrkdwn', text: `*Template:*\n${params.templateName}` },
          { type: 'mrkdwn', text: `*Status:*\n${params.messageStatus}` },
          { type: 'mrkdwn', text: `*Twilio Error:*\n${params.errorCode ?? 'none'}` },
        ],
      },
    ],
  }
}
