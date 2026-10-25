// ============================================================
// WO-102: allocate shipping across one send
// POST /api/orders/shipping  { orderIds: string[] }
// ============================================================
//
// The Review page creates one DRAFT per prescription, calls this with
// every order id of the send, and only then signs them — so each
// pharmacy's shipping sits on exactly one order before any payment link
// goes out (once per pharmacy per bundle). Save as Draft calls it the
// same way.
//
// Computed server-side from pharmacy rates and each order's shipping
// type and wholesale; the body carries order ids only.
//
// Auth: verified user via getUser(); clinic_id from that user. Orders
// must be active DRAFTs in that clinic.

import { NextRequest, NextResponse } from 'next/server'
import { refuseCrossSite } from '@/lib/security/same-origin'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { refuseUnlessApproved } from '@/lib/onboarding/approval-guard'
import { applyBundleShipping, MAX_BUNDLE_ORDERS } from '@/lib/orders/apply-bundle-shipping'
import { getUserClinicId, getUserRole, isClinicStaffRole } from '@/lib/auth/claims'
import { withApiErrors } from '@/lib/api/with-api-errors'
import { UUID_RE } from '@/lib/api/input'

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const crossSite = refuseCrossSite(request)
  if (crossSite) return crossSite
  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // Clinic staff only: any other role, or none, is refused before anything is read.
  if (!isClinicStaffRole(getUserRole(user))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const clinicId = getUserClinicId(user) ?? null
  if (!clinicId) {
    return NextResponse.json({ error: 'Session missing clinic_id' }, { status: 400 })
  }
  // Pending review: nothing is ordered, signed or sent until ops approves
  // the clinic (lib/onboarding/approval-guard).
  const pendingReview = await refuseUnlessApproved(createServiceClient(), clinicId)
  if (pendingReview) return pendingReview

  let body: { orderIds?: unknown } | null
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  // Every id an id before anything is read (a bad one reaching Postgres is
  // a 22P02, a 500). A body that is not an object has no orderIds.
  const orderIds = body && typeof body === 'object' ? body.orderIds : undefined
  if (!Array.isArray(orderIds) || orderIds.length === 0 || orderIds.length > MAX_BUNDLE_ORDERS
    || !orderIds.every(id => typeof id === 'string' && UUID_RE.test(id))) {
    return NextResponse.json({ error: `orderIds must be 1–${MAX_BUNDLE_ORDERS} order ids` }, { status: 400 })
  }

  const result = await applyBundleShipping(createServiceClient(), clinicId, orderIds as string[])
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({
    totalCents: result.shipping.totalCents,
    byPharmacy: result.shipping.byPharmacy,
    feesByOrder: result.feesByOrder,
  }, { status: 200 })
}

export const POST = withApiErrors('/api/orders/shipping', postHandler)
