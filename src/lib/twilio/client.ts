import twilio from 'twilio'
import { serverEnv } from '@/lib/env'

// Twilio Programmable Messaging — server-only.
// Auth: TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN
//
// Message types (maps to sms_templates.template_name):
//   payment_link | reminder_24h | reminder_48h |
//   shipping_notification | delivered | custom
//
// HIPAA: Message bodies must never contain medication names, diagnoses,
// or clinical data — only order reference numbers and payment links.
export function createTwilioClient() {
  return twilio(serverEnv.twilioAccountSid(), serverEnv.twilioAuthToken())
}

// Validate X-Twilio-Signature on inbound webhook requests.
// Call this in the /api/webhooks/twilio route handler before processing.
export function validateTwilioWebhook(
  signature: string,
  url: string,
  params: Record<string, string>
): boolean {
  return twilio.validateRequest(
    serverEnv.twilioWebhookSecret(),
    signature,
    url,
    params
  )
}
