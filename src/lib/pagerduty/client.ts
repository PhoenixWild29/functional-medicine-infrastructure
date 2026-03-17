import { serverEnv } from '@/lib/env'

// PagerDuty Events API v2 client — fetch-based (no SDK).
// Endpoint: https://events.pagerduty.com/v2/enqueue
// Auth: PAGERDUTY_ROUTING_KEY (X-Routing-Key header)
//
// Trigger condition: escalation_tier = 2 AND tier-specific SLA delay elapsed
// Used for critical overnight incidents requiring on-call engineer response.
//
// dedup_key pattern: sla-{order_id}-{sla_type}
// This ensures duplicate triggers don't fire multiple pages for the same incident.

const PAGERDUTY_ENDPOINT = 'https://events.pagerduty.com/v2/enqueue'

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

  const response = await fetch(PAGERDUTY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000), // 10s timeout
  })

  if (!response.ok) {
    const text = await response.text()
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

  const response = await fetch(PAGERDUTY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`PagerDuty resolve failed: ${response.status} ${text}`)
  }
}

// Convenience: build the standard dedup key for SLA incidents
export function slaDedupKey(orderId: string, slaType: string): string {
  return `sla-${orderId}-${slaType}`
}
