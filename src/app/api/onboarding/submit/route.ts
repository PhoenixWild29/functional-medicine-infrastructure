// ============================================================
// POST /api/onboarding/submit — send onboarding for ops review
// ============================================================
//
// Needs practice, providers, BAA and terms complete (409 with the list
// otherwise). Sets the clinic 'submitted' (the wizard is then read-only
// until ops approves or sends it back) and logs it. The clinic stays
// inactive until ops approves.

import { NextResponse } from 'next/server'
import { requireOnboardingAdmin, setStep } from '@/lib/onboarding/access'
import { canSubmit, fullStatuses } from '@/lib/onboarding/steps'
import { recordOnboardingEvent } from '@/lib/onboarding/events'

export async function POST(): Promise<NextResponse> {
  const access = await requireOnboardingAdmin({ editable: true })
  if (!access.ok) return access.response
  const { user, clinicId, supabase } = access

  const { data: rows, error } = await supabase.from('clinic_onboarding_steps').select('step, status').eq('clinic_id', clinicId)
  if (error) return NextResponse.json({ error: 'Your progress could not be read. Try again.' }, { status: 503 })
  const check = canSubmit(fullStatuses(rows ?? []))
  if (!check.ok) return NextResponse.json({ error: 'Finish the remaining steps before submitting.', missing: check.missing }, { status: 409 })

  const now = new Date().toISOString()
  const { error: updErr } = await supabase
    .from('clinics')
    .update({ onboarding_status: 'submitted', onboarding_submitted_at: now, updated_at: now })
    .eq('clinic_id', clinicId)
    .in('onboarding_status', ['in_progress', 'changes_requested'])
  if (updErr) {
    console.error(`[onboarding/submit] failed | clinic=${clinicId}: ${updErr.message}`)
    return NextResponse.json({ error: 'Your onboarding could not be submitted. Try again.' }, { status: 500 })
  }
  await setStep(supabase, clinicId, 'review', 'complete', user.id)
  await recordOnboardingEvent(supabase, { clinicId, event: 'submitted', actorUserId: user.id, actorRole: 'clinic_admin' })
  console.info(`[onboarding/submit] submitted | clinic=${clinicId}`)
  return NextResponse.json({ ok: true, onboardingStatus: 'submitted' })
}
