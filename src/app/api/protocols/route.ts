// ============================================================
// Protocol Templates API — WO-85
// GET /api/protocols          → list protocols for current clinic
// GET /api/protocols?id=xxx   → get protocol with items, each item
//   enriched with its LIVE pharmacy_formulations wholesale_price and
//   a formulation_active flag, plus the clinic default_markup_pct —
//   so the client can compute real prices instead of $0.00 stubs.
// POST /api/protocols        → WO-103: create a protocol from session lines
// GET /api/protocols?id=xxx&patient_state=CA → additionally enriches
//   each item with pharmacy_licensed: whether the item's pinned
//   pharmacy holds an ACTIVE license in that state (null when no
//   patient_state is provided). Same pharmacy_state_licenses lookup
//   as the builder's pharmacy_options level (/api/formulations).
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createServerClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServiceClient()
  const clinicId = session.user.user_metadata?.clinic_id
  if (!clinicId) return NextResponse.json({ error: 'No clinic context' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const protocolId = searchParams.get('id')

  // Optional 2-letter patient shipping state — enables the per-item
  // pharmacy_licensed enrichment. Invalid values are treated as absent.
  const patientStateRaw = searchParams.get('patient_state')?.trim().toUpperCase() ?? ''
  const patientState = /^[A-Z]{2}$/.test(patientStateRaw) ? patientStateRaw : null

  // Single protocol with items
  if (protocolId) {
    const { data: protocol, error: protoErr } = await supabase
      .from('protocol_templates')
      .select('*')
      .eq('protocol_id', protocolId)
      .eq('clinic_id', clinicId)
      .single()

    if (protoErr) return NextResponse.json({ error: protoErr.message }, { status: 500 })
    if (!protocol) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const { data: items, error: itemsErr } = await supabase
      .from('protocol_items')
      .select(`
        item_id,
        formulation_id,
        pharmacy_id,
        phase_name,
        phase_start_week,
        phase_end_week,
        dose_amount,
        dose_unit,
        frequency_code,
        timing_code,
        sig_mode,
        sig_text,
        default_quantity,
        default_refills,
        is_conditional,
        condition_description,
        sort_order,
        formulations (
          formulation_id,
          name,
          concentration,
          concentration_value,
          concentration_unit,
          dosage_forms ( name ),
          routes_of_administration ( name, abbreviation, sig_prefix )
        ),
        pharmacies ( pharmacy_id, name, slug, integration_tier )
      `)
      .eq('protocol_id', protocolId)
      .order('sort_order')

    if (itemsErr) return NextResponse.json({ error: itemsErr.message }, { status: 500 })

    const protocolItems = items ?? []

    // Resolve LIVE wholesale pricing + formulation liveness for every item.
    // Protocol items store no price of their own; before this fix the client
    // stubbed wholesale/retail at $0.00, which could flow into signable
    // orders. An item is only loadable when (a) its formulation is still
    // active and (b) its pharmacy still actively offers it.
    const formulationIds = Array.from(new Set(
      protocolItems
        .map(i => i.formulation_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    ))
    const pharmacyIds = Array.from(new Set(
      protocolItems
        .map(i => i.pharmacy_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    ))

    const priceByKey = new Map<string, number>()
    const liveFormulationIds = new Set<string>()

    if (formulationIds.length > 0) {
      const [priceResult, formResult] = await Promise.all([
        supabase
          .from('pharmacy_formulations')
          .select('formulation_id, pharmacy_id, wholesale_price')
          .in('formulation_id', formulationIds)
          .in('pharmacy_id', pharmacyIds)
          .eq('is_active', true)
          .eq('is_available', true)
          .is('deleted_at', null),
        supabase
          .from('formulations')
          .select('formulation_id')
          .in('formulation_id', formulationIds)
          .eq('is_active', true)
          .is('deleted_at', null),
      ])

      if (priceResult.error) return NextResponse.json({ error: priceResult.error.message }, { status: 500 })
      if (formResult.error) return NextResponse.json({ error: formResult.error.message }, { status: 500 })

      for (const row of priceResult.data ?? []) {
        priceByKey.set(`${row.pharmacy_id}:${row.formulation_id}`, row.wholesale_price)
      }
      for (const row of formResult.data ?? []) {
        liveFormulationIds.add(row.formulation_id)
      }
    }

    // State-licensure enrichment: which pinned pharmacies hold an ACTIVE
    // license in the patient's shipping state. Quick-loading a protocol
    // must never route an unlicensed pharmacy for the selected patient
    // (the manual builder already filters pharmacy_options this way).
    const licensedPharmacyIds = new Set<string>()
    if (patientState && pharmacyIds.length > 0) {
      const { data: licenses, error: licErr } = await supabase
        .from('pharmacy_state_licenses')
        .select('pharmacy_id')
        .in('pharmacy_id', pharmacyIds)
        .eq('state_code', patientState)
        .eq('is_active', true)

      if (licErr) return NextResponse.json({ error: licErr.message }, { status: 500 })
      for (const row of licenses ?? []) licensedPharmacyIds.add(row.pharmacy_id)
    }

    const enrichedItems = protocolItems.map(item => ({
      ...item,
      wholesale_price: priceByKey.get(`${item.pharmacy_id}:${item.formulation_id}`) ?? null,
      formulation_active:
        typeof item.formulation_id === 'string' && liveFormulationIds.has(item.formulation_id),
      // null = no patient_state provided (unknown); boolean otherwise.
      pharmacy_licensed: patientState
        ? typeof item.pharmacy_id === 'string' && licensedPharmacyIds.has(item.pharmacy_id)
        : null,
    }))

    // Clinic default markup — lets the client derive a real retail price
    // (wholesale × (1 + pct/100)). Same lookup as the margin page (WO-28).
    const { data: clinic } = await supabase
      .from('clinics')
      .select('default_markup_pct')
      .eq('clinic_id', clinicId)
      .eq('is_active', true)
      .maybeSingle()

    return NextResponse.json({
      data: {
        ...protocol,
        items: enrichedItems,
        default_markup_pct: clinic?.default_markup_pct ?? null,
      },
    })
  }

  // List all active protocols for the clinic
  const { data, error } = await supabase
    .from('protocol_templates')
    .select(`
      protocol_id,
      name,
      description,
      therapeutic_category,
      total_duration_weeks,
      use_count,
      created_at
    `)
    .eq('clinic_id', clinicId)
    .eq('is_active', true)
    .order('use_count', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}

// ── WO-103: "+ New" protocol from the current session ────────
// POST /api/protocols
//   { name, description?, created_by?, items: [{ formulation_id,
//     pharmacy_id, dose_amount, dose_unit, frequency_code, sig_text,
//     default_quantity, default_refills }] }
// Creates a clinic protocol template from the prescriptions already in
// the session — no new page, no re-typing. created_by must be a
// provider in the caller's clinic when given.

const PROTOCOL_NAME_MAX = 120
const PROTOCOL_ITEMS_MAX = 20

interface ProtocolItemBody {
  formulation_id:   string
  pharmacy_id:      string | null
  dose_amount:      string | null
  dose_unit:        string | null
  frequency_code:   string | null
  sig_text:         string | null
  default_quantity: string | null
  default_refills:  number
}

function optionalStr(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

export async function POST(req: NextRequest) {
  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const clinicId = session.user.user_metadata?.clinic_id
  if (!clinicId) return NextResponse.json({ error: 'No clinic context' }, { status: 403 })

  let body: Record<string, unknown>
  try { body = await req.json() as Record<string, unknown> } catch { body = {} }

  const name = optionalStr(body['name'])
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })
  if (name.length > PROTOCOL_NAME_MAX) return NextResponse.json({ error: `name must be at most ${PROTOCOL_NAME_MAX} characters` }, { status: 400 })

  const rawItems = body['items']
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return NextResponse.json({ error: 'items must be a non-empty array' }, { status: 400 })
  }
  if (rawItems.length > PROTOCOL_ITEMS_MAX) {
    return NextResponse.json({ error: `items must have at most ${PROTOCOL_ITEMS_MAX} entries` }, { status: 400 })
  }
  const items: ProtocolItemBody[] = []
  for (const raw of rawItems) {
    if (!raw || typeof raw !== 'object') return NextResponse.json({ error: 'each item must be an object' }, { status: 400 })
    const r = raw as Record<string, unknown>
    const formulationId = optionalStr(r['formulation_id'])
    if (!formulationId) return NextResponse.json({ error: 'each item needs a formulation_id' }, { status: 400 })
    const refills = r['default_refills']
    items.push({
      formulation_id:   formulationId,
      pharmacy_id:      optionalStr(r['pharmacy_id']),
      dose_amount:      optionalStr(r['dose_amount']),
      dose_unit:        optionalStr(r['dose_unit']),
      frequency_code:   optionalStr(r['frequency_code']),
      sig_text:         optionalStr(r['sig_text']),
      default_quantity: optionalStr(r['default_quantity']),
      default_refills:  typeof refills === 'number' && Number.isInteger(refills) && refills >= 0 ? refills : 0,
    })
  }

  const supabase = createServiceClient()

  const createdBy = optionalStr(body['created_by'])
  if (createdBy) {
    const { data: provider } = await supabase
      .from('providers')
      .select('provider_id')
      .eq('provider_id', createdBy)
      .eq('clinic_id', clinicId)
      .maybeSingle()
    if (!provider) return NextResponse.json({ error: 'Provider not in clinic' }, { status: 403 })
  }

  const { data: protocol, error: protoErr } = await supabase
    .from('protocol_templates')
    .insert({
      clinic_id:   clinicId,
      created_by:  createdBy,
      name,
      description: optionalStr(body['description']),
      is_active:   true,
    })
    .select('protocol_id, name')
    .single()

  if (protoErr || !protocol) {
    return NextResponse.json({ error: protoErr?.message ?? 'Failed to create protocol' }, { status: 500 })
  }

  const { error: itemsErr } = await supabase
    .from('protocol_items')
    .insert(items.map((item, i) => ({
      protocol_id: protocol.protocol_id,
      ...item,
      sig_mode:    'standard',
      sort_order:  i,
    })))

  if (itemsErr) {
    // Keep the template out of the list rather than leaving an empty one.
    await supabase.from('protocol_templates').delete().eq('protocol_id', protocol.protocol_id)
    return NextResponse.json({ error: itemsErr.message }, { status: 500 })
  }

  return NextResponse.json({ data: { ...protocol, item_count: items.length } }, { status: 201 })
}
