// ============================================================
// Pharmacy invites: ops side, and the invitee's acceptance
// ============================================================
//
// Service-role reads and writes; the routes check who is asking first
// (ops_admin for create / list / revoke / resend; anyone holding a valid
// link for inviteForToken / acceptInvite).

import { randomBytes } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { appMetadataFor } from '@/lib/auth/claims'
import { AUDIT_UNAVAILABLE, recordOnboardingEvent, type OnboardingActor } from './events'
import { generateInviteToken, hashInviteToken, inviteExpiry, inviteLink, inviteState, isWellFormedToken, type InviteState } from './invite-token'
import { normalizeEmail } from './validate'

export type Fail = { ok: false; status: number; error: string; errors?: Record<string, string> }

export interface InviteSummary {
  inviteId:     string
  pharmacyName: string
  adminEmail:   string
  state:        InviteState
  expiresAt:    string
  createdAt:    string
  lastSentAt:   string
  sendCount:    number
  acceptedAt:   string | null
  pharmacyId:   string | null
}

interface InviteRow {
  invite_id:        string
  pharmacy_name:    string
  admin_email:      string
  token_hash:       string
  expires_at:       string
  created_at:       string
  last_sent_at:     string
  send_count:       number
  accepted_at:      string | null
  accepted_user_id: string | null
  pharmacy_id:      string | null
  revoked_at:       string | null
}

const INVITE_COLUMNS = 'invite_id, pharmacy_name, admin_email, token_hash, expires_at, created_at, last_sent_at, send_count, accepted_at, accepted_user_id, pharmacy_id, revoked_at'

function summary(r: InviteRow, now: Date): InviteSummary {
  return {
    inviteId: r.invite_id,
    pharmacyName: r.pharmacy_name,
    adminEmail: r.admin_email,
    state: inviteState(r, now),
    expiresAt: r.expires_at,
    createdAt: r.created_at,
    lastSentAt: r.last_sent_at,
    sendCount: r.send_count,
    acceptedAt: r.accepted_at ?? null,
    pharmacyId: r.pharmacy_id ?? null,
  }
}

const READ_FAILED: Fail = { ok: false, status: 503, error: 'Invites could not be read. Nothing was changed. Try again.' }

// ── Ops ──────────────────────────────────────────────────────

export async function createInvite(
  db: SupabaseClient,
  input: { actor: OnboardingActor; pharmacyName: unknown; adminEmail: unknown },
  now: Date = new Date(),
): Promise<{ ok: true; invite: InviteSummary; link: string } | Fail> {
  const name = typeof input.pharmacyName === 'string' ? input.pharmacyName.trim() : ''
  const email = normalizeEmail(input.adminEmail)
  const errors: Record<string, string> = {}
  if (name.length < 2 || name.length > 200) errors['pharmacyName'] = 'Enter the pharmacy name.'
  if (!email) errors['adminEmail'] = 'Enter the pharmacy administrator’s email address.'
  if (!email || Object.keys(errors).length > 0) return { ok: false, status: 400, error: 'Check the highlighted fields.', errors }

  const open = await db.from('pharmacy_invites').select('invite_id').eq('admin_email', email).is('accepted_at', null).is('revoked_at', null).limit(1)
  if (open.error) return READ_FAILED
  if ((open.data ?? []).length > 0) {
    return { ok: false, status: 409, error: 'This email already has an open invite. Resend or revoke it instead.' }
  }

  const inviteId = crypto.randomUUID()
  if (!await recordOnboardingEvent(db, { actor: input.actor, action: 'invite_created', inviteId })) {
    return { ok: false, status: 503, error: AUDIT_UNAVAILABLE }
  }

  const { token, hash } = generateInviteToken()
  const { data, error } = await db.from('pharmacy_invites').insert({
    invite_id: inviteId,
    pharmacy_name: name,
    admin_email: email,
    token_hash: hash,
    expires_at: inviteExpiry(now),
    created_by: input.actor.userId,
    created_at: now.toISOString(),
    last_sent_at: now.toISOString(),
    send_count: 1,
  }).select(INVITE_COLUMNS).single()
  if (error || !data) {
    await recordOnboardingEvent(db, { actor: input.actor, action: 'invite_create_failed', inviteId })
    return error?.code === '23505'
      ? { ok: false, status: 409, error: 'This email already has an open invite. Resend or revoke it instead.' }
      : { ok: false, status: 503, error: 'The invite could not be created. Try again.' }
  }
  return { ok: true, invite: summary(data as InviteRow, now), link: inviteLink(token) }
}

export async function listInvites(db: SupabaseClient, now: Date = new Date()): Promise<{ ok: true; invites: InviteSummary[] } | Fail> {
  const { data, error } = await db.from('pharmacy_invites').select(INVITE_COLUMNS).order('created_at', { ascending: false }).limit(200)
  if (error) return READ_FAILED
  return { ok: true, invites: ((data ?? []) as InviteRow[]).map(r => summary(r, now)) }
}

async function readInvite(db: SupabaseClient, inviteId: string): Promise<InviteRow | null | 'error'> {
  const { data, error } = await db.from('pharmacy_invites').select(INVITE_COLUMNS).eq('invite_id', inviteId).maybeSingle()
  if (error) return 'error'
  return (data as InviteRow | null) ?? null
}

export async function revokeInvite(
  db: SupabaseClient,
  input: { actor: OnboardingActor; inviteId: string },
  now: Date = new Date(),
): Promise<{ ok: true; invite: InviteSummary } | Fail> {
  const row = await readInvite(db, input.inviteId)
  if (row === 'error') return READ_FAILED
  if (!row) return { ok: false, status: 404, error: 'Invite not found.' }
  const state = inviteState(row, now)
  if (state === 'accepted' || state === 'revoked') return { ok: false, status: 409, error: `This invite was already ${state}.` }

  if (!await recordOnboardingEvent(db, { actor: input.actor, action: 'invite_revoked', inviteId: row.invite_id })) {
    return { ok: false, status: 503, error: AUDIT_UNAVAILABLE }
  }
  const { data, error } = await db.from('pharmacy_invites')
    .update({ revoked_at: now.toISOString(), revoked_by: input.actor.userId })
    .eq('invite_id', row.invite_id).is('accepted_at', null).is('revoked_at', null)
    .select(INVITE_COLUMNS)
  const updated = (data ?? []) as InviteRow[]
  if (error || updated.length === 0) {
    await recordOnboardingEvent(db, { actor: input.actor, action: 'invite_revoke_failed', inviteId: row.invite_id })
    return error ? { ok: false, status: 503, error: 'The invite could not be revoked. Try again.' } : { ok: false, status: 409, error: 'This invite was used or revoked meanwhile.' }
  }
  return { ok: true, invite: summary(updated[0]!, now) }
}

export async function resendInvite(
  db: SupabaseClient,
  input: { actor: OnboardingActor; inviteId: string },
  now: Date = new Date(),
): Promise<{ ok: true; invite: InviteSummary; link: string } | Fail> {
  const row = await readInvite(db, input.inviteId)
  if (row === 'error') return READ_FAILED
  if (!row) return { ok: false, status: 404, error: 'Invite not found.' }
  const state = inviteState(row, now)
  if (state === 'accepted' || state === 'revoked') return { ok: false, status: 409, error: `This invite was ${state}. Create a new one instead.` }

  if (!await recordOnboardingEvent(db, { actor: input.actor, action: 'invite_resent', inviteId: row.invite_id })) {
    return { ok: false, status: 503, error: AUDIT_UNAVAILABLE }
  }
  const { token, hash } = generateInviteToken()
  const { data, error } = await db.from('pharmacy_invites')
    .update({ token_hash: hash, expires_at: inviteExpiry(now), last_sent_at: now.toISOString(), send_count: row.send_count + 1 })
    .eq('invite_id', row.invite_id).is('accepted_at', null).is('revoked_at', null)
    .select(INVITE_COLUMNS)
  const updated = (data ?? []) as InviteRow[]
  if (error || updated.length === 0) {
    await recordOnboardingEvent(db, { actor: input.actor, action: 'invite_resend_failed', inviteId: row.invite_id })
    return error ? { ok: false, status: 503, error: 'A new link could not be issued. Try again.' } : { ok: false, status: 409, error: 'This invite was used or revoked meanwhile.' }
  }
  return { ok: true, invite: summary(updated[0]!, now), link: inviteLink(token) }
}

// ── The invitee ──────────────────────────────────────────────

export async function inviteForToken(
  db: SupabaseClient,
  token: unknown,
  now: Date = new Date(),
): Promise<{ state: InviteState; pharmacyName: string; adminEmail: string; expiresAt: string } | null | 'error'> {
  if (!isWellFormedToken(token)) return null
  const { data, error } = await db.from('pharmacy_invites').select(INVITE_COLUMNS).eq('token_hash', hashInviteToken(token)).maybeSingle()
  if (error) return 'error'
  if (!data) return null
  const r = data as InviteRow
  return { state: inviteState(r, now), pharmacyName: r.pharmacy_name, adminEmail: r.admin_email, expiresAt: r.expires_at }
}

const MIN_PASSWORD = 12

function slugFor(name: string): string {
  const base = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'pharmacy'
  return `${base}-${randomBytes(3).toString('hex')}`
}

export async function acceptInvite(
  db: SupabaseClient,
  input: { token: unknown; fullName: unknown; password: unknown },
  now: Date = new Date(),
): Promise<{ ok: true; email: string } | Fail> {
  const errors: Record<string, string> = {}
  const fullName = typeof input.fullName === 'string' ? input.fullName.trim() : ''
  const password = typeof input.password === 'string' ? input.password : ''
  if (fullName.length < 2 || fullName.length > 100) errors['fullName'] = 'Enter your full name.'
  if (password.length < MIN_PASSWORD) errors['password'] = `Use at least ${MIN_PASSWORD} characters.`
  else if (new TextEncoder().encode(password).length > 72) errors['password'] = 'Use at most 72 characters.'
  if (Object.keys(errors).length > 0) return { ok: false, status: 400, error: 'Check the highlighted fields.', errors }

  if (!isWellFormedToken(input.token)) return { ok: false, status: 404, error: 'This invite link is not valid.' }
  const { data: found, error: readError } = await db.from('pharmacy_invites').select(INVITE_COLUMNS).eq('token_hash', hashInviteToken(input.token)).maybeSingle()
  if (readError) return { ok: false, status: 503, error: 'The invite could not be read. Try again.' }
  if (!found) return { ok: false, status: 404, error: 'This invite link is not valid.' }
  const invite = found as InviteRow
  const state = inviteState(invite, now)
  if (state === 'accepted') return { ok: false, status: 409, error: 'This invite was already used. Sign in instead.' }
  if (state === 'revoked') return { ok: false, status: 410, error: 'This invite was withdrawn. Ask CompoundIQ for a new one.' }
  if (state === 'expired') return { ok: false, status: 410, error: 'This invite has expired. Ask CompoundIQ to send a new one.' }

  // 1. The pharmacy, inactive while onboarding (it never reaches the
  //    builder or routing until ops approves).
  const { data: pharmacy, error: pharmacyError } = await db.from('pharmacies').insert({
    name: invite.pharmacy_name,
    slug: slugFor(invite.pharmacy_name),
    integration_tier: 'TIER_4_FAX',
    is_active: false,
    onboarding_status: 'onboarding',
    email: invite.admin_email,
  }).select('pharmacy_id').single()
  if (pharmacyError || !pharmacy) {
    console.error('[pharmacy-onboarding] pharmacy could not be created:', pharmacyError?.code ?? 'no row')
    return { ok: false, status: 503, error: 'Your account could not be created. Try again.' }
  }
  const pharmacyId = (pharmacy as { pharmacy_id: string }).pharmacy_id
  // Undo steps: each failure is logged; the pharmacy left behind is inactive.
  const dropPharmacy = async () => {
    const { error } = await db.from('pharmacies').delete().eq('pharmacy_id', pharmacyId)
    if (error) console.error(`[pharmacy-onboarding] CRITICAL: onboarding pharmacy not removed after a failed acceptance | pharmacy=${pharmacyId}:`, error.code ?? error.message)
  }

  // 2. The account: role and pharmacy in app_metadata (service role only).
  const { data: created, error: userError } = await db.auth.admin.createUser({
    email: invite.admin_email,
    password,
    email_confirm: true,
    app_metadata: appMetadataFor({ role: 'pharmacy_admin', clinicId: null, pharmacyId }),
    user_metadata: { full_name: fullName },
  })
  if (userError || !created?.user) {
    await dropPharmacy()
    const exists = (userError as { code?: string } | null)?.code === 'email_exists' || /already/i.test(userError?.message ?? '')
    if (exists) return { ok: false, status: 409, error: 'An account already uses this email. Sign in, or ask CompoundIQ for an invite to another email.' }
    console.error('[pharmacy-onboarding] account could not be created:', (userError as { code?: string } | null)?.code ?? 'no user')
    return { ok: false, status: 503, error: 'Your account could not be created. Try again.' }
  }
  const userId = created.user.id
  const dropUser = async () => {
    const { error } = await db.auth.admin.deleteUser(userId)
    if (error) console.error(`[pharmacy-onboarding] CRITICAL: pharmacy_admin account not removed after a failed acceptance | user=${userId}:`, error.message)
  }

  // 3. Claim the invite: single use, still open, not expired.
  const { data: claimed, error: claimError } = await db.from('pharmacy_invites')
    .update({ accepted_at: now.toISOString(), accepted_user_id: userId, pharmacy_id: pharmacyId })
    .eq('invite_id', invite.invite_id).is('accepted_at', null).is('revoked_at', null).gt('expires_at', now.toISOString())
    .select('invite_id')
  if (claimError || (claimed ?? []).length === 0) {
    await dropUser()
    await dropPharmacy()
    return claimError
      ? { ok: false, status: 503, error: 'Your account could not be created. Try again.' }
      : { ok: false, status: 409, error: 'This invite was used or withdrawn meanwhile.' }
  }
  const unclaim = async () => {
    const { error } = await db.from('pharmacy_invites').update({ accepted_at: null, accepted_user_id: null, pharmacy_id: null }).eq('invite_id', invite.invite_id)
    if (error) console.error(`[pharmacy-onboarding] CRITICAL: invite left claimed after a failed acceptance | invite=${invite.invite_id}:`, error.code ?? error.message)
  }

  // 4. The application.
  const { data: application, error: appError } = await db.from('pharmacy_onboarding_applications').insert({
    pharmacy_id: pharmacyId,
    invite_id: invite.invite_id,
    admin_user_id: userId,
    status: 'in_progress',
    steps_completed: [],
  }).select('application_id').single()
  if (appError || !application) {
    await unclaim()
    await dropUser()
    await dropPharmacy()
    console.error('[pharmacy-onboarding] application could not be created:', appError?.code ?? 'no row')
    return { ok: false, status: 503, error: 'Your account could not be created. Try again.' }
  }

  await recordOnboardingEvent(db, {
    actor: { userId, role: 'pharmacy_admin' }, action: 'invite_accepted',
    inviteId: invite.invite_id, pharmacyId, applicationId: (application as { application_id: string }).application_id,
  })
  return { ok: true, email: invite.admin_email }
}
