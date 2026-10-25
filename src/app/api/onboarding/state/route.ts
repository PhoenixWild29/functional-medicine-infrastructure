// ============================================================
// GET /api/onboarding/state — the wizard's state (clinic admin)
// ============================================================
//
// The clinic admin's own onboarding state, as /onboarding renders it.
// The wizard re-reads it after every save so the step list updates at
// once. Read-only, so a submitted or approved clinic can still read it.
// The caller is verified with getUser(); role and clinic come only from
// app_metadata (requireOnboardingAdmin).

import { NextResponse } from 'next/server'
import { requireOnboardingAdmin } from '@/lib/onboarding/access'
import { loadOnboardingState } from '@/lib/onboarding/state'
import { withApiErrors } from '@/lib/api/with-api-errors'

export const dynamic = 'force-dynamic'

async function getHandler(): Promise<NextResponse> {
  const access = await requireOnboardingAdmin()
  if (!access.ok) return access.response
  const { clinicId, supabase } = access
  try {
    const state = await loadOnboardingState(supabase, clinicId)
    if (state) return NextResponse.json(state, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error(`[onboarding/state] load failed | clinic=${clinicId}:`, err instanceof Error ? err.message : err)
  }
  return NextResponse.json({ error: 'Your onboarding could not be loaded. Try again.' }, { status: 503 })
}

export const GET = withApiErrors('/api/onboarding/state', getHandler)
