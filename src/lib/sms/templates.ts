// ============================================================
// SMS Template Renderer — WO-26
// ============================================================
//
// Renders sms_templates.body_template with {{variable}} substitution.
// All template functions enforce HIPAA at the type level:
//   - Only patient first name (never last name)
//   - No medication names, diagnoses, or prescription details
//   - No clinic name in payment texts (Compliance C1): a clinic name can
//     name a specialty ("Sunrise Weight Loss Clinic"). The payment link
//     and both reminders are written here, in code, so no stored
//     template can put it back; sms_templates keeps the same wording as
//     the reference copy (migration 20261006000001).
//
// REQ-SPN-006: HIPAA minimum necessary — first name only.
//
// Template variable syntax: {{variableName}}

// ============================================================
// TEMPLATE VARIABLE SETS — PHI boundary enforced by type
// ============================================================

/**
 * Variables for the payment texts (payment_link, reminder_24h,
 * reminder_48h). Deliberately no clinic name and nothing about the order.
 */
export interface PaymentReminderVars {
  patientFirstName: string   // first name only — no last name
  providerLastName: string   // REQ-SCL-002: "Dr. {providerLastName}" in the payment link
  checkoutUrl:      string   // tokenized JWT checkout URL (72h expiry)
}

/**
 * Variables for payment confirmation SMS — REQ-SPN-003.
 * First name only: no clinic, drug, amount or specialty (C7).
 */
export interface PaymentConfirmationVars {
  patientFirstName:  string
}

/** Variables for shipping notification SMS — REQ-SPN-004. */
export interface ShippingVars {
  patientFirstName: string
  trackingUrl:      string   // carrier native tracking URL
}

/** Variables for delivery confirmation SMS — REQ-SPN-005. */
export interface DeliveryVars {
  patientFirstName: string
}

// ============================================================
// TEMPLATE RENDERER
// ============================================================

/**
 * Substitutes {{variable}} placeholders in a template string.
 * Variables not present in `vars` are left as-is (logged as warning).
 */
export function renderTemplate(
  template: string,
  vars:     Record<string, string>
): string {
  const missing: string[] = []

  const rendered = template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    if (key in vars) return vars[key]!
    missing.push(key)
    return match
  })

  if (missing.length > 0) {
    // Throw rather than send a garbled SMS with literal {{placeholder}} text to the patient.
    throw new Error(`[sms-templates] unresolved placeholders in template: ${missing.join(', ')}`)
  }

  return rendered
}

// ============================================================
// TYPED RENDER FUNCTIONS — one per SMS type
// ============================================================

// Payment texts (Compliance C1): first name, the provider's last name,
// the link and how to stop. No clinic name, no drug, not even the word
// "prescription". Kept in step with sms_templates (the reference copy).
export const PAYMENT_LINK_SMS = 'Hi {{patientFirstName}}, Dr. {{providerLastName}} sent you a secure payment link: {{checkoutUrl}} Reply STOP to opt out.'
export const REMINDER_24H_SMS = 'Hi {{patientFirstName}}, a reminder that your secure payment link is still open: {{checkoutUrl}} Reply STOP to opt out.'
export const REMINDER_48H_SMS = 'Hi {{patientFirstName}}, your secure payment link expires soon: {{checkoutUrl}} Reply STOP to opt out.'

const paymentVars = (v: PaymentReminderVars): Record<string, string> => ({
  patientFirstName: v.patientFirstName,
  providerLastName: v.providerLastName,
  checkoutUrl:      v.checkoutUrl,
})

export function renderPaymentLinkSms(vars: PaymentReminderVars): string {
  return renderTemplate(PAYMENT_LINK_SMS, paymentVars(vars))
}

export function renderReminder24hSms(vars: PaymentReminderVars): string {
  return renderTemplate(REMINDER_24H_SMS, paymentVars(vars))
}

export function renderReminder48hSms(vars: PaymentReminderVars): string {
  return renderTemplate(REMINDER_48H_SMS, paymentVars(vars))
}

/**
 * REQ-SPN-003: Payment confirmation SMS, sent once per paid order or
 * bundle by the Stripe webhook (sendPaymentConfirmationSms).
 *
 * C7: first name and a neutral line only. No clinic name, drug, amount or
 * specialty, and not "prescription" or "pharmacy". The previous wording
 * ("...payment confirmed! Your prescription is on its way to the
 * pharmacy. {{tierAwareMessage}}") named a prescription; the
 * sms_templates.payment_confirmation row still holds it as a reference
 * only and is not read (this body is built in code).
 */
export function buildPaymentConfirmationBody(vars: PaymentConfirmationVars): string {
  return `Hi ${vars.patientFirstName}, your payment is confirmed. We'll text you again when your order ships.`
}

export function renderShippingNotificationSms(
  template: string,
  vars:     ShippingVars
): string {
  return renderTemplate(template, vars as unknown as Record<string, string>)
}

export function renderDeliveredSms(
  template: string,
  vars:     DeliveryVars
): string {
  return renderTemplate(template, vars as unknown as Record<string, string>)
}
