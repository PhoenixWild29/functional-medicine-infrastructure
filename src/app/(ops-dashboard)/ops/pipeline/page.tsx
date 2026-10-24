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
import { PipelineView } from './_components/pipeline-view'
import { StuckRefundsPanel, LatePaymentsPanel } from './_components/stuck-refunds-panel'
import { listStuckRefunds, listLatePayments } from '@/lib/refunds/stuck'
import { parsePipelineFilters } from '@/lib/ops/pipeline-filters'
import { fetchPipelineOrders } from '@/lib/ops/pipeline-query'
import type { FilterOption } from '@/types/pipeline'

// Re-export for legacy consumers still importing from this page file
export type { PipelineOrder, FilterOption } from '@/types/pipeline'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Pipeline | Ops Dashboard',
}

// ── Page ────────────────────────────────────────────────────

export default async function PipelinePage(
  props: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {},
) {
  const searchParams = (await props.searchParams) ?? {}
  // A Slack alert's "Open in ops" link: /ops/pipeline?order=<id> opens that order.
  const rawOrder = searchParams['order']
  const initialOrderId = ((Array.isArray(rawOrder) ? rawOrder[0] : rawOrder) ?? '').trim() || null
  // REQ-OPV-002: filters in the URL (a reload or a shared link) apply to the
  // first render too. Status is picked in the view's sidebar, which counts
  // every status, so the rows load across statuses.
  const initialFilters = parsePipelineFilters(searchParams)
  const supabase = createServiceClient()

  // Fetch in parallel: orders (with SLA urgency) + filter option lists
  const [ordersResult, clinicsResult, pharmaciesResult] = await Promise.all([
    fetchPipelineOrders(supabase, { ...initialFilters, statuses: [] }, Date.now()),

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

  // A failed read renders an empty first page (and empty option lists);
  // the view's poll retries the orders.
  if (ordersResult.error)     console.error('[ops/pipeline] orders fetch error:', ordersResult.error)
  if (clinicsResult.error)    console.error('[ops/pipeline] clinic options fetch error:', clinicsResult.error.message)
  if (pharmaciesResult.error) console.error('[ops/pipeline] pharmacy options fetch error:', pharmaciesResult.error.message)
  const orders = ordersResult.orders ?? []

  const clinics: FilterOption[]    = (clinicsResult.data    ?? []).map(c => ({ id: c.clinic_id,    name: c.name }))
  const pharmacies: FilterOption[] = (pharmaciesResult.data ?? []).map(p => ({ id: p.pharmacy_id, name: p.name }))

  // Batch 2B: refunds automation has stopped retrying (past Stripe's
  // idempotency window, or with no readable pending time). A failed read
  // renders as an error, never as "no stuck refunds".
  const [stuckRefunds, latePayments] = await Promise.all([
    listStuckRefunds(supabase),
    listLatePayments(supabase),
  ])

  return (
    <>
      <h1 className="sr-only">Pipeline</h1>
      <div className="space-y-3">
        <StuckRefundsPanel result={stuckRefunds} />
        <LatePaymentsPanel result={latePayments} />
        <PipelineView
          initialOrders={orders}
          clinicOptions={clinics}
          pharmacyOptions={pharmacies}
          initialOrderId={initialOrderId}
          initialFilters={initialFilters}
        />
      </div>
    </>
  )
}
