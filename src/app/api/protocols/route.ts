// ============================================================
// Protocol Templates API — WO-85
// GET /api/protocols          → list protocols for current clinic
// GET /api/protocols?id=xxx   → get protocol with items, each item
//   enriched with its LIVE pharmacy_formulations wholesale_price and
//   a formulation_active flag, plus the clinic default_markup_pct —
//   so the client can compute real prices instead of $0.00 stubs.
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

    const enrichedItems = protocolItems.map(item => ({
      ...item,
      wholesale_price: priceByKey.get(`${item.pharmacy_id}:${item.formulation_id}`) ?? null,
      formulation_active:
        typeof item.formulation_id === 'string' && liveFormulationIds.has(item.formulation_id),
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
