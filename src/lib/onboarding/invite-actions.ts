// ============================================================
// Revoke and resend an onboarding invite
// ============================================================
//
// Shared by ops (clinic admin invites) and the clinic admin (provider and
// staff invites). Only a pending invite can be revoked or resent; an
// accepted one is 409. Resending issues a NEW token and expiry, so the
// old link stops working. Both are audit-logged.

import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { serverEnv } from '@/lib/env'
import { hashInviteToken, inviteExpiresAt, invitePath, newInviteToken, type InviteKind } from './tokens'
import { recordOnboardingEvent } from './events'

export interface InviteRow {
  invite_id:   string
  kind:        string
  clinic_id:   string
  email:       string
  accepted_at: string | null
  revoked_at:  string | null
  expires_at:  string
  sent_count:  number
}

export async function inviteAction(
  supabase: SupabaseClient<Database>,
  invite: InviteRow,
  action: unknown,
  actor: { userId: string; role: string },
): Promise<NextResponse> {
  if (action !== 'revoke' && action !== 'resend') {
    return NextResponse.json({ error: 'action must be revoke or resend' }, { status: 400 })
  }
  if (invite.accepted_at) return NextResponse.json({ error: 'This invite has already been accepted.' }, { status: 409 })

  const now = new Date().toISOString()
  if (action === 'revoke') {
    if (invite.revoked_at) return NextResponse.json({ ok: true, status: 'revoked' })
    const { error } = await supabase
      .from('onboarding_invites')
      .update({ revoked_at: now, revoked_by: actor.userId })
      .eq('invite_id', invite.invite_id)
      .is('accepted_at', null)
    if (error) {
      console.error(`[onboarding] revoke failed | invite=${invite.invite_id}: ${error.message}`)
      return NextResponse.json({ error: 'The invite could not be revoked. Try again.' }, { status: 500 })
    }
    await recordOnboardingEvent(supabase, { clinicId: invite.clinic_id, event: 'invite_revoked', actorUserId: actor.userId, actorRole: actor.role, inviteId: invite.invite_id })
    return NextResponse.json({ ok: true, status: 'revoked' })
  }

  // resend: a new token and expiry; a revoked invite is reinstated.
  const token = newInviteToken()
  const expiresAt = inviteExpiresAt().toISOString()
  const { error } = await supabase
    .from('onboarding_invites')
    .update({
      token_hash:   hashInviteToken(token),
      expires_at:   expiresAt,
      sent_count:   invite.sent_count + 1,
      last_sent_at: now,
      revoked_at:   null,
      revoked_by:   null,
    })
    .eq('invite_id', invite.invite_id)
    .is('accepted_at', null)
  if (error) {
    console.error(`[onboarding] resend failed | invite=${invite.invite_id}: ${error.message}`)
    return NextResponse.json({ error: 'The invite could not be resent. Try again.' }, { status: 500 })
  }
  await recordOnboardingEvent(supabase, { clinicId: invite.clinic_id, event: 'invite_resent', actorUserId: actor.userId, actorRole: actor.role, inviteId: invite.invite_id })
  return NextResponse.json({
    ok:        true,
    status:    'pending',
    link:      new URL(invitePath(invite.kind as InviteKind, token), serverEnv.appBaseUrl()).toString(),
    expiresAt,
  })
}

export const INVITE_COLUMNS = 'invite_id, kind, clinic_id, email, accepted_at, revoked_at, expires_at, sent_count'

/** Create a pending invite; returns the link (carrying the token) once. */
export async function createInvite(
  supabase: SupabaseClient<Database>,
  i: { kind: InviteKind; clinicId: string; email: string; providerId?: string | null; createdBy: string; actorRole: string },
): Promise<{ ok: true; inviteId: string; link: string; expiresAt: string } | { ok: false; error: string }> {
  const token = newInviteToken()
  const expiresAt = inviteExpiresAt().toISOString()
  const { data, error } = await supabase
    .from('onboarding_invites')
    .insert({
      kind:        i.kind,
      clinic_id:   i.clinicId,
      email:       i.email,
      provider_id: i.providerId ?? null,
      token_hash:  hashInviteToken(token),
      expires_at:  expiresAt,
      created_by:  i.createdBy,
    })
    .select('invite_id')
    .single()
  if (error || !data) {
    console.error(`[onboarding] invite insert failed | clinic=${i.clinicId} kind=${i.kind}: ${error?.message}`)
    return { ok: false, error: 'The invite could not be created. Try again.' }
  }
  await recordOnboardingEvent(supabase, { clinicId: i.clinicId, event: 'invite_created', actorUserId: i.createdBy, actorRole: i.actorRole, inviteId: data.invite_id })
  return { ok: true, inviteId: data.invite_id, link: new URL(invitePath(i.kind, token), serverEnv.appBaseUrl()).toString(), expiresAt }
}
