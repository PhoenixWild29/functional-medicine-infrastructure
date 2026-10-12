// ============================================================
// POST /api/onboarding/staff — onboarding step 3 (clinic admin)
// ============================================================
//
// { email } → invite a medical assistant (medical_assistant role in
// app_metadata when they accept). Returns the link once. Staff is
// optional; the step completes with or without assistants.

import { NextRequest, NextResponse } from 'next/server'
import { requireOnboardingAdmin, readJson, cleanEmail, setStep } from '@/lib/onboarding/access'
import { createInvite } from '@/lib/onboarding/invite-actions'

export async function POST(request: NextRequest): Promise<NextResponse> {
  const access = await requireOnboardingAdmin({ editable: true })
  if (!access.ok) return access.response
  const { user, clinicId, supabase } = access

  const body = await readJson(request)
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  const email = cleanEmail(body['email'])
  if (!email) return NextResponse.json({ error: 'Check the highlighted fields.', errors: { email: 'Enter the assistant’s email address.' } }, { status: 400 })

  const invite = await createInvite(supabase, { kind: 'medical_assistant', clinicId, email, createdBy: user.id, actorRole: 'clinic_admin' })
  if (!invite.ok) return NextResponse.json({ error: invite.error }, { status: 500 })
  await setStep(supabase, clinicId, 'staff', 'in_progress', user.id)
  return NextResponse.json({ inviteId: invite.inviteId, link: invite.link, expiresAt: invite.expiresAt }, { status: 201 })
}
