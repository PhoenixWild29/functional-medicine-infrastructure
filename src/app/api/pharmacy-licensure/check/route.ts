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

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { checkLinesLicensure, type LicensureLine } from '@/lib/compliance/pharmacy-licensure'
import { getUserRole } from '@/lib/auth/claims'

const NO_STORE = { 'Cache-Control': 'no-store' }
const CLINIC_ROLES = new Set(['clinic_admin', 'provider', 'medical_assistant'])
const MAX_LINES = 50

function parseLines(raw: unknown): LicensureLine[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_LINES) return null
  const lines: LicensureLine[] = []
  for (const r of raw) {
    const o = r as Record<string, unknown>
    if (typeof o?.['key'] !== 'string' || typeof o['pharmacyId'] !== 'string') return null
    const formulationId = typeof o['formulationId'] === 'string' ? o['formulationId'] : null
    const catalogItemId = typeof o['catalogItemId'] === 'string' ? o['catalogItemId'] : null
    lines.push({ key: o['key'], pharmacyId: o['pharmacyId'], formulationId, catalogItemId })
  }
  return lines
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
  if (!/^[A-Z]{2}$/.test(state) || !lines) {
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
