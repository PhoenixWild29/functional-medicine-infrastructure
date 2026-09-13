// ============================================================
// Create Draft Order — WO-29
// POST /api/orders
// ============================================================
//
// REQ-OAS-001: Creates an order in DRAFT status with all fields set.
// REQ-OAS-008: Zero PHI in Stripe — no PHI stored in Stripe metadata.
// REQ-OAS-010: No physical DELETE — orders use deleted_at soft delete.
//
// Request body:
//   { patientId, providerId, catalogItemId, pharmacyId,
//     retailCents, sigText, patientState, rxDetails? }
//
// WO-96: rxDetails carries the per-Rx detail fields (days supply,
// dispense, refills, substitution, syringe kit, shipping, clinical
// difference, diagnosis, special instructions). Absent → defaults, so
// older clients keep working. Rule enforcement (controlled → diagnosis,
// requires_clinical_difference → clinical difference) happens at
// sign-and-send; a DRAFT may be saved incomplete for the provider to
// finish.
//
// Response: { orderId: string }
//
// Auth: Requires active Clinic App session.
// The order is created in DRAFT; snapshot fields are set now and
// frozen (by prevent_snapshot_mutation trigger) at AWAITING_PAYMENT.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveProtocolLinkage, type ProtocolLinkage } from '@/lib/protocols/resolve-instance'
import { rxDetailsToColumns, validateRxDetailsBody } from '@/lib/orders/rx-details'
import { lineSourceKind, resolveLine } from '@/lib/orders/resolve-line'
import { writeDraftAudit } from '@/lib/orders/draft-edit'

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Auth gate
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
  const appRole = typeof session.user.user_metadata['app_role'] === 'string'
    ? session.user.user_metadata['app_role'] as string
    : null

  // WO-87 (B1 hotfix): Accept EITHER a legacy catalog item OR a V3.0
  // formulation. The cascading prescription builder produces a
  // formulationId; the legacy pharmacy-search flow produces a
  // catalogItemId. Exactly one must be set.
  let body: {
    patientId:      string
    providerId:     string
    catalogItemId?: string | null
    formulationId?: string | null
    pharmacyId:     string
    retailCents:    number
    sigText:        string
    patientState:   string
    // GAP-3: optional — set only when the session line was quick-loaded
    // from a protocol. Drives protocol_instance/version linkage below.
    protocolId?:    string | null
    // WO-96: optional — validated by validateRxDetailsBody.
    rxDetails?:     unknown
    // WO-98: optional builder inputs kept on medication_snapshot so a
    // draft reopens in the builder with its current values.
    dose?:          string | null
    frequencyCode?: string | null
    quantityLabel?: string | null
    // WO-98: set when "+ Add prescription" appends a line to an existing
    // draft; recorded on the audit row only.
    appendedToOrderId?: string | null
  }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { patientId, providerId, catalogItemId, formulationId, pharmacyId, retailCents, sigText, patientState, protocolId, rxDetails, dose, frequencyCode, quantityLabel, appendedToOrderId } = body

  if (!patientId || !providerId || !pharmacyId || !sigText || !patientState) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const sourceKind = lineSourceKind({ catalogItemId, formulationId })
  if (!sourceKind) {
    return NextResponse.json(
      { error: 'Exactly one of catalogItemId or formulationId is required' },
      { status: 400 }
    )
  }
  const hasCatalog     = sourceKind === 'catalog'
  const hasFormulation = sourceKind === 'formulation'

  // NB-03: explicit typeof guard before Number.isInteger to catch string "500" vs number 500
  if (typeof retailCents !== 'number' || !Number.isInteger(retailCents) || retailCents <= 0) {
    return NextResponse.json({ error: 'retailCents must be a positive integer (cents)' }, { status: 400 })
  }

  const sigTrimmed = sigText.trim()
  if (sigTrimmed.length < 10) {
    return NextResponse.json({ error: 'sigText must be at least 10 characters' }, { status: 400 })
  }

  if (!/^[A-Z]{2}$/.test(patientState)) {
    return NextResponse.json({ error: 'patientState must be a 2-letter US state code' }, { status: 400 })
  }

  // WO-96: per-Rx detail fields. Missing object → defaults.
  const rxDetailsValidation = validateRxDetailsBody(rxDetails)
  if (!rxDetailsValidation.ok) {
    return NextResponse.json({ error: rxDetailsValidation.error }, { status: 400 })
  }
  const rxDetailColumns = rxDetailsToColumns(rxDetailsValidation.details)

  const supabase = createServiceClient()

  // ── Resolve medication + pharmacy (+ state licence) ──────
  // WO-98: shared with PATCH /api/orders/[orderId] so editing a draft
  // re-validates a changed line exactly like creating one.
  const line = await resolveLine(supabase, {
    catalogItemId, formulationId, pharmacyId, patientState,
    prescribedDose: dose, frequencyCode, quantityLabel,
  })
  if (!line.ok) {
    return NextResponse.json({ error: line.error }, { status: line.status })
  }
  const { wholesaleCents, medicationSnapshot, pharmacySnapshot } = line

  // Validate retail >= wholesale (belt + suspenders over the DB CHECK constraint)
  if (retailCents < wholesaleCents) {
    return NextResponse.json(
      { error: `retail price must be >= wholesale ($${(wholesaleCents / 100).toFixed(2)})` },
      { status: 422 }
    )
  }

  // Fetch provider — must belong to this clinic
  const { data: provider, error: providerError } = await supabase
    .from('providers')
    .select('provider_id, npi_number, clinic_id')
    .eq('provider_id', providerId)
    .eq('clinic_id', clinicId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .maybeSingle()

  if (providerError || !provider) {
    console.error('[orders] provider fetch failed:', providerError?.message)
    return NextResponse.json({ error: 'Provider not found' }, { status: 404 })
  }

  // Fetch patient — must belong to this clinic
  const { data: patient, error: patientError } = await supabase
    .from('patients')
    .select('patient_id, clinic_id')
    .eq('patient_id', patientId)
    .eq('clinic_id', clinicId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .maybeSingle()

  if (patientError || !patient) {
    console.error('[orders] patient fetch failed:', patientError?.message)
    return NextResponse.json({ error: 'Patient not found' }, { status: 404 })
  }

  // REQ-CAD-002: Block order creation when clinic stripe onboarding is incomplete
  const { data: clinic, error: clinicError } = await supabase
    .from('clinics')
    .select('order_intake_blocked, stripe_connect_status')
    .eq('clinic_id', clinicId)
    .is('deleted_at', null)
    .maybeSingle()

  if (clinicError || !clinic) {
    console.error('[orders] clinic fetch failed:', clinicError?.message)
    return NextResponse.json({ error: 'Clinic not found' }, { status: 404 })
  }

  if (clinic.order_intake_blocked || clinic.stripe_connect_status !== 'ACTIVE') {
    return NextResponse.json(
      { error: 'Order intake is blocked — complete Stripe onboarding in Settings' },
      { status: 422 }
    )
  }

  // HC-01: convert integer cents back to NUMERIC(10,2) for storage
  const retailPrice     = retailCents / 100
  const wholesalePrice  = wholesaleCents / 100

  // ── GAP-3: protocol → order linkage (instrumentation) ────────
  // When the prescription line was quick-loaded from a protocol, link
  // the order to the patient's protocol_instance and the protocol's
  // published version so the pilot validation gates (protocol reuse,
  // clarification rate by version, 90-day retention) have data.
  //
  // FAILURE POSTURE: linkage is instrumentation, not clinical flow.
  // resolveProtocolLinkage never throws (and this is belt-and-
  // suspenders wrapped anyway); on any failure the order is created
  // WITHOUT linkage rather than blocking prescribing.
  //
  // Runs after the patient/provider/clinic guards above, so patientId,
  // providerId and clinicId are already validated against the session
  // clinic. The composite FK fk_orders_protocol_instance requires the
  // instance to belong to this same patientId — guaranteed because the
  // resolver looks up/creates the instance for exactly that patient.
  let protocolLinkage: ProtocolLinkage | null = null
  if (typeof protocolId === 'string' && protocolId.length > 0) {
    try {
      protocolLinkage = await resolveProtocolLinkage({
        supabase,
        protocolId,
        patientId,
        providerId,
        clinicId,
      })
    } catch (err) {
      protocolLinkage = null
      console.warn(
        '[orders] GAP-3 protocol linkage threw (non-fatal):',
        err instanceof Error ? err.message : String(err),
      )
    }
    if (!protocolLinkage) {
      console.warn(`[orders] GAP-3 protocol linkage unresolved (non-fatal) | protocol=${protocolId}`)
    }
  }

  // Create DRAFT order — all snapshot fields set now, frozen at lock transition
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert({
      patient_id:               patientId,
      provider_id:              providerId,
      catalog_item_id:          hasCatalog ? (catalogItemId as string) : null,
      formulation_id:           hasFormulation ? (formulationId as string) : null,
      clinic_id:                clinicId,
      pharmacy_id:              pharmacyId,
      status:                   'DRAFT',
      quantity:                 1,
      wholesale_price_snapshot: wholesalePrice,
      retail_price_snapshot:    retailPrice,
      medication_snapshot:      medicationSnapshot,
      shipping_state_snapshot:  patientState,
      provider_npi_snapshot:    provider.npi_number,
      pharmacy_snapshot:        pharmacySnapshot,
      sig_text:                 sigTrimmed,
      // GAP-3: null for ad-hoc/favorite lines and on resolution failure.
      protocol_instance_id:     protocolLinkage?.protocolInstanceId ?? null,
      protocol_version_id:      protocolLinkage?.protocolVersionId ?? null,
      // WO-96: derived + defaulted Rx detail fields.
      ...rxDetailColumns,
    })
    .select('order_id')
    .single()

  if (orderError || !order) {
    console.error('[orders] order insert failed:', orderError?.message)
    return NextResponse.json({ error: 'Failed to create order' }, { status: 500 })
  }

  // WO-98: record who created the draft. This is the "created by" the
  // draft-edit permission check reads (an MA may edit only drafts they
  // created), and the first row of the draft's audit trail. Non-fatal.
  await writeDraftAudit(supabase, order.order_id, {
    event: 'draft_created',
    actor: { user_id: session.user.id, role: appRole },
    appended_to_order_id: typeof appendedToOrderId === 'string' && appendedToOrderId ? appendedToOrderId : null,
  })

  // F-5: lazy auto-default for patients.primary_provider_id. If this patient
  // has never been assigned a PCP, set the order's provider as the default.
  // The .is('primary_provider_id', null) filter makes this idempotent — a
  // second order from the same patient with a different provider will NOT
  // overwrite the existing assignment (reassignment is an explicit UX
  // action, not an order-creation side-effect). See
  // docs/audits/role-audit-and-data-model.md §F-5.
  const { error: primaryProviderError } = await supabase
    .from('patients')
    .update({ primary_provider_id: providerId })
    .eq('patient_id', patientId)
    .eq('clinic_id', clinicId)
    .is('primary_provider_id', null)

  if (primaryProviderError) {
    // Non-fatal: the order is already created. Log + continue.
    console.warn(
      '[orders] primary_provider_id auto-default failed (non-fatal):',
      primaryProviderError.message,
    )
  }

  console.info(`[orders] DRAFT created | order=${order.order_id} | clinic=${clinicId}`)

  return NextResponse.json({ orderId: order.order_id }, { status: 201 })
}
