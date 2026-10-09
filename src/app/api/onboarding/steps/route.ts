// ============================================================
// POST /api/onboarding/steps — complete a step (clinic admin)
// ============================================================
//
// { step: 'providers' | 'staff' } → checked here, then marked complete:
//   providers  at least one provider with a state license
//   staff      always (assistants are optional)
// Practice, BAA and terms complete only by saving / accepting them
// (their own endpoints), so they are 400 here; review is the submit.
// Payouts is not live for onboarding ("available at launch"): 400.

import { NextRequest, NextResponse } from 'next/server'
import { requireOnboardingAdmin, readJson, setStep } from '@/lib/onboarding/access'

export async function POST(request: NextRequest): Promise<NextResponse> {
  const access = await requireOnboardingAdmin({ editable: true })
  if (!access.ok) return access.response
  const { user, clinicId, supabase } = access

  const body = await readJson(request)
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  const step = body['step']
  if (step === 'payouts') {
    return NextResponse.json({ error: 'Payout setup is available at launch; there is nothing to complete yet.' }, { status: 400 })
  }
  if (step !== 'providers' && step !== 'staff') {
    return NextResponse.json({ error: 'This step completes by saving or accepting it.' }, { status: 400 })
  }

  if (step === 'providers') {
    const { data: providers, error } = await supabase
      .from('providers')
      .select('provider_id')
      .eq('clinic_id', clinicId)
      .is('deleted_at', null)
    if (error) return NextResponse.json({ error: 'Your providers could not be checked. Try again.' }, { status: 503 })
    const ids = (providers ?? []).map(p => p.provider_id)
    let licensed = false
    if (ids.length > 0) {
      const { data: lic, error: licErr } = await supabase.from('provider_state_licenses').select('provider_id').in('provider_id', ids)
      if (licErr) return NextResponse.json({ error: 'Provider licenses could not be checked. Try again.' }, { status: 503 })
      licensed = (lic ?? []).length > 0
    }
    if (!licensed) return NextResponse.json({ error: 'Add at least one provider with a state license.' }, { status: 409 })
  }

  const saved = await setStep(supabase, clinicId, step, 'complete', user.id)
  if (!saved.ok) return NextResponse.json({ error: 'Your progress could not be recorded. Try again.' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
