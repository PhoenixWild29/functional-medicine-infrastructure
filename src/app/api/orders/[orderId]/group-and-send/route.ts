// ============================================================
// Phase C Stage 4 — POST /api/orders/[orderId]/group-and-send
// ============================================================
//
// Clinic-side "Combine and Send" endpoint. Takes an anchor order and
// a set of sibling order IDs the operator has confirmed in the drawer,
// then:
//   1. Bundles them into a payment_group via createPaymentGroup() (same
//      shared lib Stage 2's /api/checkout/payment-group uses).
//   2. Issues a group checkout JWT (generateGroupCheckoutToken).
//   3. Returns the patient-facing /checkout/<token> URL + the group_id
//      and totals so the drawer can show a confirmation copy-link box.
//
// The endpoint is feature-gated by PHASE_C_GROUPS_ENABLED — the same
// flag the Stage 2 route uses. Solo "Copy Payment Link" stays available
// regardless of the flag.
//
// Role + CSRF gates mirror checkout-link/route.ts. F-2/F-3 carryover
// (provider session must match orders' provider) is enforced inside
// createPaymentGroup so the policy lives in one place.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient }        from '@/lib/supabase/server'
import { createServiceClient }       from '@/lib/supabase/service'
import { createPaymentGroup }        from '@/lib/payment-group/create-group'
import { generateGroupCheckoutToken } from '@/lib/auth/checkout-token'
import { serverEnv }                 from '@/lib/env'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CLINIC_APP_ROLES = ['clinic_admin', 'provider', 'medical_assistant'] as const
type ClinicAppRole = typeof CLINIC_APP_ROLES[number]

interface RouteParams {
  params: Promise<{ orderId: string }>
}

interface GroupAndSendBody {
  siblingOrderIds: string[]
}

export async function POST(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  // ── 0. Feature flag ───────────────────────────────────────────
  if (process.env['PHASE_C_GROUPS_ENABLED'] !== 'true') {
    return NextResponse.json(
      { error: 'Multi-prescription payment groups are not yet enabled in this environment.' },
      { status: 503 },
    )
  }

  // ── 1. CSRF (same-origin only) ────────────────────────────────
  const sfSite = request.headers.get('sec-fetch-site')
  if (sfSite && sfSite !== 'same-origin' && sfSite !== 'none') {
    return NextResponse.json({ error: 'Cross-site requests are not permitted' }, { status: 403 })
  }

  const { orderId: anchorOrderId } = await params
  if (!UUID_RE.test(anchorOrderId)) {
    return NextResponse.json({ error: 'Invalid order id' }, { status: 400 })
  }

  // ── 2. Auth gate ──────────────────────────────────────────────
  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const appRole = typeof session.user.user_metadata['app_role'] === 'string'
    ? session.user.user_metadata['app_role'] as string
    : null

  if (!appRole || !(CLINIC_APP_ROLES as readonly string[]).includes(appRole)) {
    return NextResponse.json(
      { error: 'Only clinic users can combine and send payment links' },
      { status: 403 },
    )
  }

  const clinicId = typeof session.user.user_metadata['clinic_id'] === 'string'
    ? session.user.user_metadata['clinic_id'] as string
    : null
  if (!clinicId) {
    return NextResponse.json({ error: 'Session missing clinic_id' }, { status: 400 })
  }

  // ── 3. Body validation ────────────────────────────────────────
  let body: GroupAndSendBody
  try {
    body = await request.json() as GroupAndSendBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!Array.isArray(body.siblingOrderIds)) {
    return NextResponse.json({ error: 'siblingOrderIds must be an array' }, { status: 400 })
  }
  if (body.siblingOrderIds.length < 1) {
    return NextResponse.json({ error: 'At least one sibling order is required to form a group' }, { status: 400 })
  }
  // Anchor + siblings; cap at 25 total (matches Stage 2 cap).
  if (body.siblingOrderIds.length > 24) {
    return NextResponse.json({ error: 'A payment group cannot contain more than 25 orders' }, { status: 400 })
  }
  for (const id of body.siblingOrderIds) {
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: `Invalid sibling order id: ${id}` }, { status: 400 })
    }
    if (id === anchorOrderId) {
      return NextResponse.json({ error: 'siblingOrderIds must not include the anchor order' }, { status: 400 })
    }
  }
  const allIds = [anchorOrderId, ...body.siblingOrderIds]
  const uniq = new Set(allIds)
  if (uniq.size !== allIds.length) {
    return NextResponse.json({ error: 'siblingOrderIds contains duplicates' }, { status: 400 })
  }

  // ── 4. Bundle ─────────────────────────────────────────────────
  const supabase = createServiceClient()
  const result = await createPaymentGroup({
    supabase,
    clinicId,
    callerAppRole: appRole as ClinicAppRole,
    callerUserId:  session.user.id,
    orderIds:      allIds,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  // ── 5. Issue group checkout token ─────────────────────────────
  let token: string
  try {
    token = await generateGroupCheckoutToken(
      result.groupId,
      result.patientId,
      clinicId,
    )
  } catch (err) {
    console.error(
      `[group-and-send] token generation failed | group=${result.groupId}:`,
      err instanceof Error ? err.message : err,
    )
    // The group + PI exist; the caller can retry via the regular fetch.
    return NextResponse.json({ error: 'Failed to generate payment link for group' }, { status: 500 })
  }

  const checkoutUrl = `${serverEnv.appBaseUrl().replace(/\/$/, '')}/checkout/${token}`
  const expiresAt = new Date(Date.now() + serverEnv.checkoutTokenExpiry() * 1000).toISOString()

  console.info(
    `[group-and-send] generated | group=${result.groupId} anchor=${anchorOrderId} orders=${result.orderCount} clinic=${clinicId}`,
  )

  return NextResponse.json(
    {
      checkoutUrl,
      expiresAt,
      groupId:               result.groupId,
      stripePaymentIntentId: result.stripePaymentIntentId,
      totalCents:            result.totalCents,
      orderCount:            result.orderCount,
    },
    { status: 201, headers: { 'Cache-Control': 'no-store' } },
  )
}

export function GET()    { return new NextResponse(null, { status: 405 }) }
export function PUT()    { return new NextResponse(null, { status: 405 }) }
export function PATCH()  { return new NextResponse(null, { status: 405 }) }
export function DELETE() { return new NextResponse(null, { status: 405 }) }
