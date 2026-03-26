import { serverEnv } from '@/lib/env'

// ============================================================
// PagerDuty Events API v2 Client — WO-24 (extended in WO-25)
// ============================================================
//
// Endpoint: https://events.pagerduty.com/v2/enqueue
// Auth: PAGERDUTY_ROUTING_KEY env var
//
// REQ-SAI-008: Tier 3 SLA escalation fires PagerDuty incidents.
// dedup_key pattern: sla-{order_id}-{sla_type}
// Prevents duplicate incidents when cron fires Tier 3 multiple times.
//
// PHI Boundary: customDetails must not contain patient names, medications,
// diagnoses, or any clinical data. Only order_id, sla_type, tier, and
// non-PHI operational context is permitted.

const PAGERDUTY_ENDPOINT = 'https://events.pagerduty.com/v2/enqueue'
const RETRY_DELAY_MS     = 2000   // 2s backoff before the single retry on 5xx

type PagerDutySeverity = 'critical' | 'error' | 'warning' | 'info'

interface PagerDutyTriggerParams {
  /** Dedup key — use pattern: sla-{order_id}-{sla_type} */
  dedupKey: string
  summary: string
  severity: PagerDutySeverity
  source: string
  /** Custom details — PHI prohibited, technical context only */
  customDetails?: Record<string, string | number | boolean>
}

interface PagerDutyResolveParams {
  /** Must match the dedupKey used when triggering */
  dedupKey: string
}

export async function triggerPagerDutyIncident(
  params: PagerDutyTriggerParams
): Promise<void> {
  const body = {
    routing_key: serverEnv.pagerdutyRoutingKey(),
    event_action: 'trigger',
    dedup_key: params.dedupKey,
    payload: {
      summary: params.summary,
      severity: params.severity,
      source: params.source,
      custom_details: params.customDetails ?? {},
    },
  }

  for (let attempt = 0; attempt <= 1; attempt++) {
    const response = await fetch(PAGERDUTY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000), // 10s timeout
    })

    if (response.ok) return

    const text = await response.text()
    // BLK-08: surface Retry-After on 429 so callers can log it for the on-call team
    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After') ?? 'unknown'
      throw new Error(`PagerDuty rate limited (429) — Retry-After: ${retryAfter}s. ${text}`)
    }
    // Retry once on transient 5xx before surfacing the error
    if (response.status >= 500 && attempt === 0) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
      continue
    }
    throw new Error(`PagerDuty trigger failed: ${response.status} ${text}`)
  }
}

export async function resolvePagerDutyIncident(
  params: PagerDutyResolveParams
): Promise<void> {
  const body = {
    routing_key: serverEnv.pagerdutyRoutingKey(),
    event_action: 'resolve',
    dedup_key: params.dedupKey,
  }

  for (let attempt = 0; attempt <= 1; attempt++) {
    const response = await fetch(PAGERDUTY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    })

    if (response.ok) return

    const text = await response.text()
    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After') ?? 'unknown'
      throw new Error(`PagerDuty resolve rate limited (429) — Retry-After: ${retryAfter}s. ${text}`)
    }
    // Retry once on transient 5xx before surfacing the error
    if (response.status >= 500 && attempt === 0) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
      continue
    }
    throw new Error(`PagerDuty resolve failed: ${response.status} ${text}`)
  }
}

// Convenience: build the standard dedup key for SLA incidents
export function slaDedupKey(orderId: string, slaType: string): string {
  return `sla-${orderId}-${slaType}`
}

// ============================================================
// SLA-SPECIFIC WRAPPER — REQ-SAI-008 (WO-25)
// ============================================================

export interface SlaEscalationParams {
  orderId:               string
  slaType:               string
  escalationTier:        number
  pharmacySlug:          string   // non-PHI operational reference
  integrationTier:       string
  cascadeStatus?:        string
  breachDurationMinutes: number
}

/**
 * Triggers a Tier 3 PagerDuty incident for an SLA breach.
 * REQ-SAI-008.1–008.3: PHI-safe custom_details, critical severity,
 * dedup_key = sla-{order_id}-{sla_type}.
 *
 * IMPORTANT: Only call this function when escalationTier === 3.
 * Tier 1 and Tier 2 escalations are handled by email/SMS notifications
 * and must NOT create PagerDuty incidents.
 */
export async function triggerSlaEscalation(params: SlaEscalationParams): Promise<void> {
  await triggerPagerDutyIncident({
    dedupKey: slaDedupKey(params.orderId, params.slaType),
    summary:  `SLA Breach (Tier 3): ${params.slaType} — Order ${params.orderId}`,
    severity: 'critical',
    source:   'compoundiq-sla-engine',
    customDetails: {
      order_id:                params.orderId,
      sla_type:                params.slaType,
      escalation_tier:         params.escalationTier,
      pharmacy_name:           params.pharmacySlug,
      integration_tier:        params.integrationTier,
      cascade_status:          params.cascadeStatus ?? 'N/A',
      breach_duration_minutes: params.breachDurationMinutes,
    },
  })
}

/**
 * Resolves the PagerDuty incident when the SLA is resolved.
 * REQ-SAI-008.4. Call from resolveSlasForTransition for Tier 3 SLAs.
 */
export async function resolveSlaEscalation(orderId: string, slaType: string): Promise<void> {
  await resolvePagerDutyIncident({ dedupKey: slaDedupKey(orderId, slaType) })
}
