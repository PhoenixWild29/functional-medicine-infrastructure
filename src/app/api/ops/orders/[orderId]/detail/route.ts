// ============================================================
// Order Detail — GET /api/ops/orders/[orderId]/detail
// ============================================================
//
// Returns full order detail for the ops pipeline drawer.
//
// REQ-OPV-004 AC-OPV-003.1: Order fields + clinic/pharmacy/provider.
// REQ-OPV-004 AC-OPV-003.2: Complete state transition history.
// REQ-OPV-004 AC-OPV-003.3: All adapter_submissions (tier, latency, error).
// REQ-OPV-004 AC-OPV-003.4: All sla_deadlines (type, deadline, tier, ack).
// REQ-OPV-004 AC-OPV-003.5: Stripe payment_intent_id + status.
//
// Auth: ops_admin only. Service client for cross-clinic access.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient }  from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

interface Params { params: Promise<{ orderId: string }> }

export async function GET(_request: NextRequest, { params }: Params): Promise<NextResponse> {
  const { orderId } = await params
  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.user.user_metadata['app_role'] !== 'ops_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!orderId) {
    return NextResponse.json({ error: 'Missing orderId' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const now = new Date().toISOString()

  const [orderResult, historyResult, submissionsResult, slasResult] = await Promise.all([
    supabase
      .from('orders')
      .select(`
        order_id, order_number, status, clinic_id, pharmacy_id,
        submission_tier, reroute_count, tracking_number, carrier,
        stripe_payment_intent_id, shipping_state_snapshot,
        created_at, updated_at, locked_at, ops_assignee,
        medication_snapshot,
        clinics(name),
        pharmacies(name)
      `)
      .eq('order_id', orderId)
      .is('deleted_at', null)
      .maybeSingle(),

    supabase
      .from('order_status_history')
      .select('history_id, old_status, new_status, changed_by, metadata, created_at')
      .eq('order_id', orderId)
      .order('created_at', { ascending: false }),

    supabase
      .from('adapter_submissions')
      .select('submission_id, tier, status, error_code, error_message, attempt_number, created_at, completed_at, ai_confidence_score')
      .eq('order_id', orderId)
      .order('created_at', { ascending: false }),

    supabase
      .from('order_sla_deadlines')
      .select('sla_type, deadline_at, escalation_tier, acknowledged_at, resolved_at')
      .eq('order_id', orderId)
      .eq('is_active', true)
      .order('deadline_at', { ascending: true }),
  ])

  if (!orderResult.data) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  const o      = orderResult.data as unknown as Record<string, unknown>
  const clinic   = o['clinics']    as { name: string } | null
  const pharmacy = o['pharmacies'] as { name: string } | null
  const medSnap  = o['medication_snapshot'] as { medication_name?: string } | null

  // Calculate latency from created_at → completed_at for submissions
  const submissions = (submissionsResult.data ?? []).map(s => ({
    submissionId:  s.submission_id,
    tier:          s.tier,
    status:        s.status,
    errorCode:     s.error_code,
    errorMessage:  s.error_message,
    attemptNumber: s.attempt_number,
    createdAt:     s.created_at,
    completedAt:   s.completed_at,
    latencyMs:     s.completed_at
      ? new Date(s.completed_at).getTime() - new Date(s.created_at).getTime()
      : null,
  }))

  const slas = (slasResult.data ?? []).map(s => ({
    slaType:        s.sla_type,
    deadlineAt:     s.deadline_at,
    escalationTier: s.escalation_tier,
    acknowledgedAt: s.acknowledged_at,
    resolvedAt:     s.resolved_at,
    isBreached:     s.deadline_at < now && !s.resolved_at,
  }))

  return NextResponse.json({
    order: {
      orderId:               o['order_id'],
      orderNumber:           o['order_number'] ?? null,
      status:                o['status'],
      clinicName:            clinic?.name ?? '—',
      pharmacyName:          pharmacy?.name ?? null,
      submissionTier:        o['submission_tier'] ?? null,
      rerouteCount:          o['reroute_count'] ?? 0,
      trackingNumber:        o['tracking_number'] ?? null,
      carrier:               o['carrier'] ?? null,
      shippingState:         o['shipping_state_snapshot'] ?? null,
      stripePaymentIntentId: o['stripe_payment_intent_id'] ?? null,
      createdAt:             o['created_at'],
      updatedAt:             o['updated_at'],
      lockedAt:              o['locked_at'] ?? null,
      medicationName:        medSnap?.medication_name ?? null,
      opsAssignee:           (o['ops_assignee'] as string | null) ?? null,
    },
    history:     (historyResult.data ?? []).map(h => ({
      historyId:  h.history_id,
      oldStatus:  h.old_status,
      newStatus:  h.new_status,
      changedBy:  h.changed_by,
      createdAt:  h.created_at,
      metadata:   h.metadata as Record<string, unknown> | null,
    })),
    submissions,
    slas,
  }, { status: 200 })
}

export function POST()   { return new NextResponse(null, { status: 405 }) }
export function PUT()    { return new NextResponse(null, { status: 405 }) }
export function PATCH()  { return new NextResponse(null, { status: 405 }) }
export function DELETE() { return new NextResponse(null, { status: 405 }) }
