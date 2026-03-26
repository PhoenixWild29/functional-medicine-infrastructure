// ============================================================
// SMS Trigger Functions — WO-26
// ============================================================
//
// One exported function per SMS trigger event. Each function:
//   1. Fetches the order, patient, clinic, and pharmacy data
//   2. Checks patients.sms_opt_in (REQ-SPN-007.4)
//   3. Renders the template with non-PHI variables
//   4. Calls sendSms() which handles rate limiting, logging, and retry
//
// Trigger → caller mapping:
//   sendPaymentLinkSms()       ← Stripe webhook (AWAITING_PAYMENT)
//   sendReminder24hSms()       ← sla-check cron (SUBMISSION SLA breach)
//   sendReminder48hSms()       ← sla-check cron (STATUS_UPDATE SLA breach)
//   sendPaymentConfirmationSms()← Stripe webhook (PAID_PROCESSING)
//   sendShippingNotificationSms()← Shipping webhook (SHIPPED)
//   sendDeliveredSms()         ← Shipping webhook (DELIVERED)
//
// REQ-SPN-001 through REQ-SPN-005: Trigger logic per SLA type.
// REQ-SPN-006: HIPAA — patient first name only, no medication names.
// REQ-SPN-007: TCPA — sms_opt_in check before every send.
// REQ-SPN-010.4: SMS failures NEVER block order processing.

import { createServiceClient } from '@/lib/supabase/service'
import { generateCheckoutToken } from '@/lib/auth/checkout-token'
import { serverEnv } from '@/lib/env'
import { sendSms, type SendSmsResult } from '@/lib/sms/sender'
import {
  renderPaymentLinkSms,
  renderReminder24hSms,
  renderReminder48hSms,
  buildPaymentConfirmationBody,
  renderShippingNotificationSms,
  renderDeliveredSms,
  buildTierAwareClause,
} from '@/lib/sms/templates'

// ============================================================
// ORDER DATA FETCHER
// ============================================================

interface OrderSmsContext {
  patientId:              string
  patientFirstName:       string
  patientPhone:           string | null
  smsOptIn:               boolean
  clinicName:             string
  clinicId:               string
  providerLastName:       string   // REQ-SCL-002: for "Dr. {{providerLastName}}" in payment_link
  trackingUrl:            string | null
  supportsRealTimeStatus: boolean
}

/**
 * Fetches all data needed to send any SMS for an order.
 * Returns null if the order or patient doesn't exist.
 */
async function getOrderSmsContext(orderId: string): Promise<OrderSmsContext | null> {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('orders')
    .select(`
      tracking_url,
      patients!inner (
        patient_id,
        first_name,
        phone,
        sms_opt_in
      ),
      clinics!inner (
        clinic_id,
        name
      ),
      providers (
        last_name
      ),
      pharmacies (
        supports_real_time_status
      )
    `)
    .eq('order_id', orderId)
    .maybeSingle()

  if (error) {
    console.error(`[sms-triggers] failed to fetch order context | order=${orderId}:`, error.message)
    return null
  }

  if (!data) {
    console.warn(`[sms-triggers] order not found | order=${orderId}`)
    return null
  }

  const row       = data as unknown as Record<string, unknown>
  const patient   = row['patients']  as Record<string, unknown> | null
  const clinic    = row['clinics']   as Record<string, unknown> | null
  const provider  = row['providers'] as Record<string, unknown> | null
  const pharmacy  = row['pharmacies'] as Record<string, unknown> | null

  if (!patient || !clinic) {
    console.warn(`[sms-triggers] missing patient or clinic | order=${orderId}`)
    return null
  }

  return {
    patientId:              String(patient['patient_id']  ?? ''),
    patientFirstName:       String(patient['first_name']  ?? ''),
    patientPhone:           patient['phone'] != null ? String(patient['phone']) : null,
    smsOptIn:               Boolean(patient['sms_opt_in'] ?? false),
    clinicName:             String(clinic['name']          ?? ''),
    clinicId:               String(clinic['clinic_id']     ?? ''),
    providerLastName:       provider ? String(provider['last_name'] ?? '') : '',
    trackingUrl:            row['tracking_url'] != null ? String(row['tracking_url']) : null,
    supportsRealTimeStatus: Boolean(pharmacy?.['supports_real_time_status'] ?? false),
  }
}

// ============================================================
// TEMPLATE FETCHER
// ============================================================

async function getTemplateBody(templateName: string): Promise<string | null> {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('sms_templates')
    .select('body_template')
    .eq('template_name', templateName)
    .eq('is_active', true)
    .maybeSingle()

  if (error || !data) {
    console.error(`[sms-triggers] template not found: ${templateName}`, error?.message)
    return null
  }

  return (data as { body_template: string }).body_template
}

// ============================================================
// OPT-IN GATE HELPER
// ============================================================

/** Logs and returns a skipped result when opt-in gate blocks the send. */
function skipResult(reason: string): SendSmsResult {
  return { outcome: 'skipped', reason }
}

// ============================================================
// TRIGGER: PAYMENT LINK
// ============================================================

/**
 * Fires immediately on DRAFT → AWAITING_PAYMENT.
 * Generates a fresh 72h checkout JWT URL (or uses the provided one to avoid dual-token).
 *
 * REQ-SPN-001.2 / AC-SPN-001.4.
 * REQ-SCL-002: SMS format includes Dr. {{providerLastName}} per WO-47.
 *
 * @param preBuiltCheckoutUrl - If provided by sign-and-send, use this URL to avoid
 *   generating a second independent JWT with a different expiry.
 */
export async function sendPaymentLinkSms(
  orderId:            string,
  preBuiltCheckoutUrl?: string,
): Promise<SendSmsResult> {
  const ctx = await getOrderSmsContext(orderId)
  if (!ctx) return skipResult('order_not_found')
  if (!ctx.smsOptIn) return skipResult('sms_opt_out')
  if (!ctx.patientPhone) return skipResult('no_phone_number')

  // BLK-01: guard against empty provider name — renders "Dr. " in patient SMS
  if (!ctx.providerLastName.trim()) {
    console.error(`[sms-triggers] providerLastName empty | order=${orderId} — skipping payment_link SMS`)
    return skipResult('provider_last_name_missing')
  }

  const template = await getTemplateBody('payment_link')
  if (!template) return skipResult('template_not_found')

  // BLK-02: use pre-built URL when sign-and-send already generated a token,
  // preventing two independent JWTs with different expiry timestamps.
  const checkoutUrl = preBuiltCheckoutUrl
    ?? `${serverEnv.appBaseUrl().replace(/\/$/, '')}/checkout/${await generateCheckoutToken(orderId, ctx.patientId, ctx.clinicId)}`

  const body = renderPaymentLinkSms(template, {
    patientFirstName: ctx.patientFirstName,
    providerLastName: ctx.providerLastName,
    clinicName:       ctx.clinicName,
    checkoutUrl,
  })

  return sendSms({
    orderId,
    patientId:    ctx.patientId,
    toNumber:     ctx.patientPhone,
    templateName: 'payment_link',
    body,
  })
}

// ============================================================
// TRIGGER: 24H REMINDER
// ============================================================

/**
 * Fires when SUBMISSION SLA breaches (24h after AWAITING_PAYMENT).
 * REQ-SPN-001: Payment reminder with fresh checkout URL.
 *
 * NB-01: providerLastName is included to satisfy the PaymentReminderVars type contract.
 * The reminder_24h DB template currently does not contain {{providerLastName}};
 * the extra key is silently ignored by renderTemplate. If reminder templates are
 * updated to include the provider name, no code change is needed here.
 */
export async function sendReminder24hSms(orderId: string): Promise<SendSmsResult> {
  const ctx = await getOrderSmsContext(orderId)
  if (!ctx) return skipResult('order_not_found')
  if (!ctx.smsOptIn) return skipResult('sms_opt_out')
  if (!ctx.patientPhone) return skipResult('no_phone_number')

  const template = await getTemplateBody('reminder_24h')
  if (!template) return skipResult('template_not_found')

  const token       = await generateCheckoutToken(orderId, ctx.patientId, ctx.clinicId)
  const checkoutUrl = `${serverEnv.appBaseUrl().replace(/\/$/, '')}/checkout/${token}`

  const body = renderReminder24hSms(template, {
    patientFirstName: ctx.patientFirstName,
    providerLastName: ctx.providerLastName,
    clinicName:       ctx.clinicName,
    checkoutUrl,
  })

  return sendSms({
    orderId,
    patientId:    ctx.patientId,
    toNumber:     ctx.patientPhone,
    templateName: 'reminder_24h',
    body,
  })
}

// ============================================================
// TRIGGER: 48H REMINDER
// ============================================================

/**
 * Fires when STATUS_UPDATE SLA breaches (48h after AWAITING_PAYMENT).
 * REQ-SPN-002: Final cancellation warning with fresh checkout URL.
 *
 * NB-01: see sendReminder24hSms — providerLastName is passed for type contract;
 * the reminder_48h template does not currently use it.
 */
export async function sendReminder48hSms(orderId: string): Promise<SendSmsResult> {
  const ctx = await getOrderSmsContext(orderId)
  if (!ctx) return skipResult('order_not_found')
  if (!ctx.smsOptIn) return skipResult('sms_opt_out')
  if (!ctx.patientPhone) return skipResult('no_phone_number')

  const template = await getTemplateBody('reminder_48h')
  if (!template) return skipResult('template_not_found')

  const token       = await generateCheckoutToken(orderId, ctx.patientId, ctx.clinicId)
  const checkoutUrl = `${serverEnv.appBaseUrl().replace(/\/$/, '')}/checkout/${token}`

  const body = renderReminder48hSms(template, {
    patientFirstName: ctx.patientFirstName,
    providerLastName: ctx.providerLastName,
    clinicName:       ctx.clinicName,
    checkoutUrl,
  })

  return sendSms({
    orderId,
    patientId:    ctx.patientId,
    toNumber:     ctx.patientPhone,
    templateName: 'reminder_48h',
    body,
  })
}

// ============================================================
// TRIGGER: PAYMENT CONFIRMATION
// ============================================================

/**
 * Fires on AWAITING_PAYMENT → PAID_PROCESSING (Stripe webhook).
 * Tier-aware content: real-time status vs 3-7 business days.
 * REQ-SPN-003.
 */
export async function sendPaymentConfirmationSms(orderId: string): Promise<SendSmsResult> {
  const ctx = await getOrderSmsContext(orderId)
  if (!ctx) return skipResult('order_not_found')
  if (!ctx.smsOptIn) return skipResult('sms_opt_out')
  if (!ctx.patientPhone) return skipResult('no_phone_number')

  const tierAwareMessage = buildTierAwareClause(ctx.supportsRealTimeStatus)
  const body = buildPaymentConfirmationBody({
    patientFirstName: ctx.patientFirstName,
    tierAwareMessage,
  })

  return sendSms({
    orderId,
    patientId:    ctx.patientId,
    toNumber:     ctx.patientPhone,
    templateName: 'payment_confirmation',
    body,
  })
}

// ============================================================
// TRIGGER: SHIPPING NOTIFICATION
// ============================================================

/**
 * Fires on SHIPPED transition.
 * REQ-SPN-004: Includes carrier tracking URL.
 * AC-SPN-004.3: If no tracking URL, sends without it and alerts ops.
 */
export async function sendShippingNotificationSms(orderId: string): Promise<SendSmsResult> {
  const ctx = await getOrderSmsContext(orderId)
  if (!ctx) return skipResult('order_not_found')
  if (!ctx.smsOptIn) return skipResult('sms_opt_out')
  if (!ctx.patientPhone) return skipResult('no_phone_number')

  const template = await getTemplateBody('shipping_notification')
  if (!template) return skipResult('template_not_found')

  const trackingUrl = ctx.trackingUrl ?? ''

  // AC-SPN-004.3: if no tracking URL, send a modified message and alert ops
  if (!trackingUrl) {
    console.error(
      `[sms-triggers] no tracking URL for shipped order | order=${orderId} — sending without tracking link, ops alerted`
    )
  }

  const body = trackingUrl
    ? renderShippingNotificationSms(template, {
        patientFirstName: ctx.patientFirstName,
        trackingUrl,
      })
    : `Hi ${ctx.patientFirstName}, your order has shipped! Check your email for tracking details.`

  return sendSms({
    orderId,
    patientId:    ctx.patientId,
    toNumber:     ctx.patientPhone,
    templateName: 'shipping_notification',
    body,
  })
}

// ============================================================
// TRIGGER: DELIVERED
// ============================================================

/**
 * Fires on DELIVERED transition.
 * REQ-SPN-005: Delivery confirmation, no PHI.
 */
export async function sendDeliveredSms(orderId: string): Promise<SendSmsResult> {
  const ctx = await getOrderSmsContext(orderId)
  if (!ctx) return skipResult('order_not_found')
  if (!ctx.smsOptIn) return skipResult('sms_opt_out')
  if (!ctx.patientPhone) return skipResult('no_phone_number')

  const template = await getTemplateBody('delivered')
  if (!template) return skipResult('template_not_found')

  const body = renderDeliveredSms(template, {
    patientFirstName: ctx.patientFirstName,
  })

  return sendSms({
    orderId,
    patientId:    ctx.patientId,
    toNumber:     ctx.patientPhone,
    templateName: 'delivered',
    body,
  })
}
