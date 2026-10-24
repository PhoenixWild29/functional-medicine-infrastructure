// ============================================================
// Why sending this order to the pharmacy failed
// GET /api/orders/[orderId]/failure-reason
// ============================================================
//
// Returns { failure: { code, plainReason, pharmacyName, at } | null } for
// the clinic order drawer. Only an order in a failed submission state
// (SUBMISSION_FAILED, FAX_FAILED, PHARMACY_REJECTED) has one: the latest
// failed adapter_submissions row, its error_code mapped to plain words
// (src/lib/orders/submission-failure). error_message is never read out:
// it can hold stack traces, URLs or pharmacy internals.
//
// Auth: verified user via getUser(), never getSession(); clinic_id from
// app_metadata (src/lib/auth/claims). Every read uses the caller's own
// session, so RLS applies (orders, adapter_submissions and pharmacies
// each have a clinic or authenticated select policy), and the order is
// also filtered by the caller's clinic. No service role.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getUserClinicId } from '@/lib/auth/claims'
import { FAILED_ADAPTER_STATUSES, isSubmissionFailure, plainFailureReason } from '@/lib/orders/submission-failure'

interface RouteParams {
  params: Promise<{ orderId: string }>
}

export interface SubmissionFailure {
  code:         string | null
  plainReason:  string
  pharmacyName: string | null
  at:           string | null
}

export async function GET(_request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const { orderId } = await params

  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const clinicId = getUserClinicId(user) ?? null
  if (!clinicId) return NextResponse.json({ error: 'Session missing clinic_id' }, { status: 400 })
  if (!orderId) return NextResponse.json({ error: 'orderId required' }, { status: 400 })

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('order_id, status, pharmacy_snapshot')
    .eq('order_id', orderId)
    .eq('clinic_id', clinicId)
    .maybeSingle()
  if (orderError) {
    console.error('[failure-reason] order lookup failed:', orderError.message)
    return NextResponse.json({ error: 'Failed to load order' }, { status: 500 })
  }
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  const o = order as { status: string | null; pharmacy_snapshot: { pharmacy_id?: string | null; name?: string | null } | null }
  if (!isSubmissionFailure(o.status)) return NextResponse.json({ failure: null })

  const { data: subs, error: subError } = await supabase
    .from('adapter_submissions')
    .select('pharmacy_id, error_code, created_at, completed_at')
    .eq('order_id', orderId)
    .in('status', [...FAILED_ADAPTER_STATUSES])
    .order('created_at', { ascending: false })
    .limit(1)
  if (subError) {
    console.error('[failure-reason] submission lookup failed:', subError.message)
    return NextResponse.json({ error: 'Failed to load the submission' }, { status: 500 })
  }
  const sub = ((subs ?? []) as Array<{ pharmacy_id: string | null; error_code: string | null; created_at: string | null; completed_at: string | null }>)[0] ?? null

  // The pharmacy's display name only: the order's snapshot, or, when the
  // failed attempt went to another pharmacy (a re-route), that pharmacy's
  // name. A failed read just leaves it out.
  const snapshot = o.pharmacy_snapshot ?? {}
  let pharmacyName: string | null = snapshot.name ?? null
  const pharmacyId = sub?.pharmacy_id ?? null
  if (pharmacyId && pharmacyId !== snapshot.pharmacy_id) {
    const { data: pharmacy, error: pharmacyError } = await supabase.from('pharmacies').select('name').eq('pharmacy_id', pharmacyId).maybeSingle()
    if (pharmacyError) console.error('[failure-reason] pharmacy name lookup failed:', pharmacyError.message)
    pharmacyName = (pharmacy as { name?: string | null } | null)?.name ?? null
  }

  const code = sub?.error_code ?? null
  const failure: SubmissionFailure = {
    code,
    plainReason:  plainFailureReason(code),
    pharmacyName,
    at:           sub ? (sub.completed_at ?? sub.created_at) : null,
  }
  return NextResponse.json({ failure })
}
