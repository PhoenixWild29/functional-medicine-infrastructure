// ============================================================
// Ops Adapter Health — GET /api/ops/adapters
// ============================================================
//
// Returns per-pharmacy health cards with circuit breaker state,
// 24-hour submission metrics, and latency percentiles.
//
// REQ-AHM-001: Per-pharmacy health cards (name, tier, status)
// REQ-AHM-002: Circuit breaker state (CLOSED/OPEN/HALF_OPEN)
// REQ-AHM-003: 24-hour rolling hourly submission chart data
// REQ-AHM-004: Success rate %, latency p50/p95/p99, last success
// REQ-AHM-005: Tier-specific health indicators
// REQ-AHM-007: Filtering support data (all pharmacies returned; client filters)
//
// Auth: ops_admin only.
// Uses service client (circuit_breaker_state has RESTRICTIVE RLS).

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient }  from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { computeAdapterStatus, percentile } from '@/lib/ops/adapter-health'

export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN'

export interface HourlyBucket {
  hour:    string  // ISO hour string e.g. '2026-03-19T14:00:00.000Z'
  success: number
  failure: number
  timeout: number
}

export interface PharmacyHealthCard {
  pharmacyId:       string
  name:             string
  tier:             string
  adapterStatus:    'green' | 'yellow' | 'red'
  isActive:         boolean
  // Circuit breaker — REQ-AHM-002
  circuitBreaker:   {
    state:         CircuitBreakerState
    failureCount:  number
    cooldownUntil: string | null
    lastFailureAt: string | null
    updatedAt:     string
  } | null
  // 24h metrics — REQ-AHM-003, REQ-AHM-004
  successRate:      number   // 0-100
  totalCount:       number
  successCount:     number
  failureCount:     number
  timeoutCount:     number
  // Latency percentiles (ms): submitted_at → acknowledged_at; null if < 5 samples
  latencyP50:       number | null
  latencyP95:       number | null
  latencyP99:       number | null
  lastSuccessAt:    string | null
  // 24-entry hourly chart (index 0 = 23h ago, index 23 = current hour)
  hourlyBuckets:    HourlyBucket[]
}

export interface AdaptersResponse {
  pharmacies: PharmacyHealthCard[]
  fetchedAt:  string
}

// NB-01: computeAdapterStatus and percentile are imported from @/lib/ops/adapter-health

export async function GET(_request: NextRequest): Promise<NextResponse> {
  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.user.user_metadata['app_role'] !== 'ops_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const supabase  = createServiceClient()
  const now       = new Date()
  const since24h  = new Date(now.getTime() - 24 * 3_600_000).toISOString()

  // ── Parallel fetches ─────────────────────────────────────────
  const [pharmaciesResult, cbResult, submissionsResult] = await Promise.all([
    supabase
      .from('pharmacies')
      .select('pharmacy_id, name, integration_tier, adapter_status, is_active, updated_at')
      .is('deleted_at', null)
      .order('name'),

    // Service client bypasses RESTRICTIVE RLS on circuit_breaker_state
    supabase
      .from('circuit_breaker_state')
      .select('pharmacy_id, state, failure_count, last_failure_at, cooldown_until, updated_at'),

    // Last 24h submissions for metrics
    supabase
      .from('adapter_submissions')
      .select('submission_id, pharmacy_id, tier, status, created_at, completed_at, submitted_at, acknowledged_at, attempt_number')
      .gte('created_at', since24h)
      .order('created_at', { ascending: true })
      .limit(50_000),
  ])

  if (pharmaciesResult.error) {
    console.error('[ops/adapters] pharmacies fetch error:', pharmaciesResult.error.message)
    return NextResponse.json({ error: 'Failed to fetch pharmacies' }, { status: 500 })
  }
  if (cbResult.error) {
    console.error('[ops/adapters] circuit_breaker fetch error (non-fatal):', cbResult.error.message)
  }
  if (submissionsResult.error) {
    console.error('[ops/adapters] submissions fetch error (non-fatal):', submissionsResult.error.message)
  }

  // ── Build lookup maps ────────────────────────────────────────
  const cbMap = new Map<string, NonNullable<typeof cbResult.data>[number]>()
  for (const cb of (cbResult.data ?? [])) {
    cbMap.set(cb.pharmacy_id, cb)
  }

  // Group submissions by pharmacy
  const subsByPharmacy = new Map<string, NonNullable<typeof submissionsResult.data>[number][]>()
  for (const sub of (submissionsResult.data ?? [])) {
    const list = subsByPharmacy.get(sub.pharmacy_id) ?? []
    list.push(sub)
    subsByPharmacy.set(sub.pharmacy_id, list)
  }

  // ── Build 24 hourly bucket slots ─────────────────────────────
  // Slot i = floor(now - 23*3600s) + i hours; slot 23 = current hour
  const hourSlots: string[] = []
  for (let i = 23; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 3_600_000)
    d.setMinutes(0, 0, 0)  // NB-06: setMinutes(min, sec, ms) — zeros sub-hour precision
    hourSlots.push(d.toISOString())
  }

  // ── Build per-pharmacy health cards ──────────────────────────
  const pharmacies: PharmacyHealthCard[] = (pharmaciesResult.data ?? []).map(p => {
    const subs  = subsByPharmacy.get(p.pharmacy_id) ?? []
    const cb    = cbMap.get(p.pharmacy_id) ?? null

    const successCount = subs.filter(s =>
      s.status === 'CONFIRMED' || s.status === 'SUBMITTED' || s.status === 'ACKNOWLEDGED'
    ).length
    const failureCount = subs.filter(s =>
      s.status === 'FAILED' || s.status === 'REJECTED' || s.status === 'SUBMISSION_FAILED'
    ).length
    const timeoutCount = subs.filter(s => s.status === 'TIMEOUT').length
    const total        = subs.length

    const successRate = total > 0
      ? Math.round((successCount / total) * 100 * 10) / 10
      : 100  // no submissions = assume healthy

    // Latency: submitted_at → acknowledged_at in ms
    const latencies = subs
      .filter(s => s.submitted_at && s.acknowledged_at)
      .map(s => new Date(s.acknowledged_at!).getTime() - new Date(s.submitted_at!).getTime())
      .filter(ms => ms >= 0)
      .sort((a, b) => a - b)

    const lastSuccess = subs
      .filter(s => s.status === 'CONFIRMED' || s.status === 'SUBMITTED' || s.status === 'ACKNOWLEDGED')
      .at(-1)

    const cbState = (cb?.state as CircuitBreakerState | undefined) ?? null

    // BLK-04: use freshest meaningful timestamp (acknowledged > completed > created)
    const lastSuccessTs = lastSuccess
      ? (lastSuccess.acknowledged_at ?? lastSuccess.completed_at ?? lastSuccess.created_at)
      : null

    const adapterStatus = computeAdapterStatus(
      successRate,
      cbState,
      lastSuccessTs,
    )

    // Hourly buckets
    const hourlyBuckets: HourlyBucket[] = hourSlots.map(hourIso => {
      const hourStart = new Date(hourIso).getTime()
      const hourEnd   = hourStart + 3_600_000
      const inHour    = subs.filter(s => {
        const t = new Date(s.created_at).getTime()
        return t >= hourStart && t < hourEnd
      })
      return {
        hour:    hourIso,
        success: inHour.filter(s => s.status === 'CONFIRMED' || s.status === 'SUBMITTED' || s.status === 'ACKNOWLEDGED').length,
        failure: inHour.filter(s => s.status === 'FAILED' || s.status === 'REJECTED' || s.status === 'SUBMISSION_FAILED').length,
        timeout: inHour.filter(s => s.status === 'TIMEOUT').length,
      }
    })

    return {
      pharmacyId:    p.pharmacy_id,
      name:          p.name,
      tier:          p.integration_tier,
      adapterStatus,
      isActive:      p.is_active,
      circuitBreaker: cb ? {
        state:         cb.state as CircuitBreakerState,
        failureCount:  cb.failure_count,
        cooldownUntil: cb.cooldown_until ?? null,
        lastFailureAt: cb.last_failure_at ?? null,
        updatedAt:     cb.updated_at,
      } : null,
      successRate,
      totalCount:    total,
      successCount,
      failureCount,
      timeoutCount,
      latencyP50:    percentile(latencies, 50),
      latencyP95:    percentile(latencies, 95),
      latencyP99:    percentile(latencies, 99),
      lastSuccessAt: lastSuccessTs,
      hourlyBuckets,
    }
  })

  return NextResponse.json({
    pharmacies,
    fetchedAt: now.toISOString(),
  } satisfies AdaptersResponse, { status: 200 })
}

export function POST()   { return new NextResponse(null, { status: 405 }) }
export function PUT()    { return new NextResponse(null, { status: 405 }) }
export function PATCH()  { return new NextResponse(null, { status: 405 }) }
export function DELETE() { return new NextResponse(null, { status: 405 }) }
