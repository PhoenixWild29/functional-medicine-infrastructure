// ============================================================
// The clinic's team: members and pending invites (Settings > Team)
// ============================================================
//
// Members are the clinic's logins (clinic_team_members, service role:
// auth.users by app_metadata clinic_id), each with role and whether a
// clinic admin deactivated them. Pending invites are the clinic's
// onboarding_invites not yet accepted or revoked (an expired one is shown
// as expired, to resend). No patient data. Server only.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { inviteStatus, type InviteKind } from '@/lib/onboarding/tokens'
export { ROLE_LABEL } from './display'

type Service = SupabaseClient<Database>

export interface TeamMember {
  userId: string
  email: string
  name: string | null
  role: string | null
  deactivatedAt: string | null
  lastSignInAt: string | null
}

export interface PendingInvite {
  inviteId: string
  kind: InviteKind
  email: string
  name: string | null
  status: 'pending' | 'expired'
  expiresAt: string
  lastSentAt: string
}

export const LAST_ADMIN_MESSAGE = 'A clinic needs at least one active clinic admin. Invite or reactivate another admin first.'

/** The clinic's logins, or null when they could not be read. */
export async function listTeamMembers(supabase: Service, clinicId: string): Promise<TeamMember[] | null> {
  const { data, error } = await supabase.rpc('clinic_team_members', { p_clinic_id: clinicId })
  if (error) {
    console.error(`[team] members read failed | clinic=${clinicId}: ${error.message}`)
    return null
  }
  return ((data ?? []) as Array<{ user_id: string; email: string; full_name: string | null; role: string | null; deactivated_at: string | null; last_sign_in_at: string | null }>)
    .map(m => ({ userId: m.user_id, email: m.email, name: m.full_name, role: m.role, deactivatedAt: m.deactivated_at, lastSignInAt: m.last_sign_in_at }))
}

/** The clinic's invites not yet accepted or revoked, or null when they could not be read. */
export async function listPendingInvites(supabase: Service, clinicId: string): Promise<PendingInvite[] | null> {
  const { data, error } = await supabase
    .from('onboarding_invites')
    .select('invite_id, kind, email, invitee_name, provider_id, expires_at, last_sent_at, accepted_at, revoked_at')
    .eq('clinic_id', clinicId)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
  if (error) {
    console.error(`[team] invites read failed | clinic=${clinicId}: ${error.message}`)
    return null
  }
  const rows = (data ?? []) as Array<{ invite_id: string; kind: string; email: string; invitee_name: string | null; provider_id: string | null; expires_at: string; last_sent_at: string; accepted_at: string | null; revoked_at: string | null }>

  // A provider invite is named by its provider row (one read, no embed).
  const providerIds = rows.map(r => r.provider_id).filter((id): id is string => !!id)
  const providerNames = new Map<string, string>()
  if (providerIds.length) {
    const { data: providers, error: pErr } = await supabase.from('providers').select('provider_id, first_name, last_name').in('provider_id', providerIds)
    if (pErr) console.error(`[team] provider names read failed | clinic=${clinicId}: ${pErr.message}`)
    for (const p of (providers ?? []) as Array<{ provider_id: string; first_name: string; last_name: string }>) {
      providerNames.set(p.provider_id, `${p.first_name} ${p.last_name}`)
    }
  }

  return rows.map(r => ({
    inviteId: r.invite_id,
    kind: r.kind as InviteKind,
    email: r.email,
    name: r.invitee_name ?? (r.provider_id ? providerNames.get(r.provider_id) ?? null : null),
    status: inviteStatus(r) === 'expired' ? 'expired' : 'pending',
    expiresAt: r.expires_at,
    lastSentAt: r.last_sent_at,
  }))
}

/** true when the email belongs to a team member or a pending invite; null when it could not be checked. */
export async function emailAlreadyOnTeam(supabase: Service, clinicId: string, email: string): Promise<boolean | null> {
  const members = await listTeamMembers(supabase, clinicId)
  if (!members) return null
  if (members.some(m => m.email.toLowerCase() === email)) return true
  const { data, error } = await supabase
    .from('onboarding_invites')
    .select('invite_id, expires_at')
    .eq('clinic_id', clinicId)
    .eq('email', email)
    .is('accepted_at', null)
    .is('revoked_at', null)
  if (error) {
    console.error(`[team] invite check failed | clinic=${clinicId}: ${error.message}`)
    return null
  }
  return ((data ?? []) as Array<{ expires_at: string }>).some(i => Date.parse(i.expires_at) > Date.now())
}
