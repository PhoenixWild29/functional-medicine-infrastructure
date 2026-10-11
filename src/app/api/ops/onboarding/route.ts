// ============================================================
// /api/ops/onboarding — clinic onboarding (ops_admin)
// ============================================================
//
// GET   invites and clinics in onboarding (for /ops/onboarding)
// POST  { clinicName, adminEmail } → create a clinic invite
//
// Creating an invite creates the clinic, INACTIVE and in onboarding
// ('invited'), and a single-use clinic_admin invite that expires in 7
// days. Only the SHA-256 hash of the token is stored; the link (returned
// once, here) carries the token. The action is audit-logged.

import { NextRequest, NextResponse } from 'next/server'
import { serverEnv } from '@/lib/env'
import { requireOpsAdmin, readJson, cleanEmail } from '@/lib/onboarding/access'
import { hashInviteToken, inviteExpiresAt, invitePath, newInviteToken } from '@/lib/onboarding/tokens'
import { recordOnboardingEvent } from '@/lib/onboarding/events'
import { loadOpsOnboarding } from '@/lib/onboarding/ops'

export async function GET(): Promise<NextResponse> {
  const access = await requireOpsAdmin()
  if (!access.ok) return access.response
  try {
    return NextResponse.json(await loadOpsOnboarding(access.supabase))
  } catch (err) {
    console.error('[ops/onboarding] list failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Onboarding could not be loaded. Try again.' }, { status: 503 })
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const access = await requireOpsAdmin()
  if (!access.ok) return access.response
  const { user, supabase } = access

  const body = await readJson(request)
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  const clinicName = typeof body['clinicName'] === 'string' ? body['clinicName'].trim().slice(0, 200) : ''
  const adminEmail = cleanEmail(body['adminEmail'])
  const errors: Record<string, string> = {}
  if (!clinicName) errors['clinicName'] = 'Enter the clinic name.'
  if (!adminEmail) errors['adminEmail'] = 'Enter the clinic admin’s email address.'
  if (Object.keys(errors).length > 0) return NextResponse.json({ error: 'Check the highlighted fields.', errors }, { status: 400 })

  const { data: clinic, error: clinicErr } = await supabase
    .from('clinics')
    .insert({ name: clinicName, is_active: false, onboarding_status: 'invited' })
    .select('clinic_id')
    .single()
  if (clinicErr || !clinic) {
    console.error('[ops/onboarding] clinic insert failed:', clinicErr?.message)
    return NextResponse.json({ error: 'The clinic could not be created. Try again.' }, { status: 500 })
  }

  const token = newInviteToken()
  const expiresAt = inviteExpiresAt().toISOString()
  const { data: invite, error: inviteErr } = await supabase
    .from('onboarding_invites')
    .insert({
      kind:       'clinic_admin',
      clinic_id:  clinic.clinic_id,
      email:      adminEmail!,
      token_hash: hashInviteToken(token),
      expires_at: expiresAt,
      created_by: user.id,
    })
    .select('invite_id')
    .single()
  if (inviteErr || !invite) {
    console.error(`[ops/onboarding] invite insert failed | clinic=${clinic.clinic_id}: ${inviteErr?.message}`)
    // Remove the clinic so a retry does not leave an orphan inactive clinic.
    const { error: cleanupErr } = await supabase.from('clinics').delete().eq('clinic_id', clinic.clinic_id)
    if (cleanupErr) console.error(`[ops/onboarding] orphan clinic left | clinic=${clinic.clinic_id}: ${cleanupErr.message}`)
    return NextResponse.json({ error: 'The invite could not be created. Try again.' }, { status: 500 })
  }

  await recordOnboardingEvent(supabase, {
    clinicId: clinic.clinic_id, event: 'invite_created', actorUserId: user.id, actorRole: 'ops_admin', inviteId: invite.invite_id,
  })
  console.info(`[ops/onboarding] invite created | clinic=${clinic.clinic_id} invite=${invite.invite_id}`)

  return NextResponse.json({
    inviteId:  invite.invite_id,
    clinicId:  clinic.clinic_id,
    link:      new URL(invitePath('clinic_admin', token), serverEnv.appBaseUrl()).toString(),
    expiresAt,
  }, { status: 201 })
}
