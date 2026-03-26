// ============================================================
// Compliance Check — WO-29
// GET /api/orders/compliance-check?patientId=&providerId=&pharmacyId=&itemId=
// ============================================================
//
// REQ-OAS-005: Pre-dispatch compliance checks — all 6 must pass before
// the Sign & Send CTA is enabled.
//
// Checks:
//   1. Pharmacy ACTIVE license in patient's shipping state
//   2. Provider valid 10-digit NPI
//   3. Provider signature on file (signature_hash not null)
//   4. retail_price >= wholesale_price (validated client-side; omitted here —
//      enforced by the DB CHECK constraint at order creation)
//   5. Clinic stripe_connect_status = 'ACTIVE'
//   6. DEA scheduling — if dea_schedule >= 2, pharmacy must be TIER_4_FAX
//
// Auth: Requires active Clinic App session.
// Response: { checks: ComplianceCheckResult[] }

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export interface ComplianceCheckResult {
  id:      string   // e.g. 'pharmacy_license'
  label:   string
  passed:  boolean
  message: string | null  // human-readable failure reason
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Auth gate
  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = request.nextUrl
  const patientId   = (searchParams.get('patientId')   ?? '').trim()
  const providerId  = (searchParams.get('providerId')  ?? '').trim()
  const pharmacyId  = (searchParams.get('pharmacyId')  ?? '').trim()
  const itemId      = (searchParams.get('itemId')      ?? '').trim()
  // BLK-06: retailCents passed so check 4 (retail >= wholesale) can be evaluated
  const retailCents = parseInt(searchParams.get('retailCents') ?? '', 10)

  if (!patientId || !providerId || !pharmacyId || !itemId) {
    return NextResponse.json(
      { error: 'patientId, providerId, pharmacyId, itemId required' },
      { status: 400 }
    )
  }

  const clinicId = typeof session.user.user_metadata['clinic_id'] === 'string'
    ? session.user.user_metadata['clinic_id'] as string
    : null

  if (!clinicId) {
    return NextResponse.json({ error: 'Session missing clinic_id' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Fetch all data needed for checks in parallel
  const [patientResult, providerResult, pharmacyResult, catalogResult, clinicResult] =
    await Promise.all([
      // Patient — need shipping state
      supabase.from('patients')
        .select('patient_id, state, clinic_id')
        .eq('patient_id', patientId)
        .eq('clinic_id', clinicId)
        .eq('is_active', true)
        .is('deleted_at', null)
        .maybeSingle(),

      // Provider — need NPI + signature hash
      supabase.from('providers')
        .select('provider_id, npi_number, signature_hash, clinic_id')
        .eq('provider_id', providerId)
        .eq('clinic_id', clinicId)
        .eq('is_active', true)
        .is('deleted_at', null)
        .maybeSingle(),

      // Pharmacy — need integration_tier + is_active
      supabase.from('pharmacies')
        .select('pharmacy_id, integration_tier, is_active, pharmacy_status, deleted_at')
        .eq('pharmacy_id', pharmacyId)
        .maybeSingle(),

      // Catalog item — need dea_schedule + wholesale_price for check 4
      supabase.from('catalog')
        .select('item_id, dea_schedule, wholesale_price')
        .eq('item_id', itemId)
        .eq('is_active', true)
        .is('deleted_at', null)
        .maybeSingle(),

      // Clinic — need stripe_connect_status
      supabase.from('clinics')
        .select('clinic_id, stripe_connect_status')
        .eq('clinic_id', clinicId)
        .eq('is_active', true)
        .maybeSingle(),
    ])

  const patient  = patientResult.data
  const provider = providerResult.data
  const pharmacy = pharmacyResult.data
  const catalog  = catalogResult.data
  const clinic   = clinicResult.data

  const checks: ComplianceCheckResult[] = []

  // ── Check 1: Pharmacy ACTIVE license in patient's shipping state ──
  const patientState = patient?.state ?? null
  let pharmacyLicenseCheck: ComplianceCheckResult
  if (!patient || !patientState) {
    pharmacyLicenseCheck = {
      id: 'pharmacy_license',
      label: 'Pharmacy licensed in patient state',
      passed: false,
      message: 'Patient not found or missing shipping state.',
    }
  } else {
    const { data: license } = await supabase
      .from('pharmacy_state_licenses')
      .select('pharmacy_id')
      .eq('pharmacy_id', pharmacyId)
      .eq('state_code', patientState)
      .eq('is_active', true)
      .maybeSingle()

    pharmacyLicenseCheck = {
      id: 'pharmacy_license',
      label: 'Pharmacy licensed in patient state',
      passed: !!license,
      message: license ? null : `Pharmacy is not licensed in ${patientState}.`,
    }
  }
  checks.push(pharmacyLicenseCheck)

  // ── Check 4: Retail price >= wholesale price ──
  // BLK-06: REQ-OAS-005 check 4 must appear in the 6-check panel.
  // This check evaluates client-provided retailCents against catalog wholesale.
  // The DB CHECK constraint is the hard enforcement; this is the UI gate.
  const wholesaleCents = catalog ? Math.round(catalog.wholesale_price * 100) : 0
  const retailOk = !isNaN(retailCents) && wholesaleCents > 0 && retailCents >= wholesaleCents
  checks.push({
    id: 'retail_gte_wholesale',
    label: 'Retail price ≥ wholesale cost',
    passed: retailOk,
    message: retailOk
      ? null
      : `Retail price must be at least the wholesale cost ($${(wholesaleCents / 100).toFixed(2)}).`,
  })

  // ── Check 2: Provider valid 10-digit NPI ──
  const npi = provider?.npi_number ?? ''
  const npiValid = /^\d{10}$/.test(npi)
  checks.push({
    id: 'provider_npi',
    label: 'Provider has valid 10-digit NPI',
    passed: npiValid,
    message: npiValid ? null : 'Provider NPI is missing or not a 10-digit number.',
  })

  // ── Check 3: Provider signature on file ──
  const hasSig = !!provider?.signature_hash
  checks.push({
    id: 'provider_signature',
    label: 'Provider signature captured',
    passed: hasSig,
    message: hasSig ? null : 'Provider signature is required before sending.',
  })

  // ── Check 4: Clinic Stripe Connect active ──
  const stripeActive = clinic?.stripe_connect_status === 'ACTIVE'
  checks.push({
    id: 'stripe_connect',
    label: 'Clinic Stripe account active',
    passed: stripeActive,
    message: stripeActive
      ? null
      : 'Clinic Stripe Connect account is not active. Complete onboarding in Settings.',
  })

  // ── Check 5: Pharmacy not BANNED / soft-deleted ──
  const pharmacyOk =
    !!pharmacy &&
    pharmacy.is_active &&
    !pharmacy.deleted_at &&
    pharmacy.pharmacy_status !== 'BANNED'
  checks.push({
    id: 'pharmacy_active',
    label: 'Pharmacy is active',
    passed: pharmacyOk,
    message: pharmacyOk ? null : 'Selected pharmacy is inactive or banned.',
  })

  // ── Check 6: DEA scheduling — Tier 4 fax required for controlled substances ──
  const deaSchedule = catalog?.dea_schedule ?? 0
  let deaCheck: ComplianceCheckResult
  if (deaSchedule >= 2) {
    const isTier4 = pharmacy?.integration_tier === 'TIER_4_FAX'
    deaCheck = {
      id: 'dea_schedule',
      label: `DEA Schedule ${deaSchedule} — Tier 4 fax required`,
      passed: isTier4,
      message: isTier4
        ? null
        : `DEA Schedule ${deaSchedule} controlled substances require Tier 4 fax routing. Select a Tier 4 pharmacy.`,
    }
  } else {
    deaCheck = {
      id: 'dea_schedule',
      label: 'DEA schedule check',
      passed: true,
      message: null,
    }
  }
  checks.push(deaCheck)

  return NextResponse.json({ checks }, { status: 200 })
}
