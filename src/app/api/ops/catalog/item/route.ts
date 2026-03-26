// ============================================================
// Catalog Manual Entry — POST/PATCH /api/ops/catalog/item
// ============================================================
//
// POST  — add a single catalog item (REQ-CTM-009)
// PATCH — update a single existing catalog item (REQ-CTM-009)
//
// Auth: ops_admin only.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient }  from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import type { Enums } from '@/types/database.types'

type RegulatoryStatusEnum = Enums<'regulatory_status_enum'>

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const VALID_REGULATORY_STATUSES = ['ACTIVE', 'RECALLED', 'DISCONTINUED', 'SHORTAGE']

async function guard(request: NextRequest) {
  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session) return { session: null, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (session.user.user_metadata['app_role'] !== 'ops_admin') {
    return { session: null, error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { session, error: null }
}

// ── POST: Add single item ─────────────────────────────────────
export async function POST(request: NextRequest): Promise<NextResponse> {
  const { session, error: authErr } = await guard(request)
  if (authErr) return authErr

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const pharmacyId = body['pharmacyId'] as string | undefined
  if (!pharmacyId || !UUID_RE.test(pharmacyId)) {
    return NextResponse.json({ error: 'Invalid or missing pharmacyId' }, { status: 400 })
  }

  const { medicationName, form, dose, wholesalePrice, regulatoryStatus } =
    body as Record<string, unknown>

  if (!medicationName || !form || !dose) {
    return NextResponse.json({ error: 'Missing required fields: medicationName, form, dose' }, { status: 400 })
  }

  const price = parseFloat(String(wholesalePrice ?? ''))
  if (isNaN(price) || price < 0) {
    return NextResponse.json({ error: 'Invalid wholesalePrice' }, { status: 400 })
  }

  const status = String(regulatoryStatus ?? 'ACTIVE').toUpperCase()
  if (!VALID_REGULATORY_STATUSES.includes(status)) {
    return NextResponse.json({ error: `Invalid regulatoryStatus: ${status}` }, { status: 400 })
  }

  const actorEmail = session!.user.email ?? `[no-email, id=${session!.user.id}]`
  const supabase   = createServiceClient()
  const now        = new Date().toISOString()

  const { data, error } = await supabase
    .from('catalog')
    .insert({
      pharmacy_id:         pharmacyId,
      medication_name:     String(medicationName).trim(),
      form:                String(form).trim(),
      dose:                String(dose).trim(),
      wholesale_price:     price,
      retail_price:        body['retailPrice'] != null ? parseFloat(String(body['retailPrice'])) : null,
      regulatory_status:   status as RegulatoryStatusEnum,
      requires_prior_auth: body['requiresPriorAuth'] === true || String(body['requiresPriorAuth'] ?? '') === 'true',
      is_active:           true,
      updated_at:          now,
    })
    .select('item_id')
    .single()

  if (error) {
    console.error(`[ops/catalog/item] insert failed | pharmacy=${pharmacyId}:`, error.message)
    return NextResponse.json({ error: 'Insert failed' }, { status: 500 })
  }

  console.info(`[ops/catalog/item] added | pharmacy=${pharmacyId} | by=${actorEmail}`)
  return NextResponse.json({ ok: true, itemId: (data as Record<string, unknown>)['item_id'] }, { status: 201 })
}

// ── PATCH: Update single item ─────────────────────────────────
export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const { session, error: authErr } = await guard(request)
  if (authErr) return authErr

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const itemId = body['itemId'] as string | undefined
  if (!itemId || !UUID_RE.test(itemId)) {
    return NextResponse.json({ error: 'Invalid or missing itemId' }, { status: 400 })
  }

  const actorEmail = session!.user.email ?? `[no-email, id=${session!.user.id}]`
  const supabase   = createServiceClient()
  const now        = new Date().toISOString()

  // Build partial update from provided fields
  const updates: Record<string, unknown> = { updated_at: now }

  if (body['medicationName'] != null) updates['medication_name']     = String(body['medicationName']).trim()
  if (body['form']           != null) updates['form']                = String(body['form']).trim()
  if (body['dose']           != null) updates['dose']                = String(body['dose']).trim()
  if (body['wholesalePrice'] != null) {
    const p = parseFloat(String(body['wholesalePrice']))
    if (isNaN(p) || p < 0) return NextResponse.json({ error: 'Invalid wholesalePrice' }, { status: 400 })
    updates['wholesale_price'] = p
  }
  if (body['retailPrice']         != null) updates['retail_price']         = parseFloat(String(body['retailPrice']))
  if (body['regulatoryStatus']    != null) {
    const s = String(body['regulatoryStatus']).toUpperCase()
    if (!VALID_REGULATORY_STATUSES.includes(s)) return NextResponse.json({ error: `Invalid regulatoryStatus` }, { status: 400 })
    updates['regulatory_status'] = s
  }
  if (body['requiresPriorAuth']   != null) updates['requires_prior_auth'] = body['requiresPriorAuth'] === true || String(body['requiresPriorAuth']) === 'true'

  const { error } = await supabase
    .from('catalog')
    .update(updates)
    .eq('item_id', itemId)
    .is('deleted_at', null)

  if (error) {
    console.error(`[ops/catalog/item] update failed | item=${itemId}:`, error.message)
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }

  console.info(`[ops/catalog/item] updated | item=${itemId} | by=${actorEmail}`)
  return NextResponse.json({ ok: true })
}

export function GET()    { return new NextResponse(null, { status: 405 }) }
export function PUT()    { return new NextResponse(null, { status: 405 }) }
export function DELETE() { return new NextResponse(null, { status: 405 }) }
