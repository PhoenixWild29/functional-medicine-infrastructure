/**
 * @jest-environment node
 *
 * Pharmacy invites: ops creates, lists, revokes and resends; the invitee
 * opens the link and creates the pharmacy_admin account.
 *
 *   - Ops actions are audit-logged first (pharmacy_onboarding_events): an
 *     action whose audit row cannot be written does not happen.
 *   - Only the token's SHA-256 is stored; the link is shown once.
 *   - Revoke and resend apply to an invite not yet used; resend issues a
 *     new token and expiry, and the old link stops working.
 *   - Accepting: single-use, unexpired, unrevoked. It creates an inactive
 *     pharmacy (onboarding), a pharmacy_admin user with role and
 *     pharmacy_id in app_metadata (never user_metadata), and the
 *     application. Any failure part-way undoes what was created.
 */

import { onboardingFake } from '@/__tests__/helpers/onboarding-fake'
import { hashInviteToken } from '../invite-token'
import { createInvite, listInvites, revokeInvite, resendInvite, inviteForToken, acceptInvite } from '../invites'

const NOW = new Date('2026-10-09T12:00:00.000Z')
const OPS = { userId: '11111111-1111-4111-8111-111111111111', role: 'ops_admin' }

beforeAll(() => { process.env['APP_BASE_URL'] = 'https://app.example' })
const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
afterAll(() => errorSpy.mockRestore())

function world() {
  return onboardingFake({ pharmacy_invites: [], pharmacies: [], pharmacy_onboarding_applications: [], pharmacy_onboarding_events: [] }, { unique: { pharmacy_invites: ['token_hash'] } })
}

async function invited(db = world()) {
  const r = await createInvite(db.client, { actor: OPS, pharmacyName: 'Strive Pharmacy', adminEmail: 'Dana@Strive.Example' }, NOW)
  if (!r.ok) throw new Error(r.error)
  const token = r.link.split('/onboard/pharmacy/')[1]!
  return { db, r, token }
}

describe('ops: create', () => {
  it('stores the hash of a fresh token, returns the link once, expires in 7 days, audit-logged', async () => {
    const { db, r, token } = await invited()
    expect(r.link).toMatch(/^https:\/\/app\.example\/onboard\/pharmacy\/[A-Za-z0-9_-]{43}$/)
    const [row] = db.rows('pharmacy_invites')
    expect(row).toEqual(expect.objectContaining({
      pharmacy_name: 'Strive Pharmacy', admin_email: 'dana@strive.example', token_hash: hashInviteToken(token),
      expires_at: '2026-10-16T12:00:00.000Z', created_by: OPS.userId, send_count: 1,
    }))
    expect(JSON.stringify(db.rows('pharmacy_invites'))).not.toContain(token)
    expect(r.invite).not.toHaveProperty('token_hash')
    expect(db.rows('pharmacy_onboarding_events')).toEqual([expect.objectContaining({ action: 'invite_created', actor_user_id: OPS.userId, actor_role: 'ops_admin', invite_id: row!['invite_id'] })])
  })

  it('refuses a bad name or email, and a second open invite for the same email', async () => {
    const db = world()
    expect(await createInvite(db.client, { actor: OPS, pharmacyName: 'S', adminEmail: 'a@b.example' }, NOW)).toMatchObject({ ok: false, status: 400 })
    expect(await createInvite(db.client, { actor: OPS, pharmacyName: 'Strive', adminEmail: 'nope' }, NOW)).toMatchObject({ ok: false, status: 400 })
    await invited(db)
    expect(await createInvite(db.client, { actor: OPS, pharmacyName: 'Strive', adminEmail: 'dana@strive.example' }, NOW)).toMatchObject({ ok: false, status: 409 })
  })

  it('an audit row that cannot be written: no invite is created (503)', async () => {
    const db = world()
    db.failOn('pharmacy_onboarding_events:insert')
    expect(await createInvite(db.client, { actor: OPS, pharmacyName: 'Strive Pharmacy', adminEmail: 'dana@strive.example' }, NOW)).toMatchObject({ ok: false, status: 503 })
    expect(db.rows('pharmacy_invites')).toEqual([])
  })
})

describe('ops: list, revoke, resend', () => {
  it('lists invites with their state and never the hash', async () => {
    const { db } = await invited()
    const list = await listInvites(db.client, new Date('2026-10-20T00:00:00.000Z'))
    expect(list).toEqual({ ok: true, invites: [expect.objectContaining({ pharmacyName: 'Strive Pharmacy', adminEmail: 'dana@strive.example', state: 'expired', sendCount: 1 })] })
    expect(JSON.stringify(list)).not.toContain('token_hash')
  })

  it('revoke: the link stops working; audit-logged; an accepted invite cannot be revoked', async () => {
    const { db, r, token } = await invited()
    expect(await revokeInvite(db.client, { actor: OPS, inviteId: r.invite.inviteId }, NOW)).toMatchObject({ ok: true })
    expect((await inviteForToken(db.client, token, NOW))?.state).toBe('revoked')
    expect(db.rows('pharmacy_onboarding_events').map(e => e['action'])).toEqual(['invite_created', 'invite_revoked'])
    expect(await revokeInvite(db.client, { actor: OPS, inviteId: r.invite.inviteId }, NOW)).toMatchObject({ ok: false, status: 409 })
  })

  it('resend: a new token and expiry, the old link no longer works, count goes up', async () => {
    const { db, r, token } = await invited()
    const later = new Date('2026-10-12T12:00:00.000Z')
    const again = await resendInvite(db.client, { actor: OPS, inviteId: r.invite.inviteId }, later)
    if (!again.ok) throw new Error(again.error)
    const newToken = again.link.split('/onboard/pharmacy/')[1]!
    expect(newToken).not.toBe(token)
    expect(await inviteForToken(db.client, token, later)).toBeNull()
    expect(await inviteForToken(db.client, newToken, later)).toEqual(expect.objectContaining({ state: 'pending', expiresAt: '2026-10-19T12:00:00.000Z' }))
    expect(db.rows('pharmacy_invites')[0]).toEqual(expect.objectContaining({ send_count: 2, last_sent_at: later.toISOString() }))
    expect(db.rows('pharmacy_onboarding_events').map(e => e['action'])).toEqual(['invite_created', 'invite_resent'])
  })
})

describe('the invitee', () => {
  it('opens the link: pharmacy name, email and expiry; a malformed or unknown token is nothing', async () => {
    const { db, token } = await invited()
    expect(await inviteForToken(db.client, token, NOW)).toEqual({ state: 'pending', pharmacyName: 'Strive Pharmacy', adminEmail: 'dana@strive.example', expiresAt: '2026-10-16T12:00:00.000Z' })
    expect(await inviteForToken(db.client, 'short', NOW)).toBeNull()
    expect(await inviteForToken(db.client, 'A'.repeat(43), NOW)).toBeNull()
  })

  it('accepts: an inactive pharmacy, a pharmacy_admin user (app_metadata only), the application; the link is used up', async () => {
    const { db, token } = await invited()
    const r = await acceptInvite(db.client, { token, fullName: 'Dana Ruiz', password: 'a long passphrase 42' }, NOW)
    expect(r).toEqual({ ok: true, email: 'dana@strive.example' })

    const [pharmacy] = db.rows('pharmacies')
    expect(pharmacy).toEqual(expect.objectContaining({ name: 'Strive Pharmacy', is_active: false, onboarding_status: 'onboarding', integration_tier: 'TIER_4_FAX' }))
    expect(String(pharmacy!['slug'])).toMatch(/^strive-pharmacy-[0-9a-f]{6}$/)

    const [user] = db.users
    expect(user).toEqual(expect.objectContaining({ email: 'dana@strive.example', app_metadata: { app_role: 'pharmacy_admin', clinic_id: null, pharmacy_id: pharmacy!['pharmacy_id'] }, user_metadata: { full_name: 'Dana Ruiz' } }))
    const created = db.calls.find(c => c.kind === 'auth' && c.name === 'createUser')!.payload as Record<string, unknown>
    expect(created['email_confirm']).toBe(true)

    expect(db.rows('pharmacy_onboarding_applications')).toEqual([expect.objectContaining({ pharmacy_id: pharmacy!['pharmacy_id'], admin_user_id: user!.id, status: 'in_progress' })])
    expect(db.rows('pharmacy_invites')[0]).toEqual(expect.objectContaining({ accepted_user_id: user!.id, pharmacy_id: pharmacy!['pharmacy_id'], accepted_at: NOW.toISOString() }))
    expect(db.rows('pharmacy_onboarding_events').map(e => e['action'])).toEqual(['invite_created', 'invite_accepted'])

    expect(await acceptInvite(db.client, { token, fullName: 'Dana Ruiz', password: 'a long passphrase 42' }, NOW)).toMatchObject({ ok: false, status: 409 })
  })

  it('refuses a weak password or missing name, before anything is created', async () => {
    const { db, token } = await invited()
    expect(await acceptInvite(db.client, { token, fullName: 'Dana Ruiz', password: 'short' }, NOW)).toMatchObject({ ok: false, status: 400, errors: { password: expect.any(String) } })
    expect(await acceptInvite(db.client, { token, fullName: '', password: 'a long passphrase 42' }, NOW)).toMatchObject({ ok: false, status: 400, errors: { fullName: expect.any(String) } })
    expect(db.rows('pharmacies')).toEqual([])
    expect(db.users).toEqual([])
  })

  it('an expired or revoked link creates nothing', async () => {
    const { db, token } = await invited()
    expect(await acceptInvite(db.client, { token, fullName: 'Dana Ruiz', password: 'a long passphrase 42' }, new Date('2026-10-17T00:00:00.000Z'))).toMatchObject({ ok: false, status: 410 })
    expect(db.rows('pharmacies')).toEqual([])
  })

  it('an email that already has an account: the pharmacy just created is removed, 409', async () => {
    const { db, token } = await invited()
    db.users.push({ id: 'existing', email: 'dana@strive.example', app_metadata: {}, user_metadata: {} })
    expect(await acceptInvite(db.client, { token, fullName: 'Dana Ruiz', password: 'a long passphrase 42' }, NOW)).toMatchObject({ ok: false, status: 409, error: expect.stringContaining('already') })
    expect(db.rows('pharmacies')).toEqual([])
    expect(db.rows('pharmacy_invites')[0]!['accepted_at']).toBeUndefined()
  })

  it('the application cannot be created: user, pharmacy and the claim are undone', async () => {
    const { db, token } = await invited()
    db.failOn('pharmacy_onboarding_applications:insert')
    expect(await acceptInvite(db.client, { token, fullName: 'Dana Ruiz', password: 'a long passphrase 42' }, NOW)).toMatchObject({ ok: false, status: 503 })
    expect(db.users).toEqual([])
    expect(db.rows('pharmacies')).toEqual([])
    expect(db.rows('pharmacy_invites')[0]).toEqual(expect.objectContaining({ accepted_at: null, accepted_user_id: null }))
  })
})
