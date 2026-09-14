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
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { applyBundleShipping, MAX_BUNDLE_ORDERS } from '@/lib/orders/apply-bundle-shipping'

export async function POST(request: NextRequest): Promise<NextResponse> {
  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const clinicId = typeof user.user_metadata['clinic_id'] === 'string'
    ? user.user_metadata['clinic_id'] as string
    : null
  if (!clinicId) {
    return NextResponse.json({ error: 'Session missing clinic_id' }, { status: 400 })
  }

  let body: { orderIds?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const orderIds = body.orderIds
  if (!Array.isArray(orderIds) || orderIds.length === 0 || orderIds.length > MAX_BUNDLE_ORDERS
    || !orderIds.every(id => typeof id === 'string' && id.length > 0)) {
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
