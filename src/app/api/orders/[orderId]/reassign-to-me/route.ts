// ============================================================
// Reassign draft to the calling provider — WO-100 "Sign as me"
// POST /api/orders/[orderId]/reassign-to-me
// ============================================================
//
// A provider can take over a DRAFT that an MA saved under another
// provider and sign it under their own name. This endpoint moves the
// provider on every line of that draft — the target order plus its
// sibling DRAFT orders for the same patient under the same original
// provider (an N-prescription session saves as N DRAFT orders) — to
// the caller, refreshes the NPI snapshot, and writes one audit row per
// order to order_status_history (DRAFT → DRAFT, metadata carries the
// from/to provider ids). The caller then proceeds to the existing
// signing path; WO-99 will point that at the batch page.
//
// Auth: provider role only, and the caller must be linked to a
// provider row in the session clinic (providers.user_id — the same
// linkage F-2 enforces at sign-and-send). Anything else is 403.
//
// Request body: none.
// Response: { orderIds: string[], providerId: string, reassigned: boolean }
//   reassigned=false when the draft was already the caller's (no-op).

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { insertStatusHistory } from '@/lib/orders/status-history'
import { isProviderRole, resolveCurrentProvider } from '@/lib/auth/current-provider'
import { REASSIGN_AUDIT_ACTOR } from '@/lib/orders/reassignment'

interface RouteParams {
  params: Promise<{ orderId: string }>
}

export async function POST(
  _request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
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

  if (!isProviderRole(session.user.user_metadata['app_role'])) {
    return NextResponse.json({ error: 'Only a provider can take over a draft.' }, { status: 403 })
  }

  const supabase = createServiceClient()

  const me = await resolveCurrentProvider(supabase, { userId: session.user.id, clinicId })
  if (!me) {
    return NextResponse.json(
      { error: 'Provider account is not linked to a Supabase Auth user. Contact ops to complete provider onboarding before signing.' },
      { status: 403 },
    )
  }

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('order_id, status, clinic_id, patient_id, provider_id')
    .eq('order_id', orderId)
    .eq('clinic_id', clinicId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .maybeSingle()

  if (orderError) {
    console.error('[reassign-to-me] order fetch failed:', orderError.message)
    return NextResponse.json({ error: 'Order lookup failed' }, { status: 500 })
  }
  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }
  if (order.status !== 'DRAFT') {
    return NextResponse.json({ error: 'Only a draft can be reassigned' }, { status: 409 })
  }

  if (order.provider_id === me.provider_id) {
    return NextResponse.json({ orderIds: [order.order_id], providerId: me.provider_id, reassigned: false }, { status: 200 })
  }

  const fromProviderId = order.provider_id

  // Every line of this draft: sibling DRAFT orders for the same patient
  // under the same original provider in this clinic.
  const { data: siblings, error: siblingsError } = await supabase
    .from('orders')
    .select('order_id')
    .eq('clinic_id', clinicId)
    .eq('patient_id', order.patient_id)
    .eq('provider_id', fromProviderId)
    .eq('status', 'DRAFT')
    .eq('is_active', true)
    .is('deleted_at', null)

  if (siblingsError) {
    console.error('[reassign-to-me] sibling lookup failed:', siblingsError.message)
    return NextResponse.json({ error: 'Order lookup failed' }, { status: 500 })
  }

  const orderIds = Array.from(new Set([order.order_id, ...(siblings ?? []).map(s => s.order_id)]))
  const reassignedAt = new Date().toISOString()

  // CAS-style predicate: only rows still DRAFT and still under the
  // original provider move. A concurrent sign or take-over leaves its
  // rows untouched and out of the returned list.
  const { data: moved, error: updateError } = await supabase
    .from('orders')
    .update({
      provider_id:          me.provider_id,
      provider_npi_snapshot: me.npi_number,
      updated_at:           reassignedAt,
    })
    .in('order_id', orderIds)
    .eq('status', 'DRAFT')
    .eq('provider_id', fromProviderId)
    .select('order_id')

  if (updateError) {
    console.error('[reassign-to-me] update failed:', updateError.message)
    return NextResponse.json({ error: 'Reassignment failed' }, { status: 500 })
  }

  const movedIds = (moved ?? []).map(m => m.order_id)
  if (!movedIds.includes(order.order_id)) {
    return NextResponse.json({ error: 'Draft changed while reassigning — reload and try again' }, { status: 409 })
  }

  // Audit: one row per reassigned order. Status is unchanged (DRAFT →
  // DRAFT); the metadata is the record of who took it over from whom.
  // Non-fatal: the reassignment is done. A failure alerts ops, since the
  // audit row is the only record of it.
  await insertStatusHistory(supabase, movedIds.map(id => ({
    order_id:   id,
    old_status: 'DRAFT' as const,
    new_status: 'DRAFT' as const,
    changed_by: session.user.id,
    metadata: {
      actor:            REASSIGN_AUDIT_ACTOR,
      from_provider_id: fromProviderId,
      to_provider_id:   me.provider_id,
      reassigned_at:    reassignedAt,
      reassigned_with:  movedIds.filter(other => other !== id),
    },
  })), 'reassign-to-me')

  console.info(`[reassign-to-me] reassigned ${movedIds.length} draft line(s) | order=${orderId} | clinic=${clinicId}`)

  return NextResponse.json({ orderIds: movedIds, providerId: me.provider_id, reassigned: true }, { status: 200 })
}
