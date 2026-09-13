// ============================================================
// Order timeline actor names
// GET /api/orders/[orderId]/timeline-actors
// ============================================================
//
// Returns { actors: { [authUserId]: { name, role } } } for every
// order_status_history.changed_by on this order, so the order drawer can
// show "Draft edited · Sarah Chen" instead of a raw auth user id.
//
// Auth: clinic session. The order must belong to the caller's clinic;
// names are resolved only for users in that clinic (see
// src/lib/orders/timeline-actors.ts). Unresolved ids are omitted and the
// drawer falls back to printing the id.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveTimelineActors } from '@/lib/orders/timeline-actors'

interface RouteParams {
  params: Promise<{ orderId: string }>
}

export async function GET(_request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const { orderId } = await params

  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const clinicId = typeof session.user.user_metadata['clinic_id'] === 'string'
    ? session.user.user_metadata['clinic_id'] as string
    : null
  if (!clinicId) {
    return NextResponse.json({ error: 'Session missing clinic_id' }, { status: 400 })
  }
  if (!orderId) {
    return NextResponse.json({ error: 'orderId required' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('order_id')
    .eq('order_id', orderId)
    .eq('clinic_id', clinicId)
    .maybeSingle()
  if (orderError) {
    console.error('[timeline-actors] order lookup failed:', orderError.message)
    return NextResponse.json({ error: 'Failed to load order' }, { status: 500 })
  }
  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  const { data: history, error: historyError } = await supabase
    .from('order_status_history')
    .select('changed_by')
    .eq('order_id', orderId)
  if (historyError) {
    console.error('[timeline-actors] history lookup failed:', historyError.message)
    return NextResponse.json({ error: 'Failed to load history' }, { status: 500 })
  }

  const actors = await resolveTimelineActors(
    supabase,
    clinicId,
    (history ?? []).map(h => h.changed_by),
  )
  return NextResponse.json({ actors }, { status: 200 })
}
