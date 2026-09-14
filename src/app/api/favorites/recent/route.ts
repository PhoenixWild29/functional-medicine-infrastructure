// ============================================================
// WO-104: Recent formulations — GET /api/favorites/recent?provider_id=xxx
// ============================================================
//
// The Favorites panel's Recent strip: the last 8 distinct formulations
// this provider prescribed (newest first), each with the pharmacy and
// the structured dose of its most recent order — the builder inputs kept
// on medication_snapshot (prescribed_dose, frequency_code). The sig text
// is never read. Cancelled and soft-deleted orders are skipped; drafts
// count, because in this clinic's flow a draft is a prescription the
// provider has written and will sign.
//
// Auth: verified user via getUser(); clinic_id from that user. The
// provider must belong to the caller's clinic.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { recentFormulations, RECENT_LIMIT, type RecentOrderRow } from '@/lib/orders/favorite-presets'

/** Orders scanned to find 8 distinct formulations; a provider rarely repeats one 25 times in a row. */
const SCAN_LIMIT = 200

export async function GET(req: NextRequest) {
  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const clinicId = typeof user.user_metadata?.['clinic_id'] === 'string' ? user.user_metadata['clinic_id'] as string : null
  if (!clinicId) return NextResponse.json({ error: 'No clinic context' }, { status: 403 })

  const providerId = new URL(req.url).searchParams.get('provider_id')?.trim() ?? ''
  if (!providerId) return NextResponse.json({ error: 'Missing provider_id' }, { status: 400 })

  const supabase = createServiceClient()

  const { data: provider } = await supabase
    .from('providers')
    .select('provider_id')
    .eq('provider_id', providerId)
    .eq('clinic_id', clinicId)
    .maybeSingle()
  if (!provider) return NextResponse.json({ error: 'Provider not in clinic' }, { status: 403 })

  const { data: orders, error } = await supabase
    .from('orders')
    .select('formulation_id, pharmacy_id, created_at, medication_snapshot, pharmacy_snapshot')
    .eq('clinic_id', clinicId)
    .eq('provider_id', providerId)
    .not('formulation_id', 'is', null)
    .is('deleted_at', null)
    .neq('status', 'CANCELLED')
    .order('created_at', { ascending: false })
    .limit(SCAN_LIMIT)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (orders ?? []) as Array<RecentOrderRow & { pharmacy_snapshot: unknown }>
  const recent = recentFormulations(rows, RECENT_LIMIT)
  if (recent.length === 0) return NextResponse.json({ data: [] })

  // Concentration + dosage form for the computed mg on the chip, and
  // liveness so a retired formulation cannot be loaded.
  const { data: formulations, error: fErr } = await supabase
    .from('formulations')
    .select('formulation_id, name, concentration_value, concentration_unit, is_active, deleted_at, dosage_forms ( name )')
    .in('formulation_id', recent.map(r => r.formulation_id))
  if (fErr) return NextResponse.json({ error: fErr.message }, { status: 500 })
  const byId = new Map((formulations ?? []).map(f => [f.formulation_id, f]))

  const pharmacyNames = new Map<string, string>()
  for (const row of rows) {
    const snap = (row.pharmacy_snapshot ?? {}) as Record<string, unknown>
    if (row.pharmacy_id && typeof snap['name'] === 'string' && !pharmacyNames.has(row.pharmacy_id)) {
      pharmacyNames.set(row.pharmacy_id, snap['name'])
    }
  }

  return NextResponse.json({
    data: recent.map(r => {
      const f = byId.get(r.formulation_id)
      return {
        ...r,
        formulation_name:   f?.name ?? r.medication_name,
        pharmacy_name:      r.pharmacy_id ? pharmacyNames.get(r.pharmacy_id) ?? null : null,
        formulation_active: !!f && f.is_active === true && f.deleted_at === null,
        formulations: f
          ? { concentration_value: f.concentration_value, concentration_unit: f.concentration_unit, dosage_forms: f.dosage_forms }
          : null,
      }
    }),
  })
}
