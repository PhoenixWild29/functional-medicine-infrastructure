// ============================================================
// SMS Template Renderer — WO-26
// ============================================================
//
// Renders sms_templates.body_template with {{variable}} substitution.
// All template functions enforce HIPAA at the type level:
//   - Only patient first name (never last name)
//   - No medication names, diagnoses, or prescription details
//   - Clinic name permitted in payment reminders only
//
// REQ-SPN-006: HIPAA minimum necessary — first name only.
// REQ-SPN-003.3: Tier-aware content for payment confirmation.
//
// Template variable syntax: {{variableName}}

// ============================================================
// TEMPLATE VARIABLE SETS — PHI boundary enforced by type
// ============================================================

/** Variables for payment reminder templates (payment_link, reminder_24h, reminder_48h). */
export interface PaymentReminderVars {
  patientFirstName: string   // first name only — no last name
  providerLastName: string   // REQ-SCL-002: Dr. {{providerLastName}} in payment_link template
  clinicName:       string   // prescribing clinic name — non-PHI operational reference
  checkoutUrl:      string   // tokenized JWT checkout URL (72h expiry)
}

/** Variables for payment confirmation SMS — REQ-SPN-003. */
export interface PaymentConfirmationVars {
  patientFirstName:  string
  tierAwareMessage:  string  // tier-aware fulfillment status (no medication info)
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
// TIER-AWARE MESSAGE BUILDER — REQ-SPN-003.3
// ============================================================

/**
 * Returns the tier-aware fulfillment status clause appended to payment
 * confirmation SMS. No medication or clinical info permitted.
 *
 * REQ-SPN-003.3:
 *   Tier 1 / Tier 3 (supports_real_time_status = true):
 *     "You'll receive updates as your order progresses."
 *   Tier 4 (fax-only, no real-time status):
 *     "You will receive an SMS with tracking when it ships (typically 3-7 business days)."
 */
export function buildTierAwareClause(supportsRealTimeStatus: boolean): string {
  return supportsRealTimeStatus
    ? "You'll receive updates as your order progresses."
    : 'You will receive an SMS with tracking when it ships (typically 3-7 business days).'
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

export function renderPaymentLinkSms(
  template: string,
  vars:     PaymentReminderVars
): string {
  return renderTemplate(template, vars as unknown as Record<string, string>)
}

export function renderReminder24hSms(
  template: string,
  vars:     PaymentReminderVars
): string {
  return renderTemplate(template, vars as unknown as Record<string, string>)
}

export function renderReminder48hSms(
  template: string,
  vars:     PaymentReminderVars
): string {
  return renderTemplate(template, vars as unknown as Record<string, string>)
}

/**
 * REQ-SPN-003: Payment confirmation SMS.
 * Base content + tier-aware clause. Max ~160 chars.
 * HIPAA: no medication name in tierAwareMessage.
 */
export function buildPaymentConfirmationBody(vars: PaymentConfirmationVars): string {
  return `Hi ${vars.patientFirstName}, payment confirmed! Your prescription is on its way to the pharmacy. ${vars.tierAwareMessage}`
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
