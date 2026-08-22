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
//     retailCents, sigText, patientState }
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
  }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { patientId, providerId, catalogItemId, formulationId, pharmacyId, retailCents, sigText, patientState, protocolId } = body

  if (!patientId || !providerId || !pharmacyId || !sigText || !patientState) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const hasCatalog     = typeof catalogItemId === 'string' && catalogItemId.length > 0
  const hasFormulation = typeof formulationId === 'string' && formulationId.length > 0
  if (hasCatalog === hasFormulation) {
    return NextResponse.json(
      { error: 'Exactly one of catalogItemId or formulationId is required' },
      { status: 400 }
    )
  }

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

  const supabase = createServiceClient()

  // ── Resolve medication source ─────────────────────
  // WO-87 (B1 hotfix): branch on which ID was provided. Both branches
  // produce the same `medicationItem` shape so the rest of the
  // handler is path-agnostic.
  type MedicationItem = {
    medication_name: string
    form:            string
    dose:            string
    wholesale_price: number
    dea_schedule:    number | null
  }

  let medicationItem: MedicationItem | null = null

  if (hasCatalog) {
    // Legacy flat catalog — scoped to the pharmacy to prevent spoofing
    const { data, error } = await supabase
      .from('catalog')
      .select('item_id, medication_name, form, dose, wholesale_price, dea_schedule')
      .eq('item_id', catalogItemId as string)
      .eq('pharmacy_id', pharmacyId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .maybeSingle()

    if (error || !data) {
      console.error('[orders] catalog fetch failed:', error?.message)
      return NextResponse.json({ error: 'Catalog item not found' }, { status: 404 })
    }
    medicationItem = data
  } else {
    // V3.0 hierarchical catalog — formulations + pharmacy_formulations
    const [formResult, priceResult] = await Promise.all([
      supabase
        .from('formulations')
        .select('formulation_id, name, concentration, dosage_forms(name)')
        .eq('formulation_id', formulationId as string)
        .eq('is_active', true)
        .is('deleted_at', null)
        .maybeSingle(),
      supabase
        .from('pharmacy_formulations')
        .select('wholesale_price')
        .eq('formulation_id', formulationId as string)
        .eq('pharmacy_id', pharmacyId)
        .eq('is_available', true)
        .eq('is_active', true)
        .is('deleted_at', null)
        .maybeSingle(),
    ])

    if (formResult.error || !formResult.data || priceResult.error || !priceResult.data) {
      console.error(
        '[orders] formulation fetch failed:',
        formResult.error?.message ?? priceResult.error?.message ?? 'not found'
      )
      return NextResponse.json({ error: 'Formulation not found for this pharmacy' }, { status: 404 })
    }

    // Pull dea_schedule from the most prevalent ingredient (highest among any).
    // For the POC, formulations are single-ingredient; we walk the join table to
    // get the controlled-substance schedule deterministically.
    const { data: ingredientRows } = await supabase
      .from('formulation_ingredients')
      .select('ingredients(dea_schedule)')
      .eq('formulation_id', formulationId as string)

    let deaSchedule: number | null = null
    for (const row of ingredientRows ?? []) {
      const ing = row.ingredients as { dea_schedule: number | null } | null
      if (ing?.dea_schedule != null && (deaSchedule == null || ing.dea_schedule > deaSchedule)) {
        deaSchedule = ing.dea_schedule
      }
    }

    const df = formResult.data.dosage_forms as { name: string } | null
    medicationItem = {
      medication_name: formResult.data.name,
      form:            df?.name ?? '',
      dose:            formResult.data.concentration ?? '',
      wholesale_price: priceResult.data.wholesale_price,
      dea_schedule:    deaSchedule,
    }
  }

  // Validate retail >= wholesale (belt + suspenders over the DB CHECK constraint)
  const wholesaleCents = Math.round(medicationItem.wholesale_price * 100)
  if (retailCents < wholesaleCents) {
    return NextResponse.json(
      { error: `retail price must be >= wholesale ($${(wholesaleCents / 100).toFixed(2)})` },
      { status: 422 }
    )
  }

  // Fetch pharmacy (for snapshot)
  const { data: pharmacy, error: pharmacyError } = await supabase
    .from('pharmacies')
    .select('pharmacy_id, name, integration_tier, fax_number')
    .eq('pharmacy_id', pharmacyId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .maybeSingle()

  if (pharmacyError || !pharmacy) {
    console.error('[orders] pharmacy fetch failed:', pharmacyError?.message)
    return NextResponse.json({ error: 'Pharmacy not found' }, { status: 404 })
  }

  // Compliance (defense in depth): the pharmacy must hold an ACTIVE
  // license in the patient's shipping state. The builder and quick-load
  // UIs filter on this and sign-and-send re-checks at lock time, but the
  // DRAFT creation path must also reject unlicensed routings outright —
  // a protocol/favorite quick-load with a pinned pharmacy bypassed the
  // builder's state-filtered pharmacy_options until this check existed.
  const { data: stateLicense, error: licenseError } = await supabase
    .from('pharmacy_state_licenses')
    .select('pharmacy_id')
    .eq('pharmacy_id', pharmacyId)
    .eq('state_code', patientState)
    .eq('is_active', true)
    .maybeSingle()

  if (licenseError) {
    console.error('[orders] state license fetch failed:', licenseError.message)
    return NextResponse.json({ error: 'Pharmacy license lookup failed' }, { status: 500 })
  }

  if (!stateLicense) {
    return NextResponse.json(
      { error: `Pharmacy ${pharmacy.name} is not licensed in ${patientState}` },
      { status: 400 }
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

  // Build snapshot values (frozen at AWAITING_PAYMENT by trigger)
  const medicationSnapshot = {
    item_id:         hasCatalog ? catalogItemId : null,
    formulation_id:  hasFormulation ? formulationId : null,
    medication_name: medicationItem.medication_name,
    form:            medicationItem.form,
    dose:            medicationItem.dose,
    wholesale_price: wholesalePrice,
    dea_schedule:    medicationItem.dea_schedule ?? 0,
  }

  const pharmacySnapshot = {
    pharmacy_id:       pharmacy.pharmacy_id,
    name:              pharmacy.name,
    integration_tier:  pharmacy.integration_tier,
    fax_number:        pharmacy.fax_number ?? null,
  }

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
    })
    .select('order_id')
    .single()

  if (orderError || !order) {
    console.error('[orders] order insert failed:', orderError?.message)
    return NextResponse.json({ error: 'Failed to create order' }, { status: 500 })
  }

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
