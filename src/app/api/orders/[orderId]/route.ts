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
import { refuseCrossSite } from '@/lib/security/same-origin'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { refuseUnlessApproved } from '@/lib/onboarding/approval-guard'
import { logPhiAccess, logPhiWriteNotCompleted, type PhiAccessEntry, type PhiUser } from '@/lib/audit/phi-access'
import { phiWriteRefused } from '@/lib/audit/phi-write'
import { RX_DETAIL_COLUMN_LIST, dispenseCount, rxDetailsToColumns, validateRxDetailsBody } from '@/lib/orders/rx-details'
import { resolveLine, lineSourceKind } from '@/lib/orders/resolve-line'
import { canEditDraft, diffDraftRows, writeDraftAudit } from '@/lib/orders/draft-edit'
import { checkProviderOwnsDraft } from '@/lib/orders/provider-draft-guard'
import { reallocateDraftSiblingShipping } from '@/lib/orders/apply-bundle-shipping'
import { parseTitrationSteps, isSigMode } from '@/lib/orders/titration'
import { cyclePatternFrom } from '@/lib/orders/cycling'
import type { Json } from '@/types/database.types'
import { getUserClinicId, getUserRole, isClinicStaffRole } from '@/lib/auth/claims'
import { revokeProposalLinkForOrder } from '@/lib/proposals/propose'
import { withApiErrors } from '@/lib/api/with-api-errors'
import { z } from 'zod'
import { parseParams, parseInput, uuid } from '@/lib/api/input'
import { lineBodySchema } from '@/lib/orders/line-body-schema'

interface RouteContext {
  params: Promise<{ orderId: string }>
}

const DRAFT_SELECT = `order_id, status, clinic_id, patient_id, provider_id, formulation_id, catalog_item_id, pharmacy_id,
  retail_price_snapshot, wholesale_price_snapshot, medication_snapshot, pharmacy_snapshot, sig_text,
  shipping_state_snapshot, package_id, package_label, package_count, payment_group_id,
  sig_mode, titration_steps, cycle_on_days, cycle_off_days, proposal_option_id, ${RX_DETAIL_COLUMN_LIST}`

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

const paramsSchema = z.object({ orderId: uuid() })

type Caller = { actor: Actor; user: PhiUser; orderId: string }

/**
 * Who is calling (verified user, clinic, approval), then the order id:
 * both before anything about the order is read. A bad id is a 400 here,
 * never a Postgres 22P02 500.
 */
async function authenticate(context: RouteContext): Promise<
  | { ok: true; caller: Caller }
  | { ok: false; response: NextResponse }
> {
  const supabaseAuth = await createServerClient()
  // getUser() verifies the token with Supabase; a cookie session alone is not trusted.
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  // Clinic staff only: any other role, or none, is refused before anything is read.
  if (!isClinicStaffRole(getUserRole(user))) {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  const clinicId = getUserClinicId(user) ?? null
  if (!clinicId) {
    return { ok: false, response: NextResponse.json({ error: 'Session missing clinic_id' }, { status: 400 }) }
  }
  // Pending review: nothing is ordered, signed or sent until ops approves
  // the clinic (lib/onboarding/approval-guard).
  const pendingReview = await refuseUnlessApproved(createServiceClient(), clinicId)
  if (pendingReview) return { ok: false, response: pendingReview }
  const role = getUserRole(user) ?? null
  const actor: Actor = { userId: user.id, role, clinicId }

  const parsed = await parseParams(context, paramsSchema)
  if (!parsed.ok) return { ok: false, response: parsed.response }

  return { ok: true, caller: { actor, user, orderId: parsed.data.orderId } }
}

/** Load the draft (clinic-scoped, active) + permission, for an authenticated caller. */
async function loadEditableDraft({ actor, user, orderId }: Caller): Promise<
  | { ok: true; actor: Actor; draft: DraftRow; supabase: ReturnType<typeof createServiceClient>; user: PhiUser }
  | { ok: false; response: NextResponse }
> {
  const { clinicId, role } = actor
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
  // WO-99: a draft linked to a payment group is being signed with the
  // patient's other drafts right now. Batch signing links the group
  // before it signs, so a change here would land between the checks and
  // the signature.
  if ((draft as { payment_group_id?: string | null }).payment_group_id) {
    return { ok: false, response: NextResponse.json({ error: 'This draft is being signed right now and cannot be changed.' }, { status: 409 }) }
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

  return { ok: true, actor, draft: draft as unknown as DraftRow, supabase, user: user }
}

/**
 * Patient protocol choice: a line in a plan sent to the patient changed,
 * so the plan's link stops working until it is sent again (which runs
 * every signing check again). Lines in no plan touch no proposal.
 */
async function revokeLinkIfProposed(supabase: ReturnType<typeof createServiceClient>, clinicId: string, draft: DraftRow): Promise<void> {
  if (!(draft as { proposal_option_id?: string | null }).proposal_option_id) return
  await revokeProposalLinkForOrder(supabase, { clinicId, orderId: draft.order_id })
}

async function patchHandler(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const crossSite = refuseCrossSite(request)
  if (crossSite) return crossSite
  // Who is calling first; then the body; then the draft.
  const auth = await authenticate(context)
  if (!auth.ok) return auth.response
  const { orderId } = auth.caller

  type EditLineBody = {
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
    sigMode?:       unknown
    titrationSteps?: unknown
    cycleOnDays?:   unknown
    cycleOffDays?:  unknown
  }
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  // Ids, text bounds and the sig mode (lib/orders/line-body-schema); the
  // prescription rules below keep their own messages.
  const shape = parseInput(lineBodySchema, raw)
  if (!shape.ok) return shape.response
  const body = shape.data as unknown as EditLineBody

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

  // The sig mode travels with the edit, same rules as POST /api/orders.
  // Before this, an edit never wrote it: a cycling draft reopened to
  // enter its missing days on / off saved the corrected quantity but
  // lost the pattern the provider typed. A body without sigMode (a
  // client that predates it) leaves the stored mode untouched.
  let modeColumns: Record<string, unknown> = {}
  if (body.sigMode !== undefined) {
    const sigMode = isSigMode(body.sigMode) ? body.sigMode : 'standard'
    const cyclePattern = sigMode === 'cycling' ? cyclePatternFrom(body.cycleOnDays, body.cycleOffDays) : null
    if (sigMode === 'cycling' && !cyclePattern) {
      return NextResponse.json({
        error: 'A cycling prescription needs its days on and days off (1 to 365 each). Edit the line to enter them.',
        code:  'CYCLE_PATTERN_REQUIRED',
      }, { status: 400 })
    }
    modeColumns = {
      sig_mode:        sigMode,
      titration_steps: (sigMode === 'titration' ? parseTitrationSteps(body.titrationSteps) : []) as unknown as Json,
      cycle_on_days:   cyclePattern?.onDays ?? null,
      cycle_off_days:  cyclePattern?.offDays ?? null,
    }
  }

  const loaded = await loadEditableDraft(auth.caller)
  if (!loaded.ok) return loaded.response
  const { actor, draft, supabase } = loaded

  const patientState = draft.shipping_state_snapshot ?? ''
  if (!/^[A-Z]{2}$/.test(patientState)) {
    return NextResponse.json({ error: 'Draft has no shipping state' }, { status: 422 })
  }

  const line = await resolveLine(supabase, {
    catalogItemId, formulationId, pharmacyId, patientState,
    prescribedDose: dose, frequencyCode, quantityLabel, packageId, packageCount,
    // The package must be sizable against this dispense (PACKAGE_UNIT_MISMATCH).
    dispense: { quantity: rxDetailsValidation.details.dispenseQuantity, unit: rxDetailsValidation.details.dispenseUnit },
  })
  if (!line.ok) {
    return NextResponse.json({ error: line.error, ...(line.code ? { code: line.code } : {}) }, { status: line.status })
  }
  if (retailCents < line.wholesaleCents) {
    return NextResponse.json(
      { error: `retail price must be >= wholesale ($${(line.wholesaleCents / 100).toFixed(2)})` },
      { status: 422 }
    )
  }

  const rxDetailColumns = rxDetailsToColumns(rxDetailsValidation.details)
  const update = {
    catalog_item_id:          sourceKind === 'catalog' ? (catalogItemId as string) : null,
    formulation_id:           sourceKind === 'formulation' ? (formulationId as string) : null,
    pharmacy_id:              pharmacyId,
    wholesale_price_snapshot: line.wholesaleCents / 100,
    retail_price_snapshot:    retailCents / 100,
    medication_snapshot:      line.medicationSnapshot,
    pharmacy_snapshot:        line.pharmacySnapshot,
    sig_text:                 sigTrimmed,
    ...rxDetailColumns,
    // WO-101
    ...line.package,
    // What the pharmacy dispenses, counted as the Dispense line states it.
    quantity:                 dispenseCount({ ...rxDetailColumns, ...line.package }),
    ...modeColumns,
  }

  const diff = diffDraftRows(draft, update)
  const owner = draft as unknown as { patient_id: string; provider_id: string }

  // Compliance C2 and L1 (B15): a patient's prescription changes. Logged
  // BEFORE the update; no row, no change (503).
  const phiEntry: PhiAccessEntry = {
    user: loaded.user, action: 'update', resource: 'order', route: '/api/orders/[orderId]',
    orderId, patientId: owner.patient_id, headers: request.headers ?? null,
  }
  if (!(await logPhiAccess(phiEntry))) return phiWriteRefused()

  const { error: updateError } = await supabase
    .from('orders')
    .update(update)
    .eq('order_id', orderId)
    .eq('status', 'DRAFT')

  if (updateError) {
    console.error('[orders/edit] draft update failed:', updateError.message)
    await logPhiWriteNotCompleted(phiEntry)
    return NextResponse.json({ error: 'Failed to update draft' }, { status: 500 })
  }

  await revokeLinkIfProposed(supabase, actor.clinicId, draft)

  // WO-102: a changed pharmacy or shipping type moves shipping between
  // this patient's draft lines — re-allocate once per pharmacy.
  await reallocateDraftSiblingShipping(supabase, actor.clinicId, owner.patient_id, owner.provider_id)

  await writeDraftAudit(supabase, orderId, {
    event: 'draft_edited',
    actor: { user_id: actor.userId, role: actor.role },
    diff,
  })

  console.info(`[orders/edit] DRAFT edited | order=${orderId} | fields=${Object.keys(diff).length}`)
  return NextResponse.json({ orderId, changed: Object.keys(diff) }, { status: 200 })
}

async function deleteHandler(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const crossSite = refuseCrossSite(request)
  if (crossSite) return crossSite
  const auth = await authenticate(context)
  if (!auth.ok) return auth.response
  const { orderId } = auth.caller

  const loaded = await loadEditableDraft(auth.caller)
  if (!loaded.ok) return loaded.response
  const { actor, draft, supabase } = loaded
  const owner = draft as unknown as { patient_id: string; provider_id: string }

  // Compliance C2 and L1 (B15): removing a draft line changes the
  // patient's prescriptions. Logged BEFORE the soft delete; no row, no
  // change (503).
  const phiEntry: PhiAccessEntry = {
    user: loaded.user, action: 'update', resource: 'order', route: '/api/orders/[orderId]',
    orderId, patientId: owner.patient_id, headers: request.headers ?? null,
  }
  if (!(await logPhiAccess(phiEntry))) return phiWriteRefused()

  // REQ-OAS-010: soft delete only.
  const { error: deleteError } = await supabase
    .from('orders')
    .update({ is_active: false, deleted_at: new Date().toISOString() })
    .eq('order_id', orderId)
    .eq('status', 'DRAFT')

  if (deleteError) {
    console.error('[orders/edit] draft soft-delete failed:', deleteError.message)
    await logPhiWriteNotCompleted(phiEntry)
    return NextResponse.json({ error: 'Failed to remove draft' }, { status: 500 })
  }

  await revokeLinkIfProposed(supabase, actor.clinicId, draft)

  // WO-102: the removed line may have carried its pharmacy's shipping.
  await reallocateDraftSiblingShipping(supabase, actor.clinicId, owner.patient_id, owner.provider_id)

  await writeDraftAudit(supabase, orderId, {
    event: 'draft_line_removed',
    actor: { user_id: actor.userId, role: actor.role },
  })

  console.info(`[orders/edit] DRAFT soft-deleted | order=${orderId}`)
  return NextResponse.json({ orderId, removed: true }, { status: 200 })
}

export const PATCH = withApiErrors('/api/orders/[orderId]', patchHandler)
export const DELETE = withApiErrors('/api/orders/[orderId]', deleteHandler)
