// ============================================================
// Frequently used — GET /api/favorites/frequent?provider_id=xxx
// ============================================================
//
// Requirement 19 (Gina Rooks, 2026-09-11): the Favorites panel's
// "Frequently used" section, which replaced WO-104's Recent strip
// (/api/favorites/recent). The provider's most-ordered formulation + dose
// combinations over the last FREQUENT_WINDOW_DAYS (90) days, ranked by
// how many orders carried them, ties by the most recent; with none in the
// window, the newest combinations instead (mode "recent"), same shape.
// Computed from the order lines (lib/orders/favorite-presets.ts
// frequentlyUsed); no table of its own.
//
// The dose is the structured builder input kept on medication_snapshot
// (prescribed_dose, frequency_code); the sig text is never read.
// Cancelled and soft-deleted orders are skipped; drafts count, because in
// this clinic's flow a draft is a prescription the provider has written
// and will sign.
//
// Auth: verified user via getUser(); clinic_id from that user. The
// provider must belong to the caller's clinic.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { FREQUENT_WINDOW_DAYS, frequentlyUsed, type RecentOrderRow } from '@/lib/orders/favorite-presets'
import { getUserClinicId } from '@/lib/auth/claims'

/**
 * The most orders read from the window. The counts cover these: a
 * provider writing more than 500 orders in 90 days is counted over their
 * newest 500.
 */
const SCAN_LIMIT = 500
/**
 * With nothing in the window, the newest orders read for Recent. 8 entries
 * (FREQUENT_LIMIT) are drawn from these.
 */
const RECENT_FALLBACK_LIMIT = 50

export async function GET(req: NextRequest) {
  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const clinicId = getUserClinicId(user) ?? null
  if (!clinicId) return NextResponse.json({ error: 'No clinic context' }, { status: 403 })

  const providerId = new URL(req.url).searchParams.get('provider_id')?.trim() ?? ''
  if (!providerId) return NextResponse.json({ error: 'Missing provider_id' }, { status: 400 })

  const supabase = createServiceClient()

  const { data: provider, error: providerError } = await supabase
    .from('providers')
    .select('provider_id')
    .eq('provider_id', providerId)
    .eq('clinic_id', clinicId)
    .maybeSingle()
  if (providerError) {
    console.error('[favorites/frequent] provider could not be read:', providerError.message)
    return NextResponse.json({ error: 'Frequently used could not be loaded.' }, { status: 500 })
  }
  if (!provider) return NextResponse.json({ error: 'Provider not in clinic' }, { status: 403 })

  // The window is applied in SQL, so an open reads only the provider's
  // orders from the last FREQUENT_WINDOW_DAYS days (at most SCAN_LIMIT),
  // not their newest 500 of all time. Only an empty window reads further
  // back, and then only RECENT_FALLBACK_LIMIT rows, for Recent.
  // Follow-up (separate migration): an index on orders (provider_id,
  // created_at DESC) WHERE deleted_at IS NULL serves both reads.
  const now = new Date()
  const since = new Date(now.getTime() - FREQUENT_WINDOW_DAYS * 86_400_000).toISOString()
  const readOrders = (windowed: boolean) => {
    let q = supabase
      .from('orders')
      .select('formulation_id, pharmacy_id, created_at, medication_snapshot, pharmacy_snapshot')
      .eq('clinic_id', clinicId)
      .eq('provider_id', providerId)
      .not('formulation_id', 'is', null)
      .is('deleted_at', null)
      .neq('status', 'CANCELLED')
    if (windowed) q = q.gte('created_at', since)
    return q.order('created_at', { ascending: false }).limit(windowed ? SCAN_LIMIT : RECENT_FALLBACK_LIMIT)
  }

  let { data: orders, error } = await readOrders(true)
  if (!error && (orders ?? []).length === 0) ({ data: orders, error } = await readOrders(false))
  if (error) {
    console.error('[favorites/frequent] orders could not be read:', error.message)
    return NextResponse.json({ error: 'Frequently used could not be loaded.' }, { status: 500 })
  }

  const rows = (orders ?? []) as Array<RecentOrderRow & { pharmacy_snapshot: unknown }>
  const result = frequentlyUsed(rows, now)
  if (result.items.length === 0) return NextResponse.json({ mode: result.mode, window_days: result.window_days, data: [] })

  // Concentration + dosage form for the computed mg, and liveness so a
  // retired formulation cannot be loaded.
  const { data: formulations, error: fErr } = await supabase
    .from('formulations')
    .select('formulation_id, name, concentration_value, concentration_unit, is_active, deleted_at, dosage_forms ( name )')
    .in('formulation_id', [...new Set(result.items.map(r => r.formulation_id))])
  if (fErr) {
    console.error('[favorites/frequent] formulations could not be read:', fErr.message)
    return NextResponse.json({ error: 'Frequently used could not be loaded.' }, { status: 500 })
  }
  const byId = new Map((formulations ?? []).map(f => [f.formulation_id, f]))

  const pharmacyNames = new Map<string, string>()
  for (const row of rows) {
    const snap = (row.pharmacy_snapshot ?? {}) as Record<string, unknown>
    if (row.pharmacy_id && typeof snap['name'] === 'string' && !pharmacyNames.has(row.pharmacy_id)) {
      pharmacyNames.set(row.pharmacy_id, snap['name'])
    }
  }

  return NextResponse.json({
    mode:        result.mode,
    window_days: result.window_days,
    data: result.items.map(r => {
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
