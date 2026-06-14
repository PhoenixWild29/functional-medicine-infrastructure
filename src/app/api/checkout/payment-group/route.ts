// ============================================================
// Phase C Stage 2: Payment Group Creation
// POST /api/checkout/payment-group
// ============================================================
//
// Bundles N AWAITING_PAYMENT orders for ONE patient, ONE clinic,
// ONE provider into a single Stripe PaymentIntent.
//
// Validation, F-2/F-3 signer-identity carryover, totals, payment_groups
// INSERT, CAS-link, Stripe PI creation and rollback all live in the
// shared library at src/lib/payment-group/create-group.ts so the new
// POST /api/orders/[orderId]/group-and-send (Stage 4) can reuse them.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient }  from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createPaymentGroup }  from '@/lib/payment-group/create-group'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

interface CreatePaymentGroupBody {
  orderIds: string[]
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // ── 0. Feature flag — Codex 2026-06-09 sweep, critical finding #2 ────
  if (process.env['PHASE_C_GROUPS_ENABLED'] !== 'true') {
    return NextResponse.json(
      { error: 'Multi-prescription payment groups are not yet enabled in this environment.' },
      { status: 503 },
    )
  }

  // ── 1. Auth gate ─────────────────────────────────────────────
  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const appRole  = session.user.user_metadata['app_role']  as string | undefined
  const clinicId = typeof session.user.user_metadata['clinic_id'] === 'string'
    ? session.user.user_metadata['clinic_id'] as string
    : null

  if (appRole !== 'clinic_admin' && appRole !== 'provider' && appRole !== 'medical_assistant') {
    return NextResponse.json({ error: 'Forbidden — clinic-app role required' }, { status: 403 })
  }
  if (!clinicId) {
    return NextResponse.json({ error: 'Session missing clinic_id' }, { status: 400 })
  }

  // ── 2. Body validation ───────────────────────────────────────
  let body: CreatePaymentGroupBody
  try {
    body = await request.json() as CreatePaymentGroupBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!Array.isArray(body.orderIds)) {
    return NextResponse.json({ error: 'orderIds must be an array' }, { status: 400 })
  }
  if (body.orderIds.length < 2) {
    return NextResponse.json({ error: 'A payment group requires at least 2 orders' }, { status: 400 })
  }
  if (body.orderIds.length > 25) {
    return NextResponse.json({ error: 'A payment group cannot contain more than 25 orders' }, { status: 400 })
  }
  for (const id of body.orderIds) {
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: `Invalid orderId: ${id}` }, { status: 400 })
    }
  }
  const uniqueOrderIds = new Set(body.orderIds)
  if (uniqueOrderIds.size !== body.orderIds.length) {
    return NextResponse.json({ error: 'orderIds contains duplicates' }, { status: 400 })
  }

  // ── 3. Delegate to shared lib ────────────────────────────────
  const supabase = createServiceClient()
  const result = await createPaymentGroup({
    supabase,
    clinicId,
    callerAppRole: appRole,
    callerUserId:  session.user.id,
    orderIds:      body.orderIds,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json({
    groupId:               result.groupId,
    stripePaymentIntentId: result.stripePaymentIntentId,
    totalCents:            result.totalCents,
    orderCount:            result.orderCount,
  }, { status: 201 })
}

// Other HTTP methods explicitly unsupported
export function GET()    { return new NextResponse(null, { status: 405 }) }
export function PUT()    { return new NextResponse(null, { status: 405 }) }
export function PATCH()  { return new NextResponse(null, { status: 405 }) }
export function DELETE() { return new NextResponse(null, { status: 405 }) }
