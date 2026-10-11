// ============================================================
// Look up an invite for the /onboard pages (server-side)
// ============================================================
//
// By the SHA-256 hash of the token in the link. Returns what the page
// shows: the clinic name, the invited email, the role and the status.
// Nothing is changed; accepting goes through POST
// /api/onboarding/invite/accept.

import { createServiceClient } from '@/lib/supabase/service'
import { hashInviteToken, inviteStatus, plausibleToken, type InviteKind, type InviteStatus } from './tokens'

export interface InviteForPage {
  kind:       InviteKind
  clinicName: string
  email:      string
  status:     InviteStatus | 'not_found'
}

export async function lookupInviteForPage(token: string, expectAdmin: boolean): Promise<InviteForPage> {
  const notFound: InviteForPage = { kind: expectAdmin ? 'clinic_admin' : 'provider', clinicName: '', email: '', status: 'not_found' }
  if (!plausibleToken(token)) return notFound
  const { data, error } = await createServiceClient()
    .from('onboarding_invites')
    .select('kind, email, accepted_at, revoked_at, expires_at, clinics(name)')
    .eq('token_hash', hashInviteToken(token))
    .maybeSingle()
  if (error) {
    console.error('[onboard] invite lookup failed:', error.message)
    throw new Error('The invite could not be checked. Try again.')
  }
  if (!data) return notFound
  const isAdmin = data.kind === 'clinic_admin'
  // A clinic link opens only a clinic admin invite, and a join link only staff.
  if (isAdmin !== expectAdmin) return notFound
  return {
    kind:       data.kind as InviteKind,
    clinicName: (data.clinics as { name?: string } | null)?.name ?? 'your clinic',
    email:      data.email,
    status:     inviteStatus(data),
  }
}
