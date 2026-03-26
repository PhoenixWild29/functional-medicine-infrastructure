// ============================================================
// Catalog CSV Upload — POST /api/ops/catalog/upload
// ============================================================
//
// Accepts parsed CSV rows (validated by client-side Papa Parse),
// validates server-side, bulk-inserts into catalog table,
// writes version history with delta summary.
//
// REQ-CTM-001: CSV upload with validation
// REQ-CTM-002: Bulk insert (pharmacy_id, source = 'CSV_UPLOAD')
// REQ-CTM-003: Version tracking with delta summaries
// REQ-CTM-005: Price discrepancy flagging (>10% change)
//
// Auth: ops_admin only.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient }  from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import type { Enums } from '@/types/database.types'

type RegulatoryStatusEnum = Enums<'regulatory_status_enum'>

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const VALID_REGULATORY_STATUSES = ['ACTIVE', 'RECALLED', 'DISCONTINUED', 'SHORTAGE']

export interface CsvRow {
  medication_name:     string
  form:                string
  dose:                string
  wholesale_price:     string | number
  regulatory_status:   string
  retail_price?:       string | number | null
  requires_prior_auth?: string | boolean | null
}

export interface PriceDiscrepancy {
  medicationName: string
  form:           string
  dose:           string
  oldPrice:       number
  newPrice:       number
  changePct:      number
  direction:      'increase' | 'decrease'
}

export interface UploadResult {
  versionNumber:     number
  rowsInserted:      number
  delta:             { added: number; modified: number; removed: number }
  priceDiscrepancies: PriceDiscrepancy[]
  warnings:          string[]
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.user.user_metadata['app_role'] !== 'ops_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { pharmacyId?: unknown; rows?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const pharmacyId = body['pharmacyId'] as string | undefined
  if (!pharmacyId || !UUID_RE.test(pharmacyId)) {
    return NextResponse.json({ error: 'Invalid or missing pharmacyId' }, { status: 400 })
  }

  const rows = body['rows']
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'rows must be a non-empty array' }, { status: 400 })
  }

  const actorEmail = session.user.email
    ? session.user.email
    : `[no-email, id=${session.user.id}]`
  const supabase   = createServiceClient()

  // Verify pharmacy exists
  const { data: pharmacy, error: pharmacyErr } = await supabase
    .from('pharmacies')
    .select('pharmacy_id, name')
    .eq('pharmacy_id', pharmacyId)
    .is('deleted_at', null)
    .maybeSingle()

  if (pharmacyErr || !pharmacy) {
    return NextResponse.json({ error: 'Pharmacy not found' }, { status: 404 })
  }

  // ── Server-side validation ────────────────────────────────────
  const warnings: string[] = []
  const validRows: Array<{
    pharmacy_id:         string
    medication_name:     string
    form:                string
    dose:                string
    wholesale_price:     number
    retail_price:        number | null
    regulatory_status:   RegulatoryStatusEnum
    requires_prior_auth: boolean
    is_active:           boolean
    updated_at:          string
    upload_history_id:   string | null
  }> = []

  const now = new Date().toISOString()

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as Record<string, unknown>
    const rowNum = i + 2  // 1-indexed, +1 for header row

    const name   = String(row['medication_name'] ?? '').trim()
    const form   = String(row['form']            ?? '').trim()
    const dose   = String(row['dose']            ?? '').trim()
    const status = String(row['regulatory_status'] ?? '').trim().toUpperCase()

    if (!name || !form || !dose) {
      warnings.push(`Row ${rowNum}: skipped — missing required field (medication_name, form, or dose)`)
      continue
    }

    if (!VALID_REGULATORY_STATUSES.includes(status)) {
      warnings.push(`Row ${rowNum}: invalid regulatory_status '${status}' — defaulting to ACTIVE`)
    }

    const wholesale = parseFloat(String(row['wholesale_price'] ?? ''))
    if (isNaN(wholesale) || wholesale < 0) {
      warnings.push(`Row ${rowNum}: skipped — invalid wholesale_price`)
      continue
    }

    const retail = row['retail_price'] != null
      ? parseFloat(String(row['retail_price']))
      : null
    const retailVal = retail !== null && !isNaN(retail) && retail >= 0 ? retail : null

    const priorAuth = row['requires_prior_auth']
    const requiresPriorAuth =
      typeof priorAuth === 'boolean' ? priorAuth
      : String(priorAuth ?? '').toLowerCase() === 'true' || String(priorAuth ?? '') === '1'

    validRows.push({
      pharmacy_id:         pharmacyId,
      medication_name:     name,
      form,
      dose,
      wholesale_price:     wholesale,
      retail_price:        retailVal,
      regulatory_status:   (VALID_REGULATORY_STATUSES.includes(status) ? status : 'ACTIVE') as RegulatoryStatusEnum,
      requires_prior_auth: requiresPriorAuth,
      is_active:           true,
      updated_at:          now,
      upload_history_id:   null,  // stamped after history insert below
    })
  }

  if (validRows.length === 0) {
    return NextResponse.json({ error: 'No valid rows found after validation', warnings }, { status: 422 })
  }

  // ── Fetch previous catalog for delta + price discrepancy ──────
  const { data: prevItems } = await supabase
    .from('catalog')
    .select('item_id, medication_name, form, dose, wholesale_price')
    .eq('pharmacy_id', pharmacyId)
    .eq('is_active', true)
    .is('deleted_at', null)

  const prevMap = new Map<string, { item_id: string; wholesale_price: number }>()
  for (const item of (prevItems ?? [])) {
    const key = `${item.medication_name}|${item.form}|${item.dose}`.toLowerCase()
    prevMap.set(key, { item_id: item.item_id, wholesale_price: item.wholesale_price })
  }

  // Compute delta + price discrepancies — REQ-CTM-005
  const priceDiscrepancies: PriceDiscrepancy[] = []
  let addedCount    = 0
  let modifiedCount = 0

  for (const row of validRows) {
    const key = `${row.medication_name}|${row.form}|${row.dose}`.toLowerCase()
    const prev = prevMap.get(key)

    if (!prev) {
      addedCount++
    } else {
      const changePct = Math.abs(row.wholesale_price - prev.wholesale_price) / prev.wholesale_price * 100
      if (changePct > 10) {
        priceDiscrepancies.push({
          medicationName: row.medication_name,
          form:           row.form,
          dose:           row.dose,
          oldPrice:       prev.wholesale_price,
          newPrice:       row.wholesale_price,
          changePct:      Math.round(changePct * 10) / 10,
          direction:      row.wholesale_price > prev.wholesale_price ? 'increase' : 'decrease',
        })
      }
      modifiedCount++
    }
  }

  // BLK-01: removedCount = items in previous catalog not present in new upload
  const removedCount = Math.max(0, prevMap.size - modifiedCount)

  const delta = { added: addedCount, modified: modifiedCount, removed: removedCount }

  // ── Write version history first (to get history_id for FK stamp) ──
  // BLK-05: retry on unique constraint violation (23505) to handle race
  // between concurrent uploads for the same pharmacy.
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
        upload_source:  'CSV_UPLOAD',
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
      // Unique constraint on (pharmacy_id, version_number) — retry with fresh SELECT
      continue
    }

    console.error(`[ops/catalog/upload] history insert failed | pharmacy=${pharmacyId}:`, historyErr.message)
    // Non-fatal — continue without history_id stamp
    break
  }

  // Stamp all rows with history_id for reliable rollback (BLK-02/rollback)
  if (historyId) {
    for (const row of validRows) {
      row.upload_history_id = historyId
    }
  }

  // ── Soft-delete previous catalog entries, insert new ones ─────
  const { error: softDeleteErr } = await supabase
    .from('catalog')
    .update({ is_active: false, deleted_at: now, updated_at: now })
    .eq('pharmacy_id', pharmacyId)
    .eq('is_active', true)
    .is('deleted_at', null)

  if (softDeleteErr) {
    console.error(`[ops/catalog/upload] soft-delete failed | pharmacy=${pharmacyId}:`, softDeleteErr.message)
    return NextResponse.json({ error: 'Failed to replace catalog' }, { status: 500 })
  }

  const { data: inserted, error: insertErr } = await supabase
    .from('catalog')
    .insert(validRows)
    .select('item_id')

  if (insertErr) {
    console.error(`[ops/catalog/upload] insert failed | pharmacy=${pharmacyId}:`, insertErr.message)
    // NB-3: Re-activate the items we just soft-deleted so the pharmacy isn't left with an empty catalog
    await supabase
      .from('catalog')
      .update({ is_active: true, deleted_at: null, updated_at: now })
      .eq('pharmacy_id', pharmacyId)
      .eq('deleted_at', now)
    return NextResponse.json({ error: 'Catalog insert failed' }, { status: 500 })
  }

  console.info(
    `[ops/catalog/upload] uploaded | pharmacy=${pharmacyId} | v${nextVersion} | rows=${validRows.length} | by=${actorEmail}`
  )

  const result: UploadResult = {
    versionNumber:     nextVersion,
    rowsInserted:      inserted?.length ?? validRows.length,
    delta,
    priceDiscrepancies,
    warnings,
  }

  return NextResponse.json(result, { status: 200 })
}

export function GET()    { return new NextResponse(null, { status: 405 }) }
export function PUT()    { return new NextResponse(null, { status: 405 }) }
export function PATCH()  { return new NextResponse(null, { status: 405 }) }
export function DELETE() { return new NextResponse(null, { status: 405 }) }
