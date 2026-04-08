// ============================================================
// Protocol Templates API — WO-85
// GET /api/protocols          → list protocols for current clinic
// GET /api/protocols?id=xxx   → get protocol with items
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
    return NextResponse.json({ data: { ...protocol, items: items ?? [] } })
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
