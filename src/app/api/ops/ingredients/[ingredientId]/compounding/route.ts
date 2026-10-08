// ============================================================
// PUT /api/ops/ingredients/[ingredientId]/compounding (Compliance C8)
// ============================================================
//
// Ops records an ingredient's compounding status, whether a marketed
// FDA-approved product has the same active ingredient, and whether that
// product is on FDA's shortage list. Every change carries its source (an
// FDA page and date) and is stamped with who reviewed it and when; the
// trigger on ingredients writes the audit row
// (ingredient_compounding_history).
//
// Auth: ops_admin only, getUser() (never getSession()).

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { isCompoundingStatus } from '@/lib/compliance/compounding'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function PUT(request: NextRequest, { params }: { params: Promise<{ ingredientId: string }> }): Promise<NextResponse> {
  const { ingredientId } = await params

  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.user_metadata?.['app_role'] !== 'ops_admin') {
    return NextResponse.json({ error: 'Only ops can change an ingredient\'s compounding status.' }, { status: 403 })
  }
  if (!UUID_RE.test(ingredientId)) return NextResponse.json({ error: 'Invalid ingredient id' }, { status: 400 })

  let body: Record<string, unknown>
  try {
    body = await request.json() as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { status, commercialEquivalent, onFdaShortage } = body
  const source = typeof body['source'] === 'string' ? body['source'].trim() : ''
  if (!isCompoundingStatus(status)) return NextResponse.json({ error: 'status is not a compounding status' }, { status: 400 })
  if (typeof commercialEquivalent !== 'boolean') return NextResponse.json({ error: 'commercialEquivalent must be true or false' }, { status: 400 })
  if (typeof onFdaShortage !== 'boolean') return NextResponse.json({ error: 'onFdaShortage must be true or false' }, { status: 400 })
  if (source.length < 3 || source.length > 300) {
    return NextResponse.json({ error: 'source is required: where this came from (3 to 300 characters)' }, { status: 400 })
  }

  const reviewedAt = new Date().toISOString()
  const { data, error } = await createServiceClient()
    .from('ingredients')
    .update({
      compounding_status:             status,
      commercial_equivalent:          commercialEquivalent,
      on_fda_shortage:                onFdaShortage,
      compounding_status_source:      source,
      compounding_status_reviewed_at: reviewedAt,
      compounding_status_reviewed_by: user.id,
    })
    .eq('ingredient_id', ingredientId)
    .select('ingredient_id')
    .maybeSingle()

  if (error) {
    console.error(`[ops/ingredients] compounding update failed | ingredient=${ingredientId}:`, error.message)
    return NextResponse.json({ error: 'The compounding status could not be saved. Try again.' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Ingredient not found' }, { status: 404 })

  console.info(`[ops/ingredients] compounding status set | ingredient=${ingredientId} | status=${status} | by=${user.id}`)
  return NextResponse.json({ ok: true, reviewedAt })
}
