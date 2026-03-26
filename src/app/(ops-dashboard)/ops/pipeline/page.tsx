// ============================================================
// Order Pipeline View — WO-33
// /ops/pipeline
// ============================================================
//
// Server Component: fetches initial order + SLA data, passes to
// PipelineView client component for 10-second polling and
// interactive filtering.
//
// REQ-OPV-001: All 23 order states with aggregate counts.
// REQ-OPV-002: Multi-dimension filtering (clinic, pharmacy, status, date, tier).
// REQ-OPV-003: SLA urgency sort — nearest deadline first.
// REQ-OPV-004: Drill-down to order detail (history, submissions, SLAs).
// REQ-OPV-005: Quick-action buttons per order (context-aware).
// REQ-OPV-006: Shift coverage — ops can claim orders.
// REQ-OPV-007: Slack notifications (handled by existing SLA/cron infrastructure).
// REQ-OPV-008: Reroute limit enforcement (max 2 per order — HC-06).
//
// Uses service client for cross-clinic access (ops_admin bypasses RLS).

import { createServiceClient } from '@/lib/supabase/service'
import type { OrderStatusEnum, IntegrationTierEnum } from '@/types/database.types'
import { PipelineView } from './_components/pipeline-view'
import { slaSortComparator } from '@/lib/ops/sla-sort'
import type { PipelineOrder, FilterOption } from '@/types/pipeline'

// Re-export for legacy consumers still importing from this page file
export type { PipelineOrder, FilterOption } from '@/types/pipeline'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Pipeline | Ops Dashboard',
}

// ── Page ────────────────────────────────────────────────────

export default async function PipelinePage() {
  const supabase = createServiceClient()
  const now = new Date().toISOString()

  // Fetch in parallel: orders + SLA deadlines + filter option lists
  const [ordersResult, slasResult, clinicsResult, pharmaciesResult] = await Promise.all([
    supabase
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
      .limit(500),  // cap for initial load; client can filter further

    // Active unresolved SLA deadlines — sorted earliest first for urgency map
    supabase
      .from('order_sla_deadlines')
      .select('order_id, deadline_at, resolved_at')
      .is('resolved_at', null)
      .eq('is_active', true)
      .order('deadline_at', { ascending: true }),

    supabase
      .from('clinics')
      .select('clinic_id, name')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('name'),

    supabase
      .from('pharmacies')
      .select('pharmacy_id, name')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('name'),
  ])

  // Build per-order SLA urgency map
  // SLA rows are sorted ASC by deadline_at, so first encounter per order = nearest
  const slaMap = new Map<string, { nearestDeadline: string; hasBreach: boolean }>()
  for (const sla of (slasResult.data ?? [])) {
    const isBreached = sla.deadline_at < now
    const existing   = slaMap.get(sla.order_id)
    if (!existing) {
      slaMap.set(sla.order_id, {
        nearestDeadline: sla.deadline_at,
        hasBreach:       isBreached,
      })
    } else {
      // Keep earliest deadline; accumulate breach flag
      slaMap.set(sla.order_id, {
        nearestDeadline: existing.nearestDeadline,
        hasBreach:       existing.hasBreach || isBreached,
      })
    }
  }

  // Build PipelineOrder list
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

  // REQ-OPV-003: Sort by SLA urgency — breached first, then nearest deadline, then most-recently-updated
  orders.sort(slaSortComparator)

  const clinics: FilterOption[]    = (clinicsResult.data    ?? []).map(c => ({ id: c.clinic_id,    name: c.name }))
  const pharmacies: FilterOption[] = (pharmaciesResult.data ?? []).map(p => ({ id: p.pharmacy_id, name: p.name }))

  return (
    <PipelineView
      initialOrders={orders}
      clinicOptions={clinics}
      pharmacyOptions={pharmacies}
    />
  )
}
