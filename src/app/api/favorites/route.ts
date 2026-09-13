// ============================================================
// Provider Favorites API — WO-85
// GET  /api/favorites          → list favorites for current provider
//   (each row carries formulation_active so the UI can gray out
//   favorites whose formulation was deactivated by a catalog reseed)
//   ?patient_state=CA additionally enriches each row with
//   pharmacy_licensed: whether the pinned pharmacy holds an ACTIVE
//   license in that state (null when no state or no pinned pharmacy)
// POST /api/favorites          → save a new favorite
// PATCH /api/favorites?id=xxx  → update use_count (on load) — WO-103:
//   with a JSON body, edits label / dose / frequency / pharmacy instead
// DELETE /api/favorites?id=xxx → remove a favorite
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createServerClient } from '@/lib/supabase/server'
import { validateFavoriteEdit, FAVORITE_EDITABLE_FIELDS } from '@/lib/orders/favorite-edit'

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

// ── WO-103: editable favorites ───────────────────────────────
// PATCH with no body (or no editable field) keeps the WO-85 behaviour:
// bump use_count + last_used_at on load. PATCH with a JSON body of
// {label, dose_amount, dose_unit, frequency_code, pharmacy_id, sig_text,
// default_quantity} edits the favorite in place — clinic-scoped like
// DELETE, and the pharmacy must actively offer the formulation.

export async function PATCH(req: NextRequest) {
  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const clinicId = session.user.user_metadata?.clinic_id
  if (!clinicId) return NextResponse.json({ error: 'No clinic context' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const favoriteId = searchParams.get('id')
  if (!favoriteId) return NextResponse.json({ error: 'Missing id param' }, { status: 400 })

  // The body is optional (the panel's use-count bump sends none).
  let body: unknown = null
  try { body = await req.json() } catch { body = null }
  const validation = validateFavoriteEdit(body)
  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 })
  const isEdit = FAVORITE_EDITABLE_FIELDS.some(k => k in validation.patch)

  const supabase = createServiceClient()

  // Clinic-scope guard (same as DELETE): the favorite must belong to a
  // provider in the caller's clinic. Favorites are clinic-wide, so any
  // clinic member may edit any of the clinic's favorites.
  const { data: current } = await supabase
    .from('provider_favorites')
    .select('provider_id, formulation_id, use_count')
    .eq('favorite_id', favoriteId)
    .single()

  if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const validProviderIds = await getClinicProviderIds(clinicId)
  if (!validProviderIds.includes(current.provider_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!isEdit) {
    // WO-85 behaviour: record a load.
    const newCount = (current.use_count ?? 0) + 1
    const { error } = await supabase
      .from('provider_favorites')
      .update({ use_count: newCount, last_used_at: new Date().toISOString() })
      .eq('favorite_id', favoriteId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  // A re-pinned pharmacy must actively offer this favorite's formulation;
  // otherwise loading the favorite would 404 on the margin page.
  const newPharmacyId = validation.patch['pharmacy_id']
  if (typeof newPharmacyId === 'string') {
    const { data: offering } = await supabase
      .from('pharmacy_formulations')
      .select('pharmacy_formulation_id')
      .eq('pharmacy_id', newPharmacyId)
      .eq('formulation_id', current.formulation_id)
      .eq('is_available', true)
      .eq('is_active', true)
      .is('deleted_at', null)
      .maybeSingle()
    if (!offering) {
      return NextResponse.json({ error: 'That pharmacy does not offer this formulation' }, { status: 400 })
    }
  }

  const { data, error } = await supabase
    .from('provider_favorites')
    .update({ ...validation.patch, updated_at: new Date().toISOString() })
    .eq('favorite_id', favoriteId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
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
