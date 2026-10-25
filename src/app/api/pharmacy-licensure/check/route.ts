// ============================================================
// GET /api/pharmacy-licensure/check (Compliance C5)
// ============================================================
//
// For the Review page: which session lines cannot go to their pharmacy for
// the patient's shipping state (no license there, an expired one, or no
// sterile coverage for a sterile product). The same rule batch-sign and
// the sign page enforce (lib/compliance/pharmacy-licensure), asked before
// the signature so Review can say why.
//
// Query: ?state=TX&lines=<JSON [{ key, pharmacyId, formulationId, catalogItemId }]>
// (ids only; read-only, so a GET)
// 200 { problems: [{ key, problem, message }] }
// 401 no verified user · 403 not a clinic user · 400 bad body · 503 the check could not run
//
// Any clinic user: the person building the batch is not always the signer.
//
// Input, after auth and before any read: the state is a US license state
// (lib/providers/states), each pharmacy, formulation and catalog id is an
// id (a bad id reaching Postgres was a 503), keys are bounded, 50 lines at
// most. An empty formulation or catalog id reads as none, as before.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { checkLinesLicensure, type LicensureLine } from '@/lib/compliance/pharmacy-licensure'
import { getUserRole } from '@/lib/auth/claims'
import { US_STATES } from '@/lib/providers/states'
import { MAX_NAME, uuid } from '@/lib/api/input'
import { z } from 'zod'

const NO_STORE = { 'Cache-Control': 'no-store' }
const CLINIC_ROLES = new Set(['clinic_admin', 'provider', 'medical_assistant'])
const MAX_LINES = 50

/** An optional product id: an id, or empty / null / absent (none). */
const optionalId = () => z.union([uuid(), z.literal('')]).nullish().transform(v => v || null)

const Line = z.object({
  key:           z.string().max(MAX_NAME),
  pharmacyId:    uuid(),
  formulationId: optionalId(),
  catalogItemId: optionalId(),
})
const Lines = z.array(Line).max(MAX_LINES)

function parseLines(raw: unknown): LicensureLine[] | null {
  const r = Lines.safeParse(raw)
  return r.success ? r.data : null
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const supabaseAuth = await createServerClient()
  // getUser() verifies the token with Supabase; a cookie session alone is not trusted.
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!CLINIC_ROLES.has(String(getUserRole(user) ?? ''))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const params = request.nextUrl.searchParams
  let rawLines: unknown = null
  try {
    rawLines = JSON.parse(params.get('lines') ?? 'null')
  } catch {
    return NextResponse.json({ error: 'lines must be JSON' }, { status: 400 })
  }
  const state = (params.get('state') ?? '').trim().toUpperCase()
  const lines = parseLines(rawLines)
  if (!US_STATES.has(state) || !lines) {
    return NextResponse.json({ error: 'state (two letters) and lines are required' }, { status: 400 })
  }

  try {
    const problems = await checkLinesLicensure(createServiceClient(), { state, lines })
    return NextResponse.json({ problems }, { headers: NO_STORE })
  } catch (err) {
    console.error('[pharmacy-licensure/check] could not run:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'The pharmacy license check could not run.' }, { status: 503, headers: NO_STORE })
  }
}
