// ============================================================
// Catalog API Sync — POST /api/ops/catalog/sync/[pharmacyId]
// ============================================================
//
// Manually triggers catalog sync for a Tier 1 or Tier 3 pharmacy
// by calling the pharmacy's GET /catalog API endpoint.
//
// REQ-CTM-006: API sync status display and manual trigger
//
// Auth: ops_admin only.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient }  from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import type { Enums } from '@/types/database.types'

type RegulatoryStatusEnum = Enums<'regulatory_status_enum'>

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

interface Params { params: Promise<{ pharmacyId: string }> }

export async function POST(_request: NextRequest, { params }: Params): Promise<NextResponse> {
  const { pharmacyId } = await params
  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.user.user_metadata['app_role'] !== 'ops_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!pharmacyId || !UUID_RE.test(pharmacyId)) {
    return NextResponse.json({ error: 'Invalid pharmacyId' }, { status: 400 })
  }

  const actorEmail = session.user.email
    ? session.user.email
    : `[no-email, id=${session.user.id}]`
  const supabase   = createServiceClient()

  // Verify pharmacy is Tier 1 or Tier 3 (API-capable)
  const { data: pharmacy, error: fetchErr } = await supabase
    .from('pharmacies')
    .select('pharmacy_id, name, integration_tier, api_base_url')
    .eq('pharmacy_id', pharmacyId)
    .is('deleted_at', null)
    .maybeSingle()

  if (fetchErr || !pharmacy) {
    return NextResponse.json({ error: 'Pharmacy not found' }, { status: 404 })
  }

  const tier    = (pharmacy as unknown as Record<string, unknown>)['integration_tier'] as string
  const apiBase = (pharmacy as unknown as Record<string, unknown>)['api_base_url'] as string | null

  if (!['TIER_1_API', 'TIER_3_SPEC', 'TIER_3_HYBRID'].includes(tier)) {
    return NextResponse.json({
      error: `Pharmacy tier ${tier} does not support API catalog sync`,
    }, { status: 409 })
  }

  if (!apiBase) {
    return NextResponse.json({
      error: 'Pharmacy has no API base URL configured',
    }, { status: 409 })
  }

  // BLK-04: SSRF prevention — only allow HTTPS URLs
  if (!apiBase.startsWith('https://')) {
    return NextResponse.json({
      error: 'Pharmacy API base URL must use HTTPS',
    }, { status: 409 })
  }

  const now = new Date().toISOString()

  // Call pharmacy catalog API
  let catalogItems: Array<Record<string, unknown>> = []
  try {
    const res = await fetch(`${apiBase}/catalog`, {
      headers: { 'Content-Type': 'application/json' },
      signal:  AbortSignal.timeout(30_000),
    })
    if (!res.ok) {
      throw new Error(`Pharmacy API returned ${res.status}`)
    }
    const payload = await res.json() as unknown
    catalogItems = Array.isArray(payload) ? payload as Array<Record<string, unknown>>
      : (payload as Record<string, unknown>)['items'] as Array<Record<string, unknown>> ?? []
  } catch (err) {
    console.error(`[ops/catalog/sync] API call failed | pharmacy=${pharmacyId}:`, err)
    return NextResponse.json({ error: 'Catalog API call failed' }, { status: 502 })
  }

  if (catalogItems.length === 0) {
    return NextResponse.json({ error: 'Pharmacy API returned empty catalog' }, { status: 422 })
  }

  // Map pharmacy API response to catalog rows
  const validRows = catalogItems
    .map((item) => {
      const name  = String(item['medication_name'] ?? item['name'] ?? '').trim()
      const form  = String(item['form']            ?? '').trim()
      const dose  = String(item['dose']            ?? item['strength'] ?? '').trim()
      const price = parseFloat(String(item['wholesale_price'] ?? item['price'] ?? ''))
      if (!name || !form || !dose || isNaN(price)) return null
      return {
        pharmacy_id:         pharmacyId,
        medication_name:     name,
        form,
        dose,
        wholesale_price:     price,
        retail_price:        item['retail_price'] != null ? parseFloat(String(item['retail_price'])) : null,
        regulatory_status:   String(item['regulatory_status'] ?? 'ACTIVE').toUpperCase() as RegulatoryStatusEnum,
        requires_prior_auth: item['requires_prior_auth'] === true || item['requires_prior_auth'] === 'true',
        is_active:           true,
        updated_at:          now,
        upload_history_id:   null as string | null,  // stamped after history insert
      }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)

  if (validRows.length === 0) {
    return NextResponse.json({ error: 'No valid items in pharmacy catalog response' }, { status: 422 })
  }

  // ── Fetch previous catalog for delta computation (NB-03) ──────
  const { data: prevItems } = await supabase
    .from('catalog')
    .select('medication_name, form, dose')
    .eq('pharmacy_id', pharmacyId)
    .eq('is_active', true)
    .is('deleted_at', null)

  const prevSet = new Set<string>()
  for (const item of (prevItems ?? [])) {
    prevSet.add(`${item.medication_name}|${item.form}|${item.dose}`.toLowerCase())
  }

  let addedCount = 0
  let modifiedCount = 0
  for (const row of validRows) {
    const key = `${row.medication_name}|${row.form}|${row.dose}`.toLowerCase()
    if (prevSet.has(key)) {
      modifiedCount++
    } else {
      addedCount++
    }
  }
  const removedCount = Math.max(0, prevSet.size - modifiedCount)
  const delta = { added: addedCount, modified: modifiedCount, removed: removedCount }

  // ── Write version history first (to get history_id for FK stamp) ──
  // BLK-05: retry on unique constraint violation (23505)
  let historyId: string | null = null
  let nextVersion = 0
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: lastVersion } = await supabase
      .from('catalog_upload_history')
      .select('version_number')
      .eq('pharmacy_id', pharmacyId)
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle()

    nextVersion = ((lastVersion as Record<string, unknown> | null)?.['version_number'] as number ?? 0) + 1

    const { data: historyData, error: historyErr } = await supabase
      .from('catalog_upload_history')
      .insert({
        pharmacy_id:    pharmacyId,
        uploader:       actorEmail,
        upload_source:  'PHARMACY_API',
        version_number: nextVersion,
        row_count:      validRows.length,
        delta_summary:  delta,
        is_active:      true,
        uploaded_at:    now,
      })
      .select('history_id')
      .single()

    if (!historyErr) {
      historyId = (historyData as Record<string, unknown>)['history_id'] as string
      break
    }

    if ((historyErr as { code?: string }).code === '23505') {
      continue
    }

    console.error(`[ops/catalog/sync] history insert failed | pharmacy=${pharmacyId}:`, historyErr.message)
    break
  }

  // Stamp all rows with history_id for reliable rollback
  if (historyId) {
    for (const row of validRows) {
      row.upload_history_id = historyId
    }
  }

  // BLK-09: check soft-delete error before proceeding to insert
  const { error: softDeleteErr } = await supabase
    .from('catalog')
    .update({ is_active: false, deleted_at: now, updated_at: now })
    .eq('pharmacy_id', pharmacyId)
    .eq('is_active', true)
    .is('deleted_at', null)

  if (softDeleteErr) {
    console.error(`[ops/catalog/sync] soft-delete failed | pharmacy=${pharmacyId}:`, softDeleteErr.message)
    return NextResponse.json({ error: 'Failed to replace catalog' }, { status: 500 })
  }

  const { data: inserted, error: insertErr } = await supabase
    .from('catalog')
    .insert(validRows)
    .select('item_id')

  if (insertErr) {
    console.error(`[ops/catalog/sync] insert failed | pharmacy=${pharmacyId}:`, insertErr.message)
    return NextResponse.json({ error: 'Catalog insert failed' }, { status: 500 })
  }

  // Update last_synced_at on pharmacy
  await supabase
    .from('pharmacies')
    .update({ catalog_last_synced_at: now, updated_at: now })
    .eq('pharmacy_id', pharmacyId)

  console.info(`[ops/catalog/sync] synced | pharmacy=${pharmacyId} | rows=${validRows.length} | by=${actorEmail}`)

  return NextResponse.json({
    ok:           true,
    versionNumber: nextVersion,
    rowsSynced:   inserted?.length ?? validRows.length,
    syncedAt:     now,
  })
}

export function GET()    { return new NextResponse(null, { status: 405 }) }
export function PUT()    { return new NextResponse(null, { status: 405 }) }
export function PATCH()  { return new NextResponse(null, { status: 405 }) }
export function DELETE() { return new NextResponse(null, { status: 405 }) }
