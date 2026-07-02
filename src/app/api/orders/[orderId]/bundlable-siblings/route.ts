// ============================================================
// Phase C Stage 4 — GET /api/orders/[orderId]/bundlable-siblings
// ============================================================
//
// Returns the list of OTHER orders in the caller's clinic that could
// be bundled into a payment_group with the given anchor order. The
// drawer renders these as opt-in checkboxes inside the "Combine and
// Send" flow.
//
// Eligibility (matches createPaymentGroup invariants):
//   - same clinic_id  (RLS + explicit eq)
//   - same patient_id
//   - same provider_id
//   - status = AWAITING_PAYMENT
//   - payment_group_id IS NULL
//   - stripe_payment_intent_id IS NULL  (no solo PI)
//   - deleted_at IS NULL
//   - NOT the anchor itself
//
// The anchor order itself must satisfy the same constraints; otherwise
// the response signals not-bundlable so the drawer can hide the button.
//
// Returned shape — minimal fields needed to render checkboxes:
//   { anchorBundlable: boolean, anchor?: {...}, siblings: [...] }
// Each sibling: { orderId, medicationName, retailPrice, createdAt }.
// No PHI beyond medication name — same surface level as the current
// order drawer already shows.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient }        from '@/lib/supabase/server'
import { createServiceClient }       from '@/lib/supabase/service'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CLINIC_APP_ROLES = ['clinic_admin', 'provider', 'medical_assistant'] as const

interface RouteParams {
  params: Promise<{ orderId: string }>
}

export async function GET(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  if (process.env['PHASE_C_GROUPS_ENABLED'] !== 'true') {
    // Hide the feature entirely until the flag flips. Drawer treats
    // 503 the same as "not bundlable" — no UI surfaces.
    return NextResponse.json(
      { anchorBundlable: false, siblings: [], reason: 'feature_disabled' },
      { status: 503 },
    )
  }

  const { orderId } = await params
  if (!UUID_RE.test(orderId)) {
    return NextResponse.json({ error: 'Invalid order id' }, { status: 400 })
  }

  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const appRole = typeof session.user.user_metadata['app_role'] === 'string'
    ? session.user.user_metadata['app_role'] as string
    : null

  if (!appRole || !(CLINIC_APP_ROLES as readonly string[]).includes(appRole)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const clinicId = typeof session.user.user_metadata['clinic_id'] === 'string'
    ? session.user.user_metadata['clinic_id'] as string
    : null
  if (!clinicId) {
    return NextResponse.json({ error: 'Session missing clinic_id' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Load anchor first — establishes patient_id / provider_id and
  // verifies the anchor itself is bundlable.
  const { data: anchor, error: anchorErr } = await supabase
    .from('orders')
    .select(`
      order_id, status, patient_id, provider_id, clinic_id,
      payment_group_id, stripe_payment_intent_id,
      medication_snapshot, retail_price_snapshot, created_at
    `)
    .eq('order_id', orderId)
    .eq('clinic_id', clinicId)
    .is('deleted_at', null)
    .maybeSingle()

  if (anchorErr) {
    console.error(`[bundlable-siblings] anchor fetch failed | order=${orderId}:`, anchorErr.message)
    return NextResponse.json({ error: 'Order lookup failed' }, { status: 500 })
  }

  if (!anchor) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  const anchorBundlable =
    anchor.status === 'AWAITING_PAYMENT' &&
    anchor.payment_group_id === null    &&
    anchor.stripe_payment_intent_id === null

  if (!anchorBundlable) {
    return NextResponse.json(
      {
        anchorBundlable: false,
        siblings: [],
        reason:
          anchor.payment_group_id ? 'already_grouped'
          : anchor.stripe_payment_intent_id ? 'solo_pi_exists'
          : `status_${anchor.status}`,
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  // Find peers
  const { data: peers, error: peersErr } = await supabase
    .from('orders')
    .select(`
      order_id, medication_snapshot, retail_price_snapshot, created_at
    `)
    .eq('clinic_id',   clinicId)
    .eq('patient_id',  anchor.patient_id)
    .eq('provider_id', anchor.provider_id)
    .eq('status',      'AWAITING_PAYMENT')
    .is('payment_group_id',         null)
    .is('stripe_payment_intent_id', null)
    .is('deleted_at',               null)
    .neq('order_id', orderId)
    .order('created_at', { ascending: true })

  if (peersErr) {
    console.error(`[bundlable-siblings] peer fetch failed | order=${orderId}:`, peersErr.message)
    return NextResponse.json({ error: 'Sibling lookup failed' }, { status: 500 })
  }

  return NextResponse.json(
    {
      anchorBundlable: true,
      anchor: {
        orderId:        anchor.order_id,
        medicationName: extractMedicationName(anchor.medication_snapshot),
        retailPrice:    anchor.retail_price_snapshot,
        createdAt:      anchor.created_at,
      },
      siblings: (peers ?? []).map(p => ({
        orderId:        p.order_id,
        medicationName: extractMedicationName(p.medication_snapshot),
        retailPrice:    p.retail_price_snapshot,
        createdAt:      p.created_at,
      })),
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  )
}

// medication_snapshot is the source of truth for the compound name. Older
// rows or hand-inserted rows may have it shaped { name } or { medication_name };
// stay tolerant.
function extractMedicationName(snapshot: unknown): string {
  if (snapshot && typeof snapshot === 'object') {
    const s = snapshot as Record<string, unknown>
    if (typeof s['name']            === 'string') return s['name']
    if (typeof s['medication_name'] === 'string') return s['medication_name']
    if (typeof s['display_name']    === 'string') return s['display_name']
  }
  return 'Compounded prescription'
}

export function POST()   { return new NextResponse(null, { status: 405 }) }
export function PUT()    { return new NextResponse(null, { status: 405 }) }
export function PATCH()  { return new NextResponse(null, { status: 405 }) }
export function DELETE() { return new NextResponse(null, { status: 405 }) }
