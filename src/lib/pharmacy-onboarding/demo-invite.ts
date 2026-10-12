// ============================================================
// The demo pharmacy invite (seed)
// ============================================================
//
// One invite for reviewing the pharmacy portal end to end. Only a token's
// hash is stored, so the link can only be shown when it is issued: the
// seed (scripts/seed-demo-pharmacy-invite.ts) prints it. Run again, it
// issues a new link for the same open invite instead of a second invite.
// Audit-logged with the system as the actor.

import type { SupabaseClient } from '@supabase/supabase-js'
import { createInvite, resendInvite, type Fail } from './invites'
import { inviteState } from './invite-token'

export const DEMO_INVITE = {
  pharmacyName: 'Demo Compounding Pharmacy',
  adminEmail:   'pharmacy-admin@compoundiq-poc.com',
} as const

/** Not a person: the seed. created_by is required; this is the nil UUID. */
export const SYSTEM_ACTOR = { userId: '00000000-0000-0000-0000-000000000000', role: 'system' } as const

export async function seedDemoPharmacyInvite(
  db: SupabaseClient,
  now: Date = new Date(),
): Promise<{ ok: true; action: 'created' | 'reissued' | 'already_accepted'; link: string | null } | Fail> {
  const { data, error } = await db.from('pharmacy_invites')
    .select('invite_id, expires_at, accepted_at, revoked_at')
    .eq('admin_email', DEMO_INVITE.adminEmail)
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) return { ok: false, status: 503, error: `The demo invite could not be read: ${error.message}` }
  const latest = ((data ?? []) as Array<{ invite_id: string; expires_at: string; accepted_at: string | null; revoked_at: string | null }>)[0]

  if (latest) {
    const state = inviteState(latest, now)
    if (state === 'accepted') return { ok: true, action: 'already_accepted', link: null }
    if (state === 'pending' || state === 'expired') {
      const r = await resendInvite(db, { actor: SYSTEM_ACTOR, inviteId: latest.invite_id }, now)
      return r.ok ? { ok: true, action: 'reissued', link: r.link } : r
    }
  }
  const r = await createInvite(db, { actor: SYSTEM_ACTOR, pharmacyName: DEMO_INVITE.pharmacyName, adminEmail: DEMO_INVITE.adminEmail }, now)
  return r.ok ? { ok: true, action: 'created', link: r.link } : r
}
