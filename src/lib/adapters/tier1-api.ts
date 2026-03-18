// ============================================================
// Tier 1 Direct REST API Adapter — WO-19
// ============================================================
//
// Implements Sub-Feature 4a: Direct REST API integration with
// per-pharmacy configuration, Vault credential retrieval,
// payload transformation, 3-attempt exponential backoff retry,
// rate limiting, and append-only audit trail.
//
// REQ-API-001: Read pharmacy_api_configs + decrypt Vault credential
// REQ-API-002: Payload transformation via registered transformer
// REQ-API-003: Response parsing via registered parser
// REQ-API-004: 3-attempt retry: 5s → 15s → 45s backoff
// REQ-API-005: (Webhook callback URL registered in pharmacy_api_configs)
// REQ-API-006: Rate limiting (RPM + concurrent) via DB state check
//
// HC-11: Credentials retrieved from Vault in server-side memory only.
// Never logged, never in query params, never in response bodies.
//
// RESULT OUTCOMES:
//   'accepted'  — pharmacy received order; caller should CAS → PHARMACY_ACKNOWLEDGED
//                 (actually: SUBMISSION_PENDING stays until order.confirmed webhook fires)
//   'rejected'  — pharmacy refused; caller (WO-23) CAS → REROUTE_PENDING
//   'exhausted' — all 3 retries failed; caller (WO-23) CAS → SUBMISSION_FAILED
//
// Order state CAS transitions are NOT performed here — that is the
// routing engine's (WO-23) responsibility. This adapter only manages
// the adapter_submissions audit trail and returns the outcome.

import { createServiceClient } from '@/lib/supabase/service'
import { getVaultSecret, buildAuthHeaders } from '@/lib/adapters/vault'
import { getTransformer, type OrderPayload } from '@/lib/adapters/transformers'
import { getParser } from '@/lib/adapters/parsers'
import {
  createSubmissionRecord,
  markSubmitted,
  markAcknowledged,
  markFailed,
  markRejected,
  markSubmissionFailed,
} from '@/lib/adapters/audit-trail'

// ============================================================
// TYPES
// ============================================================

export interface Tier1SubmitResult {
  outcome: 'accepted' | 'rejected' | 'exhausted'
  /** Latest submission_id (for audit trail / routing engine reference) */
  submissionId: string
  /** Pharmacy's reference number — set on 'accepted', null otherwise */
  externalOrderId: string | null
  /** Total attempts made (1–3) */
  attemptsMade: number
  errorCode: string | null
  errorMessage: string | null
}

// Retry backoff delays: attempt 1→2 = 5s, attempt 2→3 = 15s, max = 45s at 3
const RETRY_DELAYS_MS = [5_000, 15_000, 45_000]
const MAX_ATTEMPTS    = 3

// ============================================================
// RATE LIMIT CHECK
// ============================================================
// DB-based rate limit enforcement — works across serverless instances.
// RPM: count recent TIER_1_API submissions for this pharmacy in last 60s.
// Concurrent: count PENDING or SUBMITTED submissions for this pharmacy.

async function checkRateLimits(
  pharmacyId: string,
  rateLimitRpm: number | null,
  rateLimitConcurrent: number | null
): Promise<void> {
  if (!rateLimitRpm && !rateLimitConcurrent) return

  const supabase = createServiceClient()

  if (rateLimitRpm) {
    const windowStart = new Date(Date.now() - 60_000).toISOString()
    const { count } = await supabase
      .from('adapter_submissions')
      .select('*', { count: 'exact', head: true })
      .eq('pharmacy_id', pharmacyId)
      .eq('tier', 'TIER_1_API')
      .gte('created_at', windowStart)

    if ((count ?? 0) >= rateLimitRpm) {
      throw new Error(
        `[tier1-api] rate limit: pharmacy ${pharmacyId} at RPM limit (${count}/${rateLimitRpm})`
      )
    }
  }

  if (rateLimitConcurrent) {
    const { count } = await supabase
      .from('adapter_submissions')
      .select('*', { count: 'exact', head: true })
      .eq('pharmacy_id', pharmacyId)
      .eq('tier', 'TIER_1_API')
      .in('status', ['PENDING', 'SUBMITTED'])

    if ((count ?? 0) >= rateLimitConcurrent) {
      throw new Error(
        `[tier1-api] rate limit: pharmacy ${pharmacyId} at concurrent limit (${count}/${rateLimitConcurrent})`
      )
    }
  }
}

// ============================================================
// HELPER: sleep
// ============================================================
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

// ============================================================
// MAIN SUBMISSION FUNCTION
// ============================================================

export async function submitTier1Api(
  orderId: string,
  pharmacyId: string
): Promise<Tier1SubmitResult> {
  const supabase = createServiceClient()

  // ── 1. Load pharmacy_api_configs ──────────────────────────
  const { data: config, error: configError } = await supabase
    .from('pharmacy_api_configs')
    .select(
      'config_id, base_url, vault_secret_id, endpoints, api_version,' +
      ' auth_type, payload_transformer, response_parser,' +
      ' rate_limit_rpm, rate_limit_concurrent, timeout_ms'
    )
    .eq('pharmacy_id', pharmacyId)
    .eq('is_active', true)
    .single()

  if (configError || !config) {
    throw new Error(
      `[tier1-api] no active pharmacy_api_configs for pharmacy ${pharmacyId}: ${configError?.message ?? 'not found'}`
    )
  }

  // Verify pharmacy is Tier 1 capable (config record existence implies this,
  // but guard against stale data)
  const { data: pharmacy } = await supabase
    .from('pharmacies')
    .select('integration_tier')
    .eq('pharmacy_id', pharmacyId)
    .single()

  if (pharmacy && pharmacy.integration_tier !== 'TIER_1_API') {
    throw new Error(
      `[tier1-api] pharmacy ${pharmacyId} is ${pharmacy.integration_tier}, not TIER_1_API`
    )
  }

  // ── 2. Validate endpoints config ─────────────────────────
  const endpoints = config.endpoints as Record<string, string> | null
  const submitPath = endpoints?.submitOrder ?? endpoints?.submit ?? '/orders'
  const submitUrl  = `${config.base_url.replace(/\/$/, '')}${submitPath}`

  // ── 3. Decrypt Vault credential (HC-11) ──────────────────
  const credential = await getVaultSecret(config.vault_secret_id)

  const authType = (config.auth_type ?? 'api_key') as 'api_key' | 'oauth2' | 'basic'
  const authHeaders = await buildAuthHeaders(authType, credential)

  // ── 4. Rate limit check ───────────────────────────────────
  await checkRateLimits(pharmacyId, config.rate_limit_rpm, config.rate_limit_concurrent)

  // ── 5. Load order data for payload transformation ─────────
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select(
      'order_id, order_number, provider_id, patient_id, clinic_id,' +
      ' medication_snapshot, provider_npi_snapshot, quantity, sig_text'
    )
    .eq('order_id', orderId)
    .single()

  if (orderError || !order) {
    throw new Error(
      `[tier1-api] order ${orderId} not found: ${orderError?.message ?? 'no data'}`
    )
  }

  const { data: provider } = await supabase
    .from('providers')
    .select('first_name, last_name, npi_number, dea_number, license_state')
    .eq('provider_id', order.provider_id)
    .single()

  const { data: patient } = await supabase
    .from('patients')
    .select('first_name, last_name, date_of_birth, address_line1, address_line2, city, state, zip')
    .eq('patient_id', order.patient_id)
    .single()

  const { data: clinic } = await supabase
    .from('clinics')
    .select('name')
    .eq('clinic_id', order.clinic_id)
    .single()

  if (!provider || !patient) {
    throw new Error(`[tier1-api] provider or patient not found for order ${orderId}`)
  }

  // ── 6. Build canonical OrderPayload ──────────────────────
  const med = order.medication_snapshot as Record<string, unknown> | null

  const orderPayload: OrderPayload = {
    orderId:            order.order_id,
    orderNumber:        order.order_number ?? null,
    providerFirstName:  provider.first_name,
    providerLastName:   provider.last_name,
    // REQ-AAT-005 / snapshot immutability: always use frozen snapshot, never live data
    providerNpi:        order.provider_npi_snapshot ?? '',
    providerDea:        provider.dea_number ?? null,
    providerLicenseState: provider.license_state,
    patientFirstName:   patient.first_name,
    patientLastName:    patient.last_name,
    patientDateOfBirth: patient.date_of_birth,
    patientAddressLine1: patient.address_line1 ?? null,
    patientAddressLine2: patient.address_line2 ?? null,
    patientCity:        patient.city ?? null,
    patientState:       patient.state ?? null,
    patientZip:         patient.zip ?? null,
    medicationName:     String(med?.medication_name ?? 'Compounded Medication'),
    medicationForm:     String(med?.form ?? ''),
    medicationDose:     String(med?.dose ?? ''),
    quantity:           order.quantity,
    sigText:            order.sig_text ?? null,
    clinicName:         clinic?.name ?? 'CompoundIQ Clinic',
  }

  // ── 7. Transform payload ──────────────────────────────────
  const transform = getTransformer(config.payload_transformer)
  const pharmacyPayload = transform(orderPayload)

  // ── 8. Parse response ─────────────────────────────────────
  const parse = getParser(config.response_parser)

  // ── 9. Retry loop ─────────────────────────────────────────
  const timeoutMs = config.timeout_ms ?? 30_000
  let lastSubmissionId = ''
  let lastErrorCode: string | null = null
  let lastErrorMessage: string | null = null

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Create new audit trail row per attempt (REQ-AAT-005: append-only)
    const submissionId = await createSubmissionRecord({
      orderId,
      pharmacyId,
      tier:          'TIER_1_API',
      attemptNumber: attempt,
      metadata: {
        config_id:   config.config_id,
        api_version: config.api_version,
      },
    })
    lastSubmissionId = submissionId

    // Mark SUBMITTED with the request payload (HC-11: never logs credential)
    await markSubmitted(submissionId, {
      url:         submitUrl,
      method:      'POST',
      transformer: config.payload_transformer,
      // Note: pharmacyPayload may contain PHI — stored in JSONB, RLS-protected
      body:        pharmacyPayload,
    })

    let responseBody: Record<string, unknown> = {}
    let statusCode = 0

    try {
      // Execute HTTP POST to pharmacy API
      const response = await fetch(submitUrl, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept':        'application/json',
          ...authHeaders,
          ...(config.api_version ? { 'X-API-Version': config.api_version } : {}),
        },
        body:   JSON.stringify(pharmacyPayload),
        signal: AbortSignal.timeout(timeoutMs),
      })

      statusCode = response.status

      // Parse JSON body; fall back to empty object on parse failure
      try {
        responseBody = (await response.json()) as Record<string, unknown>
      } catch {
        responseBody = {}
      }

    } catch (fetchErr) {
      // Network error or timeout — treat as transient
      const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr)
      lastErrorCode    = 'NETWORK_ERROR'
      lastErrorMessage = msg

      await markFailed(submissionId, 'NETWORK_ERROR', msg)

      if (attempt < MAX_ATTEMPTS) {
        console.warn(
          `[tier1-api] attempt ${attempt}/${MAX_ATTEMPTS} network error | order=${orderId} | ${msg}`
        )
        await sleep(RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)])
        continue
      }

      // All retries exhausted — network errors
      await markSubmissionFailed(submissionId, 'NETWORK_ERROR', msg, {
        attempts: attempt,
      })

      return {
        outcome:         'exhausted',
        submissionId,
        externalOrderId: null,
        attemptsMade:    attempt,
        errorCode:       'NETWORK_ERROR',
        errorMessage:    msg,
      }
    }

    // Parse pharmacy response
    const result = parse(statusCode, responseBody)

    if (result.outcome === 'accepted') {
      await markAcknowledged(submissionId, result.externalOrderId ?? '', responseBody)

      console.info(
        `[tier1-api] accepted | order=${orderId} | extRef=${result.externalOrderId} | attempt=${attempt}`
      )

      return {
        outcome:         'accepted',
        submissionId,
        externalOrderId: result.externalOrderId,
        attemptsMade:    attempt,
        errorCode:       null,
        errorMessage:    null,
      }
    }

    if (result.outcome === 'rejected') {
      // Permanent rejection — no retry
      await markRejected(
        submissionId,
        result.errorCode ?? 'REJECTED',
        result.errorMessage ?? 'Pharmacy rejected order',
        responseBody
      )

      console.warn(
        `[tier1-api] rejected | order=${orderId} | code=${result.errorCode} | attempt=${attempt}`
      )

      return {
        outcome:         'rejected',
        submissionId,
        externalOrderId: null,
        attemptsMade:    attempt,
        errorCode:       result.errorCode,
        errorMessage:    result.errorMessage,
      }
    }

    // outcome === 'unknown' — transient, eligible for retry
    lastErrorCode    = result.errorCode
    lastErrorMessage = result.errorMessage

    await markFailed(
      submissionId,
      result.errorCode    ?? String(statusCode),
      result.errorMessage ?? `HTTP ${statusCode}`,
      responseBody
    )

    if (attempt < MAX_ATTEMPTS) {
      const delayMs = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)]
      console.warn(
        `[tier1-api] attempt ${attempt}/${MAX_ATTEMPTS} transient failure | order=${orderId} | HTTP ${statusCode} — retrying in ${delayMs}ms`
      )
      await sleep(delayMs)
    }
  }

  // All MAX_ATTEMPTS exhausted with transient failures
  await markSubmissionFailed(
    lastSubmissionId,
    lastErrorCode    ?? 'EXHAUSTED',
    lastErrorMessage ?? 'All retry attempts exhausted',
    { attempts: MAX_ATTEMPTS }
  )

  console.error(
    `[tier1-api] all ${MAX_ATTEMPTS} attempts exhausted | order=${orderId} | pharmacy=${pharmacyId}`
  )

  return {
    outcome:         'exhausted',
    submissionId:    lastSubmissionId,
    externalOrderId: null,
    attemptsMade:    MAX_ATTEMPTS,
    errorCode:       lastErrorCode,
    errorMessage:    lastErrorMessage,
  }
}
