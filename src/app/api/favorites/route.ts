// ============================================================
// Provider Favorites API — WO-85 / WO-103 / WO-104
// GET  /api/favorites          → list the clinic's favorites
//   (each row carries formulation_active so the UI can gray out
//   favorites whose formulation was deactivated by a catalog reseed)
//   ?patient_state=CA additionally enriches each row with
//   pharmacy_licensed: whether the pinned pharmacy holds an ACTIVE
//   license in that state (null when no state or no pinned pharmacy)
//   ?patient_id=xxx (WO-104) also returns the favorites pinned to that
//   patient; favorites pinned to any other patient are never returned
// POST /api/favorites          → save a dose as a favorite (WO-104: a
//   favorite is drug + formulation + pharmacy [+ patient]; saving a dose
//   for a card that already exists adds it to that card's dose_presets)
// PATCH /api/favorites?id=xxx  → update use_count (on load) — WO-103:
//   with a JSON body, edits label / pharmacy / dose presets / patient
// DELETE /api/favorites?id=xxx → remove a favorite
//
// Auth: verified user via getUser(), never getSession(); clinic_id is
// read from that verified user.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createServerClient } from '@/lib/supabase/server'
import type { Json } from '@/types/database.types'
import { validateFavoriteEdit, FAVORITE_EDITABLE_FIELDS, FAVORITE_LABEL_MAX } from '@/lib/orders/favorite-edit'
import {
  favoriteCategory,
  mergePresets,
  presetsFromJson,
  validateDosePresets,
} from '@/lib/orders/favorite-presets'

type ServiceClient = ReturnType<typeof createServiceClient>

async function getClinicProviderIds(clinicId: string): Promise<string[]> {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('providers')
    .select('provider_id')
    .eq('clinic_id', clinicId)
  return data?.map(p => p.provider_id) ?? []
}

/** The verified caller's clinic, or the error response to return. */
async function callerClinic(): Promise<{ clinicId: string } | { response: NextResponse }> {
  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const clinicId = typeof user.user_metadata?.['clinic_id'] === 'string' ? user.user_metadata['clinic_id'] as string : null
  if (!clinicId) return { response: NextResponse.json({ error: 'No clinic context' }, { status: 403 }) }
  return { clinicId }
}

/** A patient may only be pinned when they belong to the caller's clinic. */
async function patientInClinic(supabase: ServiceClient, patientId: string, clinicId: string): Promise<boolean> {
  const { data } = await supabase
    .from('patients')
    .select('patient_id')
    .eq('patient_id', patientId)
    .eq('clinic_id', clinicId)
    .maybeSingle()
  return !!data
}

/**
 * WO-104: the favorite's group, from the formulation's ingredient
 * therapeutic_category (salt form first, then the primary formulation
 * ingredient for combinations). Nothing for the provider to type.
 */
async function categoryForFormulation(supabase: ServiceClient, formulationId: string): Promise<string> {
  const { data } = await supabase
    .from('formulations')
    .select('salt_forms ( ingredients ( therapeutic_category ) ), formulation_ingredients ( role, ingredients ( therapeutic_category ) )')
    .eq('formulation_id', formulationId)
    .maybeSingle()
  const row = (data ?? null) as null | {
    salt_forms?: { ingredients?: { therapeutic_category: string | null } | null } | null
    formulation_ingredients?: Array<{ role: string | null; ingredients?: { therapeutic_category: string | null } | null }> | null
  }
  const fromSalt = row?.salt_forms?.ingredients?.therapeutic_category ?? null
  const ingredients = [...(row?.formulation_ingredients ?? [])].sort((a, b) => Number(b.role === 'primary') - Number(a.role === 'primary'))
  const fromIngredients = ingredients.find(fi => fi.ingredients?.therapeutic_category)?.ingredients?.therapeutic_category ?? null
  return favoriteCategory(fromSalt ?? fromIngredients)
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
  const caller = await callerClinic()
  if ('response' in caller) return caller.response
  const { clinicId } = caller

  const supabase = createServiceClient()
  const providerIds = await getClinicProviderIds(clinicId)

  // Optional 2-letter patient shipping state — enables the per-row
  // pharmacy_licensed enrichment. Invalid values are treated as absent.
  const { searchParams } = new URL(req.url)
  const patientStateRaw = searchParams.get('patient_state')?.trim().toUpperCase() ?? ''
  const patientState = /^[A-Z]{2}$/.test(patientStateRaw) ? patientStateRaw : null
  const patientId = searchParams.get('patient_id')?.trim() || null

  const { data, error } = await supabase
    .from('provider_favorites')
    .select(`
      favorite_id,
      provider_id,
      formulation_id,
      pharmacy_id,
      patient_id,
      label,
      category,
      dose_presets,
      sig_mode,
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

  // WO-104: clinic-wide favorites, plus the selected patient's own. A
  // favorite pinned to another patient is not this session's business.
  const scoped = (data ?? []).filter(fav => {
    const pinned = (fav as { patient_id?: string | null }).patient_id ?? null
    return pinned === null || (patientId !== null && pinned === patientId)
  })

  // State-licensure enrichment: which pinned pharmacies hold an ACTIVE
  // license in the patient's shipping state. Loading a favorite must
  // never route an unlicensed pharmacy for the selected patient (the
  // manual builder already filters pharmacy_options this way).
  const pinnedPharmacyIds = Array.from(new Set(
    scoped
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

  const favorites = scoped.map(fav => ({
    ...fav,
    patient_id:   (fav as { patient_id?: string | null }).patient_id ?? null,
    category:     (fav as { category?: string | null }).category ?? null,
    // WO-104: only valid builder presets reach the client.
    dose_presets: presetsFromJson((fav as { dose_presets?: unknown }).dose_presets),
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

// ── WO-104: save a dose ──────────────────────────────────────
// Body: { provider_id, formulation_id, pharmacy_id, label, dose_presets,
// patient_id?, sig_mode?, default_refills? }. If the clinic already has
// a favorite for this formulation + pharmacy + patient scope, the doses
// are added to it (duplicates dropped) and 200 is returned with
// merged: true; otherwise a new favorite is created (201).

export async function POST(req: NextRequest) {
  const caller = await callerClinic()
  if ('response' in caller) return caller.response
  const { clinicId } = caller

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  if (typeof body['provider_id'] !== 'string' || !body['provider_id']) return NextResponse.json({ error: 'Missing provider_id' }, { status: 400 })
  if (typeof body['formulation_id'] !== 'string' || !body['formulation_id']) return NextResponse.json({ error: 'Missing formulation_id' }, { status: 400 })

  const presets = validateDosePresets(body['dose_presets'])
  if (!presets.ok) return NextResponse.json({ error: presets.error }, { status: 400 })

  const label = typeof body['label'] === 'string' ? body['label'].trim() : ''
  if (!label || label.length > FAVORITE_LABEL_MAX) {
    return NextResponse.json({ error: `label must be 1–${FAVORITE_LABEL_MAX} characters` }, { status: 400 })
  }
  const providerId = body['provider_id']
  const formulationId = body['formulation_id']
  const pharmacyId = typeof body['pharmacy_id'] === 'string' && body['pharmacy_id'] ? body['pharmacy_id'] : null
  const patientId = typeof body['patient_id'] === 'string' && body['patient_id'] ? body['patient_id'] : null

  // Verify provider belongs to this clinic
  const validIds = await getClinicProviderIds(clinicId)
  if (!validIds.includes(providerId)) {
    return NextResponse.json({ error: 'Provider not in clinic' }, { status: 403 })
  }

  const supabase = createServiceClient()

  if (patientId && !(await patientInClinic(supabase, patientId, clinicId))) {
    return NextResponse.json({ error: 'Patient not in clinic' }, { status: 403 })
  }

  // One card per clinic + formulation + pharmacy + patient scope.
  const { data: candidates, error: findErr } = await supabase
    .from('provider_favorites')
    .select('favorite_id, pharmacy_id, patient_id, dose_presets')
    .in('provider_id', validIds)
    .eq('formulation_id', formulationId)
  if (findErr) return NextResponse.json({ error: findErr.message }, { status: 500 })

  const existing = (candidates ?? []).find(c =>
    (c.pharmacy_id ?? null) === pharmacyId && ((c as { patient_id?: string | null }).patient_id ?? null) === patientId)

  if (existing) {
    const merged = mergePresets(presetsFromJson((existing as { dose_presets?: unknown }).dose_presets), presets.presets)
    const { data, error } = await supabase
      .from('provider_favorites')
      .update({ dose_presets: merged as unknown as Json, updated_at: new Date().toISOString() })
      .eq('favorite_id', existing.favorite_id)
      .select()
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ data, merged: true })
  }

  const category = await categoryForFormulation(supabase, formulationId)
  const sigMode = body['sig_mode'] === 'titration' || body['sig_mode'] === 'cycling' ? body['sig_mode'] : 'standard'
  const refills = typeof body['default_refills'] === 'number' && Number.isInteger(body['default_refills']) && body['default_refills'] >= 0
    ? body['default_refills']
    : 0

  const { data, error } = await supabase
    .from('provider_favorites')
    .insert({
      provider_id:     providerId,
      formulation_id:  formulationId,
      pharmacy_id:     pharmacyId,
      patient_id:      patientId,
      label,
      category,
      dose_presets:    presets.presets as unknown as Json,
      sig_mode:        sigMode,
      default_refills: refills,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data, merged: false }, { status: 201 })
}

// ── WO-103: editable favorites ───────────────────────────────
// PATCH with no body (or no editable field) keeps the WO-85 behaviour:
// bump use_count + last_used_at on load. PATCH with a JSON body of
// {label, pharmacy_id, dose_presets, patient_id} edits the favorite in
// place — clinic-scoped like DELETE, the pharmacy must actively offer the
// formulation, and a pinned patient must belong to the clinic.

export async function PATCH(req: NextRequest) {
  const caller = await callerClinic()
  if ('response' in caller) return caller.response
  const { clinicId } = caller

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
  // otherwise loading the favorite would find no pharmacy to select.
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

  const newPatientId = validation.patch['patient_id']
  if (typeof newPatientId === 'string' && !(await patientInClinic(supabase, newPatientId, clinicId))) {
    return NextResponse.json({ error: 'Patient not in clinic' }, { status: 403 })
  }

  const { dose_presets: presetsPatch, ...rest } = validation.patch
  const { data, error } = await supabase
    .from('provider_favorites')
    .update({
      ...rest,
      ...(presetsPatch ? { dose_presets: presetsPatch as unknown as Json } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('favorite_id', favoriteId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}

export async function DELETE(req: NextRequest) {
  const caller = await callerClinic()
  if ('response' in caller) return caller.response
  const { clinicId } = caller

  const { searchParams } = new URL(req.url)
  const favoriteId = searchParams.get('id')
  if (!favoriteId) return NextResponse.json({ error: 'Missing id param' }, { status: 400 })

  const supabase = createServiceClient()

  // Clinic-scope guard: the favorite must belong to a provider in the
  // caller's clinic. Without this, any logged-in user could delete any
  // favorite by guessing its UUID. POST has the same scoping.
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
