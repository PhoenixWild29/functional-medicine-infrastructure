// ============================================================
// Ops SLA — GET /api/ops/sla
// ============================================================
//
// Returns active SLA deadlines with order + clinic + pharmacy
// context, plus shift handoff aggregate metrics.
//
// REQ-SHE-001: SLA heatmap data (all 10 types, color context)
// REQ-SHE-002: Breach count badge data
// REQ-SHE-005: V2.0 filtered views (tier, cascade, adapter health, failed)
// REQ-SHE-006: Shift handoff metrics (breaches, success rates, etc.)
//
// Auth: ops_admin only.
// Uses service client for cross-clinic access.
// Hard limit: 1000 rows. Current scale is well under this; a
// totalCount field is returned so the frontend can warn if truncation occurs.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient }  from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { computeHandoffMetrics } from '@/lib/ops/sla-handoff'

export interface SlaRow {
  orderId:          string
  orderNumber:      string | null
  orderStatus:      string
  clinicName:       string
  pharmacyName:     string | null
  pharmacyTier:     string | null
  slaType:          string
  deadlineAt:       string
  createdAt:        string
  escalated:        boolean
  escalatedAt:      string | null
  escalationTier:   number
  acknowledgedAt:   string | null
  acknowledgedBy:   string | null
  resolvedAt:       string | null
  cascadeAttempted: boolean
}

export interface HandoffMetrics {
  totalActiveBreaches:      number
  breachesBySlaType:        Record<string, number>
  adapterSuccessRateByTier: Record<string, { success: number; total: number }>
  submissionFailureCount:   number
  cascadeEventCount:        number
  faxDeliveryRate:          number | null
  acknowledgedUnresolved:   number
}

export interface SlaResponse {
  slas:       SlaRow[]
  handoff:    HandoffMetrics
  totalCount: number  // total matched before limit; warn frontend if slas.length < totalCount
}

function mapSlaRow(row: unknown): SlaRow {
  const r       = row as Record<string, unknown>
  const order   = r['orders']    as Record<string, unknown> | null
  const clinic  = order?.['clinics']    as { name: string } | null
  const pharmacy = order?.['pharmacies'] as { name: string; integration_tier: string } | null

  return {
    orderId:          r['order_id']     as string,
    orderNumber:      (order?.['order_number'] as string | null) ?? null,
    orderStatus:      (order?.['status'] as string) ?? 'UNKNOWN',
    clinicName:       clinic?.name ?? '—',
    pharmacyName:     pharmacy?.name ?? null,
    pharmacyTier:     pharmacy?.integration_tier ?? null,
    slaType:          r['sla_type']       as string,
    deadlineAt:       r['deadline_at']    as string,
    createdAt:        r['created_at']     as string,
    escalated:        (r['escalated']     as boolean) ?? false,
    escalatedAt:      (r['escalated_at']  as string | null) ?? null,
    escalationTier:   (r['escalation_tier'] as number) ?? 0,
    acknowledgedAt:   (r['acknowledged_at'] as string | null) ?? null,
    acknowledgedBy:   (r['acknowledged_by'] as string | null) ?? null,
    resolvedAt:       (r['resolved_at']   as string | null) ?? null,
    cascadeAttempted: (r['cascade_attempted'] as boolean) ?? false,
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.user.user_metadata['app_role'] !== 'ops_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  // includeResolved=true returns resolved rows too (for shift report detail)
  const includeResolved = searchParams.get('includeResolved') === 'true'

  const supabase   = createServiceClient()
  const shiftStart = new Date(Date.now() - 8 * 3_600_000).toISOString()

  // ── Parallel fetches ─────────────────────────────────────────
  const [slasResult, adapterResult, failedResult] = await Promise.all([
    // Fetch ALL active SLAs (including resolved) so handoff metrics are accurate.
    // Client filters resolved rows for display via includeResolved param.
    supabase
      .from('order_sla_deadlines')
      .select(`
        order_id, sla_type, deadline_at, created_at,
        escalated, escalated_at, escalation_tier,
        acknowledged_at, acknowledged_by, resolved_at, cascade_attempted,
        orders(
          order_number, status, submission_tier, clinic_id, pharmacy_id,
          clinics(name),
          pharmacies(name, integration_tier)
        )
      `, { count: 'exact' })
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('deadline_at', { ascending: true })
      .limit(1000),

    // Adapter submission success rate for current shift (last 8h)
    supabase
      .from('adapter_submissions')
      .select('tier, status')
      .gte('created_at', shiftStart)
      .in('status', ['CONFIRMED', 'SUBMITTED', 'FAILED', 'TIMEOUT', 'REJECTED'])
      .limit(5000),

    // Count orders currently in SUBMISSION_FAILED
    supabase
      .from('orders')
      .select('order_id', { count: 'exact', head: true })
      .eq('status', 'SUBMISSION_FAILED')
      .is('deleted_at', null),
  ])

  if (slasResult.error) {
    console.error('[ops/sla] sla fetch error:', slasResult.error.message)
    return NextResponse.json({ error: 'Failed to fetch SLA data' }, { status: 500 })
  }
  // BLK-01: log non-fatal errors from secondary queries
  if (adapterResult.error) {
    console.error('[ops/sla] adapter submissions fetch error (non-fatal):', adapterResult.error.message)
  }
  if (failedResult.error) {
    console.error('[ops/sla] failed orders count error (non-fatal):', failedResult.error.message)
  }

  // ── Map ALL SLA rows (before display filter) ─────────────────
  // BLK-03: allSlas includes resolved rows so handoff fax rate is accurate.
  const allSlas: SlaRow[] = (slasResult.data ?? []).map(mapSlaRow)

  // ── Display filter: drop resolved rows unless client requests them ──
  const slas = includeResolved ? allSlas : allSlas.filter(s => !s.resolvedAt)

  // ── Handoff metrics — NB-06: shared utility ──────────────────
  const handoff = computeHandoffMetrics({
    allSlas,
    adapterData:      (adapterResult.data ?? []).map(s => s as unknown as Record<string, string>),
    failedOrderCount: failedResult.count ?? 0,
  })

  return NextResponse.json({
    slas,
    handoff,
    totalCount: slasResult.count ?? allSlas.length,
  } satisfies SlaResponse, { status: 200 })
}

export function POST()   { return new NextResponse(null, { status: 405 }) }
export function PUT()    { return new NextResponse(null, { status: 405 }) }
export function PATCH()  { return new NextResponse(null, { status: 405 }) }
export function DELETE() { return new NextResponse(null, { status: 405 }) }
