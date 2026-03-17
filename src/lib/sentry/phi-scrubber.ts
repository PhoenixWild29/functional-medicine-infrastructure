import type { Event, EventHint } from '@sentry/nextjs'

// PHI scrubbing patterns for Sentry beforeSend hook.
//
// MANDATORY HIPAA COMPLIANCE: These patterns must scrub ALL potential PHI
// before any event is sent to Sentry. Failure to scrub is a HIPAA violation.
//
// Never send to Sentry:
//   - Stripe metadata, descriptions, or charge objects (contain order/clinic data)
//   - Documo payloads (contain patient fax cover sheets)
//   - Twilio message bodies (contain payment links with patient phone numbers)
//   - Pharmacy API responses (may contain medication/patient data)
//   - Supabase Vault secret IDs (opaque UUIDs referencing credentials)

// Patterns that indicate PHI or secrets in string values
const PHI_PATTERNS: RegExp[] = [
  // US phone numbers (patient contact)
  /\b(\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  // NPI numbers (10-digit provider IDs)
  /\bnpi[_\s:=]?\d{10}\b/gi,
  // Medication names (common compounding prefixes/patterns)
  /\b(semaglutide|tirzepatide|testosterone|estradiol|progesterone|oxytocin|naltrexone|metformin|sermorelin|ipamorelin|bpc-157|tb-500)\b/gi,
  // Stripe API keys
  /\b(sk_live_|sk_test_|pk_live_|pk_test_|rk_live_)[a-zA-Z0-9]+\b/g,
  // Stripe webhook secrets
  /\bwhsec_[a-zA-Z0-9]+\b/g,
  // Stripe IDs that may correlate to patient data
  /\b(pi_|ch_|re_|tr_|cu_|pm_|in_)[a-zA-Z0-9]{14,}\b/g,
  // Generic API keys / tokens (long alphanumeric strings after key= patterns)
  /\b(api[_-]?key|auth[_-]?token|bearer)[^\s"']*\s*[=:]\s*["']?[a-zA-Z0-9\-_]{20,}["']?/gi,
  // Passwords in query strings or JSON
  /("password"|'password'|password=)[^\s,}"'&]*/gi,
  // Vault secret IDs (UUIDs stored in pharmacy configs)
  /\b(vault_secret_id|username_vault_id|password_vault_id)[^\s,}"']*\s*[=:]\s*["']?[0-9a-f-]{36}["']?/gi,
  // Email addresses (patient contact)
  /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g,
  // SSN patterns
  /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g,
  // Date of birth patterns (YYYY-MM-DD or MM/DD/YYYY)
  /\b(19|20)\d{2}[-/](0[1-9]|1[0-2])[-/](0[1-9]|[12]\d|3[01])\b/g,
]

const SCRUBBED = '[SCRUBBED]'

function scrubString(value: string): string {
  let result = value
  for (const pattern of PHI_PATTERNS) {
    result = result.replace(pattern, SCRUBBED)
  }
  return result
}

function scrubValue(value: unknown): unknown {
  if (typeof value === 'string') return scrubString(value)
  if (Array.isArray(value)) return value.map(scrubValue)
  if (value !== null && typeof value === 'object') return scrubObject(value as Record<string, unknown>)
  return value
}

// Keys that always get fully redacted regardless of value
const ALWAYS_REDACT_KEYS = new Set([
  'password', 'passwd', 'secret', 'token', 'api_key', 'apiKey',
  'auth_token', 'authToken', 'stripe_secret_key', 'service_role_key',
  'vault_secret_id', 'username_vault_id', 'password_vault_id',
  'webhook_secret_vault_id', 'SUPABASE_SERVICE_ROLE_KEY',
  'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
  'TWILIO_AUTH_TOKEN', 'TWILIO_WEBHOOK_SECRET',
  'DOCUMO_API_KEY', 'DOCUMO_WEBHOOK_SECRET',
  'PAGERDUTY_ROUTING_KEY', 'SLACK_WEBHOOK_URL',
  'JWT_SECRET',
])

function scrubObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(obj)) {
    if (ALWAYS_REDACT_KEYS.has(key)) {
      result[key] = SCRUBBED
    } else {
      result[key] = scrubValue(val)
    }
  }
  return result
}

// Top-level event key paths that contain Stripe/Documo/Twilio payloads — drop entirely
const DROPPED_EXTRA_KEYS = new Set([
  'stripeEvent', 'stripeMetadata', 'documoPayload',
  'twilioBody', 'pharmacyApiResponse', 'pharmacyWebhookPayload',
])

export function phiBeforeSend(event: Event, _hint: EventHint): Event | null {
  // Scrub breadcrumbs
  if (event.breadcrumbs?.values) {
    event.breadcrumbs.values = event.breadcrumbs.values.map((crumb) => ({
      ...crumb,
      message: crumb.message ? scrubString(crumb.message) : crumb.message,
      data: crumb.data ? (scrubObject(crumb.data as Record<string, unknown>) as typeof crumb.data) : crumb.data,
    }))
  }

  // Scrub exception values
  if (event.exception?.values) {
    event.exception.values = event.exception.values.map((ex) => ({
      ...ex,
      value: ex.value ? scrubString(ex.value) : ex.value,
    }))
  }

  // Scrub extra context — drop known PHI payload keys entirely
  if (event.extra) {
    const scrubbed: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(event.extra)) {
      if (DROPPED_EXTRA_KEYS.has(key)) continue
      scrubbed[key] = scrubValue(val)
    }
    event.extra = scrubbed
  }

  // Scrub request data (URL query params, headers, body)
  if (event.request) {
    if (event.request.url) event.request.url = scrubString(event.request.url)
    if (event.request.query_string) {
      event.request.query_string = typeof event.request.query_string === 'string'
        ? scrubString(event.request.query_string)
        : scrubObject(event.request.query_string as Record<string, unknown>) as typeof event.request.query_string
    }
    if (event.request.headers) {
      event.request.headers = scrubObject(event.request.headers as Record<string, unknown>) as typeof event.request.headers
    }
    // Never send request body — may contain PHI
    delete event.request.data
  }

  // Scrub user context — remove all identifying fields
  if (event.user) {
    event.user = {
      // Only retain non-PHI fields
      id: event.user.id,
    }
  }

  return event
}
