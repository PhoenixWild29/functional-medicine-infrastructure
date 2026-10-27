// ============================================================
// Ops deletes an unapproved self sign-up
// ============================================================
//
// Security review D-2026-10-24-05, M2 and M3: someone can sign up first
// with another person's email or NPI. Nothing is ordered until ops
// approves, but the squatted account must be removable. From the ops
// review page (POST /api/ops/onboarding/clinics/[clinicId] { action:
// 'delete_signup', confirm: true }), ops_admin only.
//
// Only a self sign-up (signup_source 'self_serve') that ops has not
// approved. In this order, so a failure never leaves a login without its
// clinic's records or the other way round:
//   1. the provider rows, with their licenses and NPI checks (a provider
//      that cannot be removed, e.g. one with orders, stops here: 503);
//   2. the wizard steps; open invites are revoked;
//   3. the logins: the providers' own, the sign-up's account holder
//      (the 'self_signup' event's actor) and accepted invitees, each only
//      if its app_metadata still names this clinic;
//   4. the clinic is soft-deleted (deleted_at, inactive): its onboarding
//      events are append-only and keep it;
//   5. 'signup_deleted' is recorded with who did it and the counts.
// Service role. No patient data.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { recordOnboardingEvent } from './events'

type Db = SupabaseClient<Database>

export type DeleteSignupResult =
  | { ok: true; removedLogins: number; removedProviders: number }
  | { ok: false; status: 404 | 409 | 503; error: string }

const UNAVAILABLE = { ok: false as const, status: 503 as const, error: 'The sign-up could not be deleted. Nothing was removed; try again.' }

export async function deleteSelfServeSignup(db: Db, input: { clinicId: string; actorUserId: string; now?: Date }): Promise<DeleteSignupResult> {
  const now = (input.now ?? new Date()).toISOString()
  const { data: clinic, error } = await db.from('clinics')
    .select('clinic_id, name, signup_source, onboarding_status, deleted_at')
    .eq('clinic_id', input.clinicId)
    .maybeSingle()
  if (error) {
    console.error(`[delete-signup] clinic read failed | clinic=${input.clinicId}: ${error.message}`)
    return UNAVAILABLE
  }
  const c = clinic as { clinic_id: string; signup_source: string | null; onboarding_status: string | null; deleted_at: string | null } | null
  if (!c || c.deleted_at) return { ok: false, status: 404, error: 'Clinic not found' }
  if (c.signup_source !== 'self_serve' || c.onboarding_status === 'approved') {
    return { ok: false, status: 409, error: 'Only a self sign-up that ops has not approved can be deleted.' }
  }

  const [provRes, eventsRes, invitesRes] = await Promise.all([
    db.from('providers').select('provider_id, user_id').eq('clinic_id', c.clinic_id),
    db.from('clinic_onboarding_events').select('actor_user_id').eq('clinic_id', c.clinic_id).eq('event', 'self_signup'),
    db.from('onboarding_invites').select('accepted_user_id').eq('clinic_id', c.clinic_id),
  ])
  if (provRes.error || eventsRes.error || invitesRes.error) {
    console.error(`[delete-signup] read failed | clinic=${c.clinic_id}: ${(provRes.error ?? eventsRes.error ?? invitesRes.error)?.message}`)
    return UNAVAILABLE
  }
  const providers = (provRes.data ?? []) as Array<{ provider_id: string; user_id: string | null }>
  const providerIds = providers.map(p => p.provider_id)
  const loginIds = [...new Set([
    ...providers.map(p => p.user_id),
    ...((eventsRes.data ?? []) as Array<{ actor_user_id: string | null }>).map(e => e.actor_user_id),
    ...((invitesRes.data ?? []) as Array<{ accepted_user_id: string | null }>).map(i => i.accepted_user_id),
  ].filter((id): id is string => !!id))]

  // ── 1. The provider rows ──
  if (providerIds.length > 0) {
    for (const table of ['provider_npi_verifications', 'provider_state_licenses'] as const) {
      const { error: delErr } = await db.from(table).delete().in('provider_id', providerIds)
      if (delErr) {
        console.error(`[delete-signup] ${table} not removed | clinic=${c.clinic_id}: ${delErr.message}`)
        return UNAVAILABLE
      }
    }
    const { error: provErr } = await db.from('providers').delete().in('provider_id', providerIds)
    if (provErr) {
      console.error(`[delete-signup] providers not removed | clinic=${c.clinic_id}: ${provErr.message}`)
      return UNAVAILABLE
    }
  }

  // ── 2. Wizard steps; open invites revoked ──
  const { error: stepsErr } = await db.from('clinic_onboarding_steps').delete().eq('clinic_id', c.clinic_id)
  if (stepsErr) console.error(`[delete-signup] wizard steps left | clinic=${c.clinic_id}: ${stepsErr.message}`)
  const { error: invErr } = await db.from('onboarding_invites')
    .update({ revoked_at: now, revoked_by: input.actorUserId })
    .eq('clinic_id', c.clinic_id)
    .is('revoked_at', null)
    .is('accepted_at', null)
  if (invErr) console.error(`[delete-signup] open invites not revoked | clinic=${c.clinic_id}: ${invErr.message}`)

  // ── 3. The logins, only while they still name this clinic ──
  let removedLogins = 0
  for (const id of loginIds) {
    const { data: found, error: getErr } = await db.auth.admin.getUserById(id)
    if (getErr || !found?.user) continue
    if ((found.user.app_metadata as Record<string, unknown> | undefined)?.['clinic_id'] !== c.clinic_id) continue
    const { error: delErr } = await db.auth.admin.deleteUser(id)
    if (delErr) {
      console.error(`[delete-signup] login not removed | clinic=${c.clinic_id} user=${id}: ${delErr.message}`)
      continue
    }
    removedLogins++
  }

  // ── 4. The clinic: soft-deleted (its events keep it) ──
  const { error: clinicErr } = await db.from('clinics').update({ deleted_at: now, is_active: false }).eq('clinic_id', c.clinic_id)
  if (clinicErr) console.error(`[delete-signup] CRITICAL: clinic not closed after its sign-up was removed | clinic=${c.clinic_id}: ${clinicErr.message}`)

  // ── 5. Recorded ──
  await recordOnboardingEvent(db, {
    clinicId: c.clinic_id, event: 'signup_deleted', actorUserId: input.actorUserId, actorRole: 'ops_admin',
    note: `Self sign-up deleted by ops: ${removedLogins} login${removedLogins === 1 ? '' : 's'}, ${providerIds.length} provider record${providerIds.length === 1 ? '' : 's'}.`,
  })
  console.info(`[delete-signup] deleted | clinic=${c.clinic_id} by=${input.actorUserId} logins=${removedLogins} providers=${providerIds.length}`)
  return { ok: true, removedLogins, removedProviders: providerIds.length }
}
