// ============================================================
// Provider Favorites API — WO-85
// GET  /api/favorites          → list favorites for current provider
//   (each row carries formulation_active so the UI can gray out
//   favorites whose formulation was deactivated by a catalog reseed)
//   ?patient_state=CA additionally enriches each row with
//   pharmacy_licensed: whether the pinned pharmacy holds an ACTIVE
//   license in that state (null when no state or no pinned pharmacy)
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

// Stale-favorite hardening: the formulations embed is intentionally
// unfiltered (so dead favorites still render and can be deleted), but
// each favorite surfaces a computed formulation_active flag so the UI
// can disable the click-through instead of 404ing on the margin page.
function isFormulationLive(f: unknown): boolean {
  const row: unknown = Array.isArray(f) ? f[0] : f
  if (!row || typeof row !== 'object') return false
  const rec = row as { is_active?: boolean | null; deleted_at?: string | null }
  return rec.is_active === true && rec.deleted_at === null
}

export async function GET(req: NextRequest) {
  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServiceClient()

  const clinicId = session.user.user_metadata?.clinic_id
  if (!clinicId) return NextResponse.json({ error: 'No clinic context' }, { status: 403 })

  const providerIds = await getClinicProviderIds(clinicId)

  // Optional 2-letter patient shipping state — enables the per-row
  // pharmacy_licensed enrichment. Invalid values are treated as absent.
  const { searchParams } = new URL(req.url)
  const patientStateRaw = searchParams.get('patient_state')?.trim().toUpperCase() ?? ''
  const patientState = /^[A-Z]{2}$/.test(patientStateRaw) ? patientStateRaw : null

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
        is_active,
        deleted_at,
        dosage_forms ( name ),
        routes_of_administration ( name, abbreviation, sig_prefix )
      ),
      pharmacies ( pharmacy_id, name )
    `)
    .in('provider_id', providerIds)
    .order('use_count', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // State-licensure enrichment: which pinned pharmacies hold an ACTIVE
  // license in the patient's shipping state. Loading a favorite must
  // never route an unlicensed pharmacy for the selected patient (the
  // manual builder already filters pharmacy_options this way).
  const pinnedPharmacyIds = Array.from(new Set(
    (data ?? [])
      .map(f => f.pharmacy_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
  ))

  const licensedPharmacyIds = new Set<string>()
  if (patientState && pinnedPharmacyIds.length > 0) {
    const { data: licenses, error: licErr } = await supabase
      .from('pharmacy_state_licenses')
      .select('pharmacy_id')
      .in('pharmacy_id', pinnedPharmacyIds)
      .eq('state_code', patientState)
      .eq('is_active', true)

    if (licErr) return NextResponse.json({ error: licErr.message }, { status: 500 })
    for (const row of licenses ?? []) licensedPharmacyIds.add(row.pharmacy_id)
  }

  const favorites = (data ?? []).map(fav => ({
    ...fav,
    formulation_active: isFormulationLive(fav.formulations),
    // null = unknown (no patient_state given) or no pinned pharmacy;
    // boolean otherwise. The UI only blocks on an explicit false.
    pharmacy_licensed: patientState
      ? (typeof fav.pharmacy_id === 'string' && fav.pharmacy_id.length > 0
          ? licensedPharmacyIds.has(fav.pharmacy_id)
          : null)
      : null,
  }))

  return NextResponse.json({ data: favorites })
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
