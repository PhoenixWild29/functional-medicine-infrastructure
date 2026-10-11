// ============================================================
// POST /api/onboarding/invite/accept — public
// ============================================================
//
// { token, fullName, password } → creates the invitee's account.
//
// Public on purpose (middleware publicRoutes): the invitee has no account
// yet, and the token is the credential. The token is looked up by its
// SHA-256 hash; it must be pending (not accepted, revoked or expired).
//
//   1. Claim the invite (accepted_at, conditional on still pending), so a
//      double submit cannot create two accounts.
//   2. Create the auth user for the INVITED email (not one the caller
//      chooses), confirmed, with role and clinic in app_metadata via the
//      service role. Never user_metadata, which the user could rewrite.
//   3. A provider invite links the account to its provider row; a clinic
//      admin invite moves the clinic into onboarding ('in_progress').
// Any failure after the claim releases it (and removes a created user),
// so the link can be used again. MFA applies on first sign-in through the
// normal middleware gate.
//
// Rate limited per client IP (the first x-forwarded-for entry): 10
// attempts per 15 minutes, then 429 with Retry-After, before anything is
// read. Per IP, so a real invitee is never blocked by someone else's
// guesses. The token is never logged; a refusal logs only the IP's keyed
// hash and the outcome.

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { appMetadataFor } from '@/lib/auth/claims'
import { readJson } from '@/lib/onboarding/access'
import { hashInviteToken, inviteStatus, plausibleToken, type InviteKind } from '@/lib/onboarding/tokens'
import { recordOnboardingEvent } from '@/lib/onboarding/events'
import { auditHash, clientIp } from '@/lib/audit/keyed-hash'
import { inviteAcceptLimiter, INVITE_ACCEPT_RATE_LIMITED_MESSAGE } from '@/lib/onboarding/accept-rate-limit'

const MIN_PASSWORD_LENGTH = 12

export async function POST(request: NextRequest): Promise<NextResponse> {
  const ip = clientIp(request.headers)
  const limit = inviteAcceptLimiter.check(ip ?? 'unknown')
  if (!limit.allowed) {
    console.warn(`[onboarding/accept] rate_limited | ip_hash=${(await auditHash(ip)) ?? 'none'}`)
    return NextResponse.json(
      { error: INVITE_ACCEPT_RATE_LIMITED_MESSAGE },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    )
  }

  const body = await readJson(request)
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

  const token = body['token']
  const fullName = typeof body['fullName'] === 'string' ? body['fullName'].trim().slice(0, 200) : ''
  const password = typeof body['password'] === 'string' ? body['password'] : ''
  if (!plausibleToken(token)) return NextResponse.json({ error: 'This invite link is not valid.' }, { status: 404 })
  const errors: Record<string, string> = {}
  if (!fullName) errors['fullName'] = 'Enter your full name.'
  if (password.length < MIN_PASSWORD_LENGTH) errors['password'] = `Use at least ${MIN_PASSWORD_LENGTH} characters.`
  if (Object.keys(errors).length > 0) return NextResponse.json({ error: 'Check the highlighted fields.', errors }, { status: 400 })

  const supabase = createServiceClient()
  const { data: invite, error: lookupErr } = await supabase
    .from('onboarding_invites')
    .select('invite_id, kind, clinic_id, email, provider_id, accepted_at, revoked_at, expires_at')
    .eq('token_hash', hashInviteToken(token))
    .maybeSingle()
  if (lookupErr) {
    console.error('[onboarding/accept] invite lookup failed:', lookupErr.message)
    return NextResponse.json({ error: 'The invite could not be checked. Try again.' }, { status: 503 })
  }
  if (!invite) return NextResponse.json({ error: 'This invite link is not valid.' }, { status: 404 })

  const status = inviteStatus(invite)
  if (status !== 'pending') {
    const message = status === 'accepted'
      ? 'This invite has already been used. Sign in instead.'
      : status === 'revoked'
        ? 'This invite was withdrawn. Ask for a new one.'
        : 'This invite has expired. Ask for a new one.'
    return NextResponse.json({ error: message, status }, { status: 410 })
  }

  const kind = invite.kind as InviteKind
  const now = new Date().toISOString()

  // 1. Claim.
  const { data: claimed, error: claimErr } = await supabase
    .from('onboarding_invites')
    .update({ accepted_at: now })
    .eq('invite_id', invite.invite_id)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .gt('expires_at', now)
    .select('invite_id')
  if (claimErr) {
    console.error(`[onboarding/accept] claim failed | invite=${invite.invite_id}: ${claimErr.message}`)
    return NextResponse.json({ error: 'The invite could not be accepted. Try again.' }, { status: 503 })
  }
  if (!claimed || claimed.length === 0) {
    return NextResponse.json({ error: 'This invite has already been used. Sign in instead.', status: 'accepted' }, { status: 410 })
  }

  const release = async () => {
    const { error } = await supabase.from('onboarding_invites').update({ accepted_at: null, accepted_user_id: null }).eq('invite_id', invite.invite_id)
    if (error) console.error(`[onboarding/accept] CRITICAL: claim could not be released | invite=${invite.invite_id}: ${error.message}`)
  }

  // 2. The account, with role and clinic in app_metadata.
  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email:         invite.email,
    password,
    email_confirm: true,
    app_metadata:  appMetadataFor({ role: kind, clinicId: invite.clinic_id }),
    user_metadata: { full_name: fullName },
  })
  if (createErr || !created?.user) {
    await release()
    const msg = createErr?.message ?? 'unknown'
    if (/already/i.test(msg)) {
      return NextResponse.json({ error: 'An account with this email already exists. Sign in instead, or ask CompoundIQ for help.' }, { status: 409 })
    }
    if (/password/i.test(msg)) {
      return NextResponse.json({ error: 'That password is not strong enough. Try a longer one.', errors: { password: msg } }, { status: 400 })
    }
    console.error(`[onboarding/accept] createUser failed | invite=${invite.invite_id}: ${msg}`)
    return NextResponse.json({ error: 'Your account could not be created. Try again.' }, { status: 500 })
  }
  const userId = created.user.id

  const rollback = async (why: string) => {
    console.error(`[onboarding/accept] rolling back | invite=${invite.invite_id} user=${userId}: ${why}`)
    const { error } = await supabase.auth.admin.deleteUser(userId)
    if (error) console.error(`[onboarding/accept] CRITICAL: user could not be removed | user=${userId}: ${error.message}`)
    await release()
    return NextResponse.json({ error: 'Your account could not be set up. Try again.' }, { status: 500 })
  }

  // 3. Link.
  if (kind === 'provider') {
    if (!invite.provider_id) return rollback('provider invite has no provider row')
    const { data: linked, error: linkErr } = await supabase
      .from('providers')
      .update({ user_id: userId })
      .eq('provider_id', invite.provider_id)
      .eq('clinic_id', invite.clinic_id)
      .is('user_id', null)
      .select('provider_id')
    if (linkErr || !linked || linked.length === 0) return rollback(linkErr?.message ?? 'provider row already linked')
  }

  const { error: stampErr } = await supabase.from('onboarding_invites').update({ accepted_user_id: userId }).eq('invite_id', invite.invite_id)
  if (stampErr) console.error(`[onboarding/accept] accepted_user_id not stamped | invite=${invite.invite_id}: ${stampErr.message}`)

  if (kind === 'clinic_admin') {
    const { error: clinicErr } = await supabase
      .from('clinics')
      .update({ onboarding_status: 'in_progress', updated_at: now })
      .eq('clinic_id', invite.clinic_id)
      .eq('onboarding_status', 'invited')
    if (clinicErr) console.error(`[onboarding/accept] clinic status not moved | clinic=${invite.clinic_id}: ${clinicErr.message}`)
  }

  await recordOnboardingEvent(supabase, {
    clinicId: invite.clinic_id, event: 'invite_accepted', actorUserId: userId, actorRole: kind, inviteId: invite.invite_id,
  })
  console.info(`[onboarding/accept] account created | invite=${invite.invite_id} role=${kind}`)

  return NextResponse.json({
    email: invite.email,
    role:  kind,
    next:  kind === 'clinic_admin' ? '/onboarding' : '/',
  }, { status: 201 })
}
