// ============================================================
// POST /api/settings/signup-link: manage the clinic's sign-up link
// ============================================================
//
// Patient Intake PR 3. The clinic admin only (medical assistants see the
// link read-only in Settings; providers and ops do not manage it):
//   { action: 'create' }   make a new link; the old one stops working
//   { action: 'disable' }  turn it off (patients are told it is no longer active)
//   { action: 'enable' }   turn it back on
// Create and enable are refused (403, the banner wording) until ops
// approves the clinic (lib/onboarding/approval-guard). Turning a link off
// stays allowed; Copy and Print never reach the server.
// The clinic comes from the caller's claims (claims.ts), never the request.
// getUser(), never getSession(). Same-origin only. Logs carry ids only.

import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getUserClinicId, getUserRole } from '@/lib/auth/claims'
import { createSignupLink, setSignupLinkEnabled } from '@/lib/intake/signup-links'
import { refuseUnlessApproved } from '@/lib/onboarding/approval-guard'

const FAILED = 'The sign-up link could not be changed. Try again.'

export async function POST(request: NextRequest): Promise<NextResponse> {
  const sfSite = request.headers.get('sec-fetch-site')
  if (sfSite && sfSite !== 'same-origin' && sfSite !== 'none') {
    return NextResponse.json({ error: 'Cross-site requests are not permitted' }, { status: 403 })
  }

  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (getUserRole(user) !== 'clinic_admin') {
    return NextResponse.json({ error: 'Only the clinic admin can change the patient sign-up link.' }, { status: 403 })
  }
  const clinicId = getUserClinicId(user)
  if (!clinicId) return NextResponse.json({ error: 'Session missing clinic_id' }, { status: 400 })

  let action: unknown
  try {
    action = ((await request.json()) as { action?: unknown } | null)?.action
  } catch {
    action = undefined
  }

  const service = createServiceClient()
  if (action === 'create' || action === 'enable') {
    const pendingReview = await refuseUnlessApproved(service, clinicId)
    if (pendingReview) return pendingReview
  }
  if (action === 'create') {
    const r = await createSignupLink(service, { clinicId, createdBy: user.id })
    if (!r.ok) return NextResponse.json({ error: FAILED }, { status: 500 })
    console.info(`[signup-link] new link | clinic=${clinicId} | link=${r.link.linkId}`)
    return NextResponse.json({ link: r.link })
  }
  if (action === 'disable' || action === 'enable') {
    const r = await setSignupLinkEnabled(service, { clinicId, enabled: action === 'enable' })
    if (!r.ok) {
      return r.error === 'none'
        ? NextResponse.json({ error: 'Your clinic does not have a sign-up link yet.' }, { status: 404 })
        : NextResponse.json({ error: FAILED }, { status: 500 })
    }
    console.info(`[signup-link] ${action}d | clinic=${clinicId} | link=${r.link.linkId}`)
    return NextResponse.json({ link: r.link })
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
