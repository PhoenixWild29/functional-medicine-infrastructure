// ============================================================
// SLA Heatmap & Escalation Manager — WO-34
// /ops/sla
// ============================================================
//
// Server Component: fetches initial SLA + handoff data, passes
// to SlaHeatmap client component for 60-second polling.
//
// REQ-SHE-001: 4-color SLA heatmap across all 10 SLA types
// REQ-SHE-002: Breach count badge (60s polling)
// REQ-SHE-003: One-click acknowledgment (stops 15-min re-fire timer)
// REQ-SHE-004: Escalation tier progression per SLA
// REQ-SHE-005: V2.0 filtered views (by tier, cascade, adapter health, submission failed)
// REQ-SHE-006: Shift handoff report with V2.0 adapter metrics
//
// Uses service client for cross-clinic access.
// Auth: ops_admin required (defense-in-depth; layout also enforces this).

import { redirect }            from 'next/navigation'
import { createServerClient }  from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { computeHandoffMetrics } from '@/lib/ops/sla-handoff'
import { SlaHeatmap }          from './_components/sla-heatmap'
import type { SlaRow }         from '@/app/api/ops/sla/route'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'SLA | Ops Dashboard',
}

export default async function SlaPage() {
  // BLK-02: Auth guard — defense-in-depth; layout enforces this too
  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session || session.user.user_metadata['app_role'] !== 'ops_admin') {
    redirect('/unauthorized')
  }

  const supabase   = createServiceClient()
  const shiftStart = new Date(Date.now() - 8 * 3_600_000).toISOString()

  const [slasResult, adapterResult, failedResult] = await Promise.all([
    // BLK-03: Fetch ALL active SLAs (including resolved) for accurate handoff metrics.
    // Resolved rows are filtered out for display in the client component.
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
      `)
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('deadline_at', { ascending: true })
      .limit(1000),

    supabase
      .from('adapter_submissions')
      .select('tier, status')
      .gte('created_at', shiftStart)
      .in('status', ['CONFIRMED', 'SUBMITTED', 'FAILED', 'TIMEOUT', 'REJECTED'])
      .limit(5000),

    supabase
      .from('orders')
      .select('order_id', { count: 'exact', head: true })
      .eq('status', 'SUBMISSION_FAILED')
      .is('deleted_at', null),
  ])

  // ── Map ALL SLA rows (before display filter) ─────────────────
  const allSlas: SlaRow[] = (slasResult.data ?? []).map(row => {
    const r       = row as unknown as Record<string, unknown>
    const order   = r['orders']     as Record<string, unknown> | null
    const clinic  = order?.['clinics']    as { name: string } | null
    const pharmacy = order?.['pharmacies'] as { name: string; integration_tier: string } | null

    return {
      orderId:          r['order_id']       as string,
      orderNumber:      (order?.['order_number'] as string | null) ?? null,
      orderStatus:      (order?.['status']   as string) ?? 'UNKNOWN',
      clinicName:       clinic?.name ?? '—',
      pharmacyName:     pharmacy?.name ?? null,
      pharmacyTier:     pharmacy?.integration_tier ?? null,
      slaType:          r['sla_type']        as string,
      deadlineAt:       r['deadline_at']     as string,
      createdAt:        r['created_at']      as string,
      escalated:        (r['escalated']      as boolean) ?? false,
      escalatedAt:      (r['escalated_at']   as string | null) ?? null,
      escalationTier:   (r['escalation_tier'] as number) ?? 0,
      acknowledgedAt:   (r['acknowledged_at'] as string | null) ?? null,
      acknowledgedBy:   (r['acknowledged_by'] as string | null) ?? null,
      resolvedAt:       (r['resolved_at']    as string | null) ?? null,
      cascadeAttempted: (r['cascade_attempted'] as boolean) ?? false,
    }
  })

  // Filter to unresolved for display; allSlas used for handoff accuracy
  const displaySlas = allSlas.filter(s => !s.resolvedAt)

  // NB-06: shared handoff computation utility
  const handoff = computeHandoffMetrics({
    allSlas,
    adapterData:      (adapterResult.data ?? []).map(s => s as unknown as Record<string, string>),
    failedOrderCount: failedResult.count ?? 0,
  })

  return (
    <SlaHeatmap
      initialSlas={displaySlas}
      initialHandoff={handoff}
    />
  )
}
