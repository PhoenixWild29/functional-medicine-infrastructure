// ============================================================
// Edit / remove a DRAFT order line — WO-98
// PATCH  /api/orders/[orderId]   — update the draft in place
// DELETE /api/orders/[orderId]   — soft-delete the draft line
// ============================================================
//
// Both verbs touch DRAFT orders only (409 for any other status), keep
// the order_id, and append one DRAFT → DRAFT row to order_status_history
// with { event, actor, diff } so the audit trail shows who changed what.
//
// Permission (enforced here, not just in the UI):
//   - provider: any draft in their clinic
//   - any other clinic role: only drafts they created (draft_created
//     audit row with them as the actor) → 403 otherwise
//
// PATCH body — same line shape POST /api/orders takes, minus the
// pinned patient/provider:
//   { catalogItemId? | formulationId?, pharmacyId, retailCents, sigText,
//     rxDetails?, dose?, frequencyCode?, quantityLabel?, packageId?, packageCount? }
//
// REQ-OAS-010: DELETE is a soft delete (is_active = false, deleted_at).

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { RX_DETAIL_COLUMN_LIST, rxDetailsToColumns, validateRxDetailsBody } from '@/lib/orders/rx-details'
import { resolveLine, lineSourceKind } from '@/lib/orders/resolve-line'
import { canEditDraft, diffDraftRows, writeDraftAudit } from '@/lib/orders/draft-edit'
import { checkProviderOwnsDraft } from '@/lib/orders/provider-draft-guard'
import { reallocateDraftSiblingShipping } from '@/lib/orders/apply-bundle-shipping'

interface RouteContext {
  params: Promise<{ orderId: string }>
}

const DRAFT_SELECT = `order_id, status, clinic_id, patient_id, provider_id, formulation_id, catalog_item_id, pharmacy_id,
  retail_price_snapshot, wholesale_price_snapshot, medication_snapshot, pharmacy_snapshot, sig_text,
  shipping_state_snapshot, package_id, package_label, package_count, ${RX_DETAIL_COLUMN_LIST}`

interface Actor {
  userId:   string
  role:     string | null
  clinicId: string
}

type DraftRow = Record<string, unknown> & {
  order_id: string
  status: string
  shipping_state_snapshot: string | null
}

/** Auth + load the draft (clinic-scoped, active) + permission. */
async function loadEditableDraft(orderId: string): Promise<
  | { ok: true; actor: Actor; draft: DraftRow; supabase: ReturnType<typeof createServiceClient> }
  | { ok: false; response: NextResponse }
> {
  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  const clinicId = typeof session.user.user_metadata['clinic_id'] === 'string'
    ? session.user.user_metadata['clinic_id'] as string
    : null
  if (!clinicId) {
    return { ok: false, response: NextResponse.json({ error: 'Session missing clinic_id' }, { status: 400 }) }
  }
  const role = typeof session.user.user_metadata['app_role'] === 'string'
    ? session.user.user_metadata['app_role'] as string
    : null
  const actor: Actor = { userId: session.user.id, role, clinicId }

  if (!orderId) {
    return { ok: false, response: NextResponse.json({ error: 'orderId required' }, { status: 400 }) }
  }

  const supabase = createServiceClient()
  const { data: draft, error } = await supabase
    .from('orders')
    .select(DRAFT_SELECT)
    .eq('order_id', orderId)
    .eq('clinic_id', clinicId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) {
    console.error('[orders/edit] draft fetch failed:', error.message)
    return { ok: false, response: NextResponse.json({ error: 'Failed to load order' }, { status: 500 }) }
  }
  if (!draft) {
    return { ok: false, response: NextResponse.json({ error: 'Order not found' }, { status: 404 }) }
  }
  if (draft.status !== 'DRAFT') {
    return { ok: false, response: NextResponse.json({ error: 'Only DRAFT orders can be edited' }, { status: 409 }) }
  }

  // WO-100: a provider may only edit / remove lines on a draft under their
  // own name; another provider's draft must be reassigned via Sign as me
  // first. Same check as POST /api/orders. MA / clinic admin: not affected
  // here — WO-98's creator rule below still applies to them.
  const ownership = await checkProviderOwnsDraft(supabase, {
    appRole:         role,
    userId:          actor.userId,
    clinicId,
    draftProviderId: (draft as { provider_id?: string | null }).provider_id ?? null,
  })
  if (!ownership.ok) {
    if (ownership.reason === 'other_provider') {
      console.warn(`[orders/edit] provider-role session attempted to change another provider's draft | order=${orderId}`)
    }
    return { ok: false, response: NextResponse.json(ownership.body, { status: ownership.status }) }
  }

  const allowed = await canEditDraft(supabase, orderId, { userId: actor.userId, role: actor.role })
  if (!allowed) {
    return { ok: false, response: NextResponse.json({ error: 'You can only edit drafts you created' }, { status: 403 }) }
  }

  return { ok: true, actor, draft: draft as unknown as DraftRow, supabase }
}

export async function PATCH(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { orderId } = await context.params

  let body: {
    catalogItemId?: string | null
    formulationId?: string | null
    pharmacyId:     string
    retailCents:    number
    sigText:        string
    rxDetails?:     unknown
    dose?:          string | null
    frequencyCode?: string | null
    quantityLabel?: string | null
    packageId?:     string | null
    packageCount?:  number | null
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { catalogItemId, formulationId, pharmacyId, retailCents, sigText, rxDetails, dose, frequencyCode, quantityLabel, packageId, packageCount } = body

  if (!pharmacyId || typeof sigText !== 'string') {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }
  const sourceKind = lineSourceKind({ catalogItemId, formulationId })
  if (!sourceKind) {
    return NextResponse.json({ error: 'Exactly one of catalogItemId or formulationId is required' }, { status: 400 })
  }
  if (typeof retailCents !== 'number' || !Number.isInteger(retailCents) || retailCents <= 0) {
    return NextResponse.json({ error: 'retailCents must be a positive integer (cents)' }, { status: 400 })
  }
  const sigTrimmed = sigText.trim()
  if (sigTrimmed.length < 10) {
    return NextResponse.json({ error: 'sigText must be at least 10 characters' }, { status: 400 })
  }
  const rxDetailsValidation = validateRxDetailsBody(rxDetails)
  if (!rxDetailsValidation.ok) {
    return NextResponse.json({ error: rxDetailsValidation.error }, { status: 400 })
  }

  const loaded = await loadEditableDraft(orderId)
  if (!loaded.ok) return loaded.response
  const { actor, draft, supabase } = loaded

  const patientState = draft.shipping_state_snapshot ?? ''
  if (!/^[A-Z]{2}$/.test(patientState)) {
    return NextResponse.json({ error: 'Draft has no shipping state' }, { status: 422 })
  }

  const line = await resolveLine(supabase, {
    catalogItemId, formulationId, pharmacyId, patientState,
    prescribedDose: dose, frequencyCode, quantityLabel, packageId, packageCount,
  })
  if (!line.ok) {
    return NextResponse.json({ error: line.error }, { status: line.status })
  }
  if (retailCents < line.wholesaleCents) {
    return NextResponse.json(
      { error: `retail price must be >= wholesale ($${(line.wholesaleCents / 100).toFixed(2)})` },
      { status: 422 }
    )
  }

  const update = {
    catalog_item_id:          sourceKind === 'catalog' ? (catalogItemId as string) : null,
    formulation_id:           sourceKind === 'formulation' ? (formulationId as string) : null,
    pharmacy_id:              pharmacyId,
    wholesale_price_snapshot: line.wholesaleCents / 100,
    retail_price_snapshot:    retailCents / 100,
    medication_snapshot:      line.medicationSnapshot,
    pharmacy_snapshot:        line.pharmacySnapshot,
    sig_text:                 sigTrimmed,
    ...rxDetailsToColumns(rxDetailsValidation.details),
    // WO-101
    ...line.package,
  }

  const diff = diffDraftRows(draft, update)

  const { error: updateError } = await supabase
    .from('orders')
    .update(update)
    .eq('order_id', orderId)
    .eq('status', 'DRAFT')

  if (updateError) {
    console.error('[orders/edit] draft update failed:', updateError.message)
    return NextResponse.json({ error: 'Failed to update draft' }, { status: 500 })
  }

  // WO-102: a changed pharmacy or shipping type moves shipping between
  // this patient's draft lines — re-allocate once per pharmacy.
  const owner = draft as unknown as { patient_id: string; provider_id: string }
  await reallocateDraftSiblingShipping(supabase, actor.clinicId, owner.patient_id, owner.provider_id)

  await writeDraftAudit(supabase, orderId, {
    event: 'draft_edited',
    actor: { user_id: actor.userId, role: actor.role },
    diff,
  })

  console.info(`[orders/edit] DRAFT edited | order=${orderId} | fields=${Object.keys(diff).length}`)
  return NextResponse.json({ orderId, changed: Object.keys(diff) }, { status: 200 })
}

export async function DELETE(_request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { orderId } = await context.params

  const loaded = await loadEditableDraft(orderId)
  if (!loaded.ok) return loaded.response
  const { actor, draft, supabase } = loaded

  // REQ-OAS-010: soft delete only.
  const { error: deleteError } = await supabase
    .from('orders')
    .update({ is_active: false, deleted_at: new Date().toISOString() })
    .eq('order_id', orderId)
    .eq('status', 'DRAFT')

  if (deleteError) {
    console.error('[orders/edit] draft soft-delete failed:', deleteError.message)
    return NextResponse.json({ error: 'Failed to remove draft' }, { status: 500 })
  }

  // WO-102: the removed line may have carried its pharmacy's shipping.
  const owner = draft as unknown as { patient_id: string; provider_id: string }
  await reallocateDraftSiblingShipping(supabase, actor.clinicId, owner.patient_id, owner.provider_id)

  await writeDraftAudit(supabase, orderId, {
    event: 'draft_line_removed',
    actor: { user_id: actor.userId, role: actor.role },
  })

  console.info(`[orders/edit] DRAFT soft-deleted | order=${orderId}`)
  return NextResponse.json({ orderId, removed: true }, { status: 200 })
}
