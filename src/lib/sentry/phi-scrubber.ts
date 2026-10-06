import type { Breadcrumb, ErrorEvent, EventHint } from '@sentry/nextjs'

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
  // HTTP auth/session headers — Bearer tokens and session cookies must never reach Sentry
  'Authorization', 'authorization', 'Cookie', 'cookie', 'set-cookie',
])

// Compliance C9: patient fields are redacted by KEY wherever they appear
// (extra, contexts, tags, breadcrumb data, stack-frame variables). A
// pattern cannot recognise a name or a street address; the key can.
// Keys are compared lowercased with '_' and '-' removed, so first_name,
// firstName and first-name all match. 'name' alone is NOT listed: SDK
// contexts use it for the OS, runtime and browser.
const PHI_KEYS = new Set([
  'firstname', 'lastname', 'fullname', 'middlename',
  'patientname', 'patientfirstname', 'patientlastname',
  'dateofbirth', 'dob', 'patientdateofbirth', 'birthdate',
  'email', 'patientemail', 'receiptemail', 'emailaddress',
  'phone', 'phonenumber', 'patientphone', 'mobile', 'tonumber', 'fromnumber',
  'address', 'addressline1', 'addressline2', 'patientaddressline1', 'patientaddressline2',
  'street', 'city', 'zip', 'zipcode', 'postalcode', 'patientcity', 'patientzip',
  'allergies', 'patientallergies',
  'sig', 'sigtext', 'diagnosiscode', 'diagnosistext', 'specialinstructions',
  'medicationname', 'ssn',
  // Raw bodies can carry any of the above.
  'body', 'requestbody', 'responsebody', 'rawbody', 'payload',
])

const normalizeKey = (key: string) => key.toLowerCase().replace(/[_-]/g, '')

function scrubObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(obj)) {
    if (ALWAYS_REDACT_KEYS.has(key) || PHI_KEYS.has(normalizeKey(key))) {
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

/** Drops the query string and fragment: they can carry search terms, names, emails. */
function stripQuery(url: string): string {
  return url.split('#')[0]!.split('?')[0]!
}

/**
 * Sentry beforeBreadcrumb (Compliance C9). Runs as each breadcrumb is
 * recorded, so PHI never sits in the SDK's buffer:
 *   - console: the logged arguments are dropped (the message is kept,
 *     scrubbed); a log line that printed a patient object never leaves;
 *   - fetch / xhr: request and response bodies dropped, URL query removed;
 *   - navigation: from / to query removed;
 *   - everything else: data scrubbed by key and pattern.
 */
export function phiBeforeBreadcrumb(crumb: Breadcrumb): Breadcrumb | null {
  const out: Breadcrumb = { ...crumb }
  if (out.message !== undefined) out.message = scrubString(out.message)
  if (out.data) {
    const data: Record<string, unknown> = { ...(out.data as Record<string, unknown>) }
    delete data['arguments']
    delete data['request_body']
    delete data['response_body']
    for (const k of ['url', 'from', 'to']) {
      if (typeof data[k] === 'string') data[k] = stripQuery(data[k] as string)
    }
    out.data = scrubObject(data) as typeof out.data
  }
  return out
}

export function phiBeforeSend(event: ErrorEvent, _hint: EventHint): ErrorEvent | null {
  // Scrub breadcrumbs (the same rules as beforeBreadcrumb, in case one was
  // recorded before the hook was installed).
  // NOTE: Event.breadcrumbs is Breadcrumb[] (a plain array in v8+),
  // not the v7 shape { values?: Breadcrumb[] }. Access directly, not via .values.
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs
      .map(phiBeforeBreadcrumb)
      .filter((crumb): crumb is Breadcrumb => crumb !== null)
  }

  if (event.message !== undefined) event.message = scrubString(event.message)
  if (event.logentry?.message !== undefined) {
    event.logentry = { ...event.logentry, message: scrubString(event.logentry.message) }
  }
  if (event.contexts) {
    event.contexts = scrubObject(event.contexts as Record<string, unknown>) as typeof event.contexts
  }
  if (event.tags) {
    event.tags = scrubObject(event.tags as Record<string, unknown>) as typeof event.tags
  }

  // Scrub exception values and stack frame variable snapshots
  if (event.exception?.values) {
    event.exception.values = event.exception.values.map((ex) => ({
      ...ex,
      ...(ex.value !== undefined ? { value: scrubString(ex.value) } : {}),
      ...(ex.stacktrace !== undefined ? {
        stacktrace: {
          ...ex.stacktrace,
          ...(ex.stacktrace.frames !== undefined ? {
            frames: ex.stacktrace.frames.map((frame) => ({
              ...frame,
              // Scrub local variable snapshots — may contain PHI if passed into Error constructors
              ...(frame.vars !== undefined ? {
                vars: scrubObject(frame.vars as Record<string, unknown>) as typeof frame.vars,
              } : {}),
            })),
          } : {}),
        },
      } : {}),
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
    // Never send request body or cookies — may contain PHI / session
    delete event.request.data
    delete event.request.cookies
  }

  // Scrub user context — retain only non-PHI operational fields.
  // Permitted: id (auth UUID), clinic_id (UUID), app_role (enum string).
  // Stripped: username, email, ip_address, and any other fields that may be PHI.
  if (event.user) {
    event.user = {
      id:        event.user.id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(( event.user as any).clinic_id  && { clinic_id:  (event.user as any).clinic_id  }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(( event.user as any).app_role   && { app_role:   (event.user as any).app_role   }),
    }
  }

  return event
}
