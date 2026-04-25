// ============================================================
// Provider Favorites API — WO-85
// GET  /api/favorites          → list favorites for current provider
// POST /api/favorites          → save a new favorite
// PATCH /api/favorites?id=xxx  → update use_count (on load)
// DELETE /api/favorites?id=xxx → remove a favorite
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createServerClient } from '@/lib/supabase/server'

async function getClinicProviderIds(clinicId: string): Promise<string[]> {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('providers')
    .select('provider_id')
    .eq('clinic_id', clinicId)
  return data?.map(p => p.provider_id) ?? []
}

export async function GET(req: NextRequest) {
  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServiceClient()

  const clinicId = session.user.user_metadata?.clinic_id
  if (!clinicId) return NextResponse.json({ error: 'No clinic context' }, { status: 403 })

  const providerIds = await getClinicProviderIds(clinicId)

  const { data, error } = await supabase
    .from('provider_favorites')
    .select(`
      favorite_id,
      provider_id,
      formulation_id,
      pharmacy_id,
      label,
      dose_amount,
      dose_unit,
      frequency_code,
      timing_code,
      duration_code,
      sig_mode,
      sig_text,
      default_quantity,
      default_refills,
      use_count,
      last_used_at,
      formulations (
        formulation_id,
        name,
        concentration,
        concentration_value,
        concentration_unit,
        dosage_forms ( name ),
        routes_of_administration ( name, abbreviation, sig_prefix )
      )
    `)
    .in('provider_id', providerIds)
    .order('use_count', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}

export async function POST(req: NextRequest) {
  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const clinicId = session.user.user_metadata?.clinic_id
  if (!clinicId) return NextResponse.json({ error: 'No clinic context' }, { status: 403 })

  const body = await req.json()
  if (!body.provider_id) return NextResponse.json({ error: 'Missing provider_id' }, { status: 400 })

  // Verify provider belongs to this clinic
  const validIds = await getClinicProviderIds(clinicId)
  if (!validIds.includes(body.provider_id)) {
    return NextResponse.json({ error: 'Provider not in clinic' }, { status: 403 })
  }

  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('provider_favorites')
    .insert({
      provider_id: body.provider_id,
      formulation_id: body.formulation_id,
      pharmacy_id: body.pharmacy_id ?? null,
      label: body.label,
      dose_amount: body.dose_amount,
      dose_unit: body.dose_unit,
      frequency_code: body.frequency_code,
      timing_code: body.timing_code ?? null,
      duration_code: body.duration_code ?? null,
      sig_mode: body.sig_mode ?? 'standard',
      sig_text: body.sig_text,
      default_quantity: body.default_quantity ?? null,
      default_refills: body.default_refills ?? 0,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data }, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const favoriteId = searchParams.get('id')
  if (!favoriteId) return NextResponse.json({ error: 'Missing id param' }, { status: 400 })

  const supabase = createServiceClient()

  // Read current use_count, then increment + update last_used_at
  const { data: current } = await supabase
    .from('provider_favorites')
    .select('use_count')
    .eq('favorite_id', favoriteId)
    .single()

  const newCount = (current?.use_count ?? 0) + 1

  const { error } = await supabase
    .from('provider_favorites')
    .update({ use_count: newCount, last_used_at: new Date().toISOString() })
    .eq('favorite_id', favoriteId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const clinicId = session.user.user_metadata?.clinic_id
  if (!clinicId) return NextResponse.json({ error: 'No clinic context' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const favoriteId = searchParams.get('id')
  if (!favoriteId) return NextResponse.json({ error: 'Missing id param' }, { status: 400 })

  const supabase = createServiceClient()

  // Clinic-scope guard: the favorite must belong to a provider in the
  // caller's clinic. Without this, any logged-in user could delete any
  // favorite by guessing its UUID. POST has the same scoping (line 82).
  const { data: fav } = await supabase
    .from('provider_favorites')
    .select('provider_id')
    .eq('favorite_id', favoriteId)
    .single()

  if (!fav) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const validProviderIds = await getClinicProviderIds(clinicId)
  if (!validProviderIds.includes(fav.provider_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { error } = await supabase
    .from('provider_favorites')
    .delete()
    .eq('favorite_id', favoriteId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
