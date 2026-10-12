// ============================================================
// POST /api/settings/agreements — accept a new agreement version
// ============================================================
//
// { agreement: 'baa' | 'terms', version, signerName, signerTitle }
//
// After onboarding, when the BAA or the terms change, the clinic admin
// reviews and accepts the new version from /settings/agreements. Recorded
// exactly as the onboarding wizard does (lib/agreements/clinic-
// agreements): the current version and the SHA-256 of the server's copy
// of the text; a stale version is 409. Onboarding steps are not touched.
//
// Auth: getUser(); role and clinic from app_metadata (claims.ts) only.
// clinic_admin only; other clinic roles are read-only (403). The clinic
// is the caller's own, never one sent in the body.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getUserClinicId, getUserRole } from '@/lib/auth/claims'
import { isAgreementKey } from '@/lib/onboarding/agreements'
import { recordAgreementAcceptance } from '@/lib/agreements/clinic-agreements'

export async function POST(request: NextRequest): Promise<NextResponse> {
  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const clinicId = getUserClinicId(user)
  if (getUserRole(user) !== 'clinic_admin' || !clinicId) {
    return NextResponse.json({ error: 'Only the clinic admin can accept agreements.' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json() as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  const agreement = body['agreement']
  if (!isAgreementKey(agreement)) return NextResponse.json({ error: 'agreement must be baa or terms' }, { status: 400 })

  const result = await recordAgreementAcceptance(createServiceClient(), {
    clinicId, userId: user.id, agreement, version: body['version'], signerName: body['signerName'], signerTitle: body['signerTitle'],
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.error, ...(result.errors ? { errors: result.errors } : {}) }, { status: result.status })
  }
  return NextResponse.json({ ok: true, version: result.version }, { status: 201 })
}
