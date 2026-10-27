// ============================================================
// Catalog Manual Entry — POST/PATCH /api/ops/catalog/item
// ============================================================
//
// POST  — add a single catalog item (REQ-CTM-009)
// PATCH — update a single existing catalog item (REQ-CTM-009)
//
// Auth: ops_admin only.

import { NextRequest, NextResponse } from 'next/server'
import { refuseCrossSite } from '@/lib/security/same-origin'
import { z } from 'zod'
import { createServerClient }  from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import type { Enums } from '@/types/database.types'
import { getUserRole } from '@/lib/auth/claims'
import { withApiErrors } from '@/lib/api/with-api-errors'
import { MAX_NAME, UUID_RE, badRequest, boundedText, parseInput } from '@/lib/api/input'
import { VALID_REGULATORY_STATUSES } from '@/lib/catalog/validate-csv-rows'
import { readObjectBody } from '@/app/api/ops/_lib/body'

type RegulatoryStatusEnum = Enums<'regulatory_status_enum'>

/** A price in dollars: a number, or a numeric string (what a form sends). Bounded. */
const MAX_PRICE = 1_000_000
function toPrice(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v.trim()) : NaN
  return Number.isFinite(n) && n >= 0 && n <= MAX_PRICE ? n : null
}

// The text fields and flags, checked for type and bound before anything is
// written (an object or a 10 MB string used to be String()-ed into the
// row). Prices, the status and the ids keep their own messages below.
const text = boundedText(MAX_NAME).optional().nullable()
const fieldsSchema = z.object({
  medicationName:    text,
  form:              text,
  dose:              text,
  regulatoryStatus:  z.string().max(50).optional().nullable(),
  requiresPriorAuth: z.union([z.boolean(), z.enum(['true', 'false'])]).optional().nullable(),
})

function isKnownStatus(s: string): boolean {
  return (VALID_REGULATORY_STATUSES as readonly string[]).includes(s)
}

async function guard() {
  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return { user: null, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (getUserRole(user) !== 'ops_admin') {
    return { user: null, error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { user, error: null }
}

// ── POST: Add single item ─────────────────────────────────────
async function postHandler(request: NextRequest): Promise<NextResponse> {
  const crossSite = refuseCrossSite(request)
  if (crossSite) return crossSite
  const { user, error: authErr } = await guard()
  if (authErr) return authErr

  const parsed = await readObjectBody(request)
  if (!parsed.ok) return parsed.response
  const body = parsed.body

  // Any 8-4-4-4-12 hex id (lib/api/input): the seeded demo ids are not RFC v4.
  const pharmacyId = body['pharmacyId']
  if (typeof pharmacyId !== 'string' || !UUID_RE.test(pharmacyId)) {
    return NextResponse.json({ error: 'Invalid or missing pharmacyId' }, { status: 400 })
  }

  const fields = parseInput(fieldsSchema, body)
  if (!fields.ok) return fields.response
  const { medicationName, form, dose, regulatoryStatus, requiresPriorAuth } = fields.data

  if (!medicationName || !form || !dose) {
    return NextResponse.json({ error: 'Missing required fields: medicationName, form, dose' }, { status: 400 })
  }

  const price = toPrice(body['wholesalePrice'])
  if (price === null) {
    return NextResponse.json({ error: 'Invalid wholesalePrice' }, { status: 400 })
  }

  let retailPrice: number | null = null
  if (body['retailPrice'] != null) {
    retailPrice = toPrice(body['retailPrice'])
    if (retailPrice === null) return badRequest('Invalid request', ['retailPrice'])
  }

  const status = (regulatoryStatus ?? 'ACTIVE').toUpperCase()
  if (!isKnownStatus(status)) {
    return NextResponse.json({ error: `Invalid regulatoryStatus: ${status}` }, { status: 400 })
  }

  const actorEmail = user!.email ?? `[no-email, id=${user!.id}]`
  const supabase   = createServiceClient()
  const now        = new Date().toISOString()

  const { data, error } = await supabase
    .from('catalog')
    .insert({
      pharmacy_id:         pharmacyId,
      medication_name:     medicationName,
      form,
      dose,
      wholesale_price:     price,
      retail_price:        retailPrice,
      regulatory_status:   status as RegulatoryStatusEnum,
      requires_prior_auth: requiresPriorAuth === true || requiresPriorAuth === 'true',
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
async function patchHandler(request: NextRequest): Promise<NextResponse> {
  const crossSite = refuseCrossSite(request)
  if (crossSite) return crossSite
  const { user, error: authErr } = await guard()
  if (authErr) return authErr

  const parsed = await readObjectBody(request)
  if (!parsed.ok) return parsed.response
  const body = parsed.body

  const itemId = body['itemId']
  if (typeof itemId !== 'string' || !UUID_RE.test(itemId)) {
    return NextResponse.json({ error: 'Invalid or missing itemId' }, { status: 400 })
  }

  const fields = parseInput(fieldsSchema, body)
  if (!fields.ok) return fields.response
  const f = fields.data

  const actorEmail = user!.email ?? `[no-email, id=${user!.id}]`
  const now        = new Date().toISOString()

  // Build partial update from provided fields
  const updates: Record<string, unknown> = { updated_at: now }

  if (f.medicationName != null) updates['medication_name'] = f.medicationName
  if (f.form           != null) updates['form']            = f.form
  if (f.dose           != null) updates['dose']            = f.dose
  if (body['wholesalePrice'] != null) {
    const p = toPrice(body['wholesalePrice'])
    if (p === null) return NextResponse.json({ error: 'Invalid wholesalePrice' }, { status: 400 })
    updates['wholesale_price'] = p
  }
  if (body['retailPrice'] != null) {
    const p = toPrice(body['retailPrice'])
    if (p === null) return badRequest('Invalid request', ['retailPrice'])
    updates['retail_price'] = p
  }
  if (f.regulatoryStatus != null) {
    const s = f.regulatoryStatus.toUpperCase()
    if (!isKnownStatus(s)) return NextResponse.json({ error: `Invalid regulatoryStatus` }, { status: 400 })
    updates['regulatory_status'] = s
  }
  if (f.requiresPriorAuth != null) updates['requires_prior_auth'] = f.requiresPriorAuth === true || f.requiresPriorAuth === 'true'

  const { error } = await createServiceClient()
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

export const POST = withApiErrors('/api/ops/catalog/item', postHandler)
export const PATCH = withApiErrors('/api/ops/catalog/item', patchHandler)
