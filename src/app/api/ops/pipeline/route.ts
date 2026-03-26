// ============================================================
// Ops Pipeline — GET /api/ops/pipeline
// ============================================================
//
// Returns all active orders with SLA urgency data for the
// ops pipeline view. Supports multi-dimension filtering.
//
// REQ-OPV-002: Filtering — clinicId, pharmacyId, tier,
//              statuses (comma-separated), dateFrom, dateTo.
// REQ-OPV-003: Orders sorted by SLA urgency (server-side).
//
// Auth: ops_admin role required.
// Uses service client for cross-clinic access.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient }  from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import type { OrderStatusEnum, IntegrationTierEnum } from '@/types/database.types'
import type { PipelineOrder } from '@/types/pipeline'
import { slaSortComparator } from '@/lib/ops/sla-sort'

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Auth: ops_admin required
  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.user.user_metadata['app_role'] !== 'ops_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const clinicId   = searchParams.get('clinicId')   ?? ''
  const pharmacyId = searchParams.get('pharmacyId') ?? ''
  const tier       = searchParams.get('tier')        ?? ''
  const dateFrom   = searchParams.get('dateFrom')    ?? ''
  const dateTo     = searchParams.get('dateTo')      ?? ''
  const statusParam = searchParams.get('statuses')  ?? ''
  const statuses: OrderStatusEnum[] = statusParam
    ? (statusParam.split(',') as OrderStatusEnum[])
    : []

  const supabase = createServiceClient()
  const now      = new Date().toISOString()

  // Build orders query
  let query = supabase
    .from('orders')
    .select(`
      order_id, order_number, status, clinic_id, pharmacy_id,
      submission_tier, reroute_count, tracking_number, carrier,
      stripe_payment_intent_id, created_at, updated_at, ops_assignee,
      clinics(name),
      pharmacies(name, integration_tier)
    `)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(500)

  if (clinicId)   query = query.eq('clinic_id',   clinicId)
  if (pharmacyId) query = query.eq('pharmacy_id', pharmacyId)
  // BLK-03: Supabase JS client cannot filter on nested joined-table columns
  // (.eq('pharmacies.integration_tier', ...) does not work via PostgREST).
  // Tier filtering is handled client-side in pipeline-view.tsx filteredOrders useMemo.
  if (statuses.length) query = query.in('status', statuses)
  if (dateFrom)   query = query.gte('created_at', dateFrom)
  if (dateTo)     query = query.lte('created_at', dateTo + 'T23:59:59Z')

  const [ordersResult, slasResult] = await Promise.all([
    query,
    supabase
      .from('order_sla_deadlines')
      .select('order_id, deadline_at, resolved_at')
      .is('resolved_at', null)
      .eq('is_active', true)
      .order('deadline_at', { ascending: true }),
  ])

  if (ordersResult.error) {
    console.error('[ops/pipeline] orders fetch error:', ordersResult.error.message)
    return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 500 })
  }

  // Build per-order SLA urgency map
  const slaMap = new Map<string, { nearestDeadline: string; hasBreach: boolean }>()
  for (const sla of (slasResult.data ?? [])) {
    const isBreached = sla.deadline_at < now
    const existing   = slaMap.get(sla.order_id)
    if (!existing) {
      slaMap.set(sla.order_id, { nearestDeadline: sla.deadline_at, hasBreach: isBreached })
    } else {
      slaMap.set(sla.order_id, { nearestDeadline: existing.nearestDeadline, hasBreach: existing.hasBreach || isBreached })
    }
  }

  const orders: PipelineOrder[] = (ordersResult.data ?? []).map(o => {
    const row      = o as unknown as Record<string, unknown>
    const clinic   = row['clinics']    as { name: string } | null
    const pharmacy = row['pharmacies'] as { name: string; integration_tier: string } | null
    const sla      = slaMap.get(o.order_id)

    return {
      orderId:               o.order_id,
      orderNumber:           o.order_number ?? null,
      status:                o.status as OrderStatusEnum,
      clinicId:              o.clinic_id,
      clinicName:            clinic?.name ?? '—',
      pharmacyId:            o.pharmacy_id ?? null,
      pharmacyName:          pharmacy?.name ?? null,
      pharmacyTier:          (pharmacy?.integration_tier as IntegrationTierEnum | null) ?? null,
      submissionTier:        o.submission_tier ?? null,
      rerouteCount:          o.reroute_count ?? 0,
      trackingNumber:        o.tracking_number ?? null,
      carrier:               o.carrier ?? null,
      stripePaymentIntentId: o.stripe_payment_intent_id ?? null,
      createdAt:             o.created_at,
      updatedAt:             o.updated_at,
      opsAssignee:           (row['ops_assignee'] as string | null) ?? null,
      nearestSlaDeadline:    sla?.nearestDeadline ?? null,
      hasSlaBreached:        sla?.hasBreach ?? false,
    }
  })

  // REQ-OPV-003: SLA urgency sort
  orders.sort(slaSortComparator)

  return NextResponse.json({ orders }, { status: 200 })
}

export function POST()   { return new NextResponse(null, { status: 405 }) }
export function PUT()    { return new NextResponse(null, { status: 405 }) }
export function PATCH()  { return new NextResponse(null, { status: 405 }) }
export function DELETE() { return new NextResponse(null, { status: 405 }) }
