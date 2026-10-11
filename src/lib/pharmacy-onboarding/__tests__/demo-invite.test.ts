/**
 * @jest-environment node
 *
 * The demo invite: one invite for the demo pharmacy, for reviewing the
 * portal end to end. A link is only ever shown once (only its hash is
 * stored), so the seed prints it; run again, it issues a new link for the
 * same invite instead of creating a second one. Audit-logged as the system.
 */

import { onboardingFake } from '@/__tests__/helpers/onboarding-fake'
import { hashInviteToken } from '../invite-token'
import { seedDemoPharmacyInvite, DEMO_INVITE } from '../demo-invite'

const NOW = new Date('2026-10-09T12:00:00.000Z')
beforeAll(() => { process.env['APP_BASE_URL'] = 'https://app.example' })

const world = () => onboardingFake({ pharmacy_invites: [], pharmacy_onboarding_events: [] })

it('creates one demo invite and returns its link; only the hash is stored', async () => {
  const db = world()
  const r = await seedDemoPharmacyInvite(db.client, NOW)
  if (!r.ok) throw new Error(r.error)
  expect(r.action).toBe('created')
  const token = r.link!.split('/onboard/pharmacy/')[1]!
  expect(db.rows('pharmacy_invites')).toEqual([expect.objectContaining({ pharmacy_name: DEMO_INVITE.pharmacyName, admin_email: DEMO_INVITE.adminEmail, token_hash: hashInviteToken(token) })])
  expect(db.rows('pharmacy_onboarding_events')).toEqual([expect.objectContaining({ action: 'invite_created', actor_role: 'system' })])
})

it('run again: the same invite gets a new link, no second invite', async () => {
  const db = world()
  const first = await seedDemoPharmacyInvite(db.client, NOW)
  const again = await seedDemoPharmacyInvite(db.client, new Date('2026-10-10T12:00:00.000Z'))
  if (!first.ok || !again.ok) throw new Error('seed failed')
  expect(again.action).toBe('reissued')
  expect(again.link).not.toBe(first.link)
  expect(db.rows('pharmacy_invites')).toHaveLength(1)
})

it('an accepted demo invite is left alone: nothing to seed', async () => {
  const db = world()
  await seedDemoPharmacyInvite(db.client, NOW)
  db.rows('pharmacy_invites')[0]!['accepted_at'] = NOW.toISOString()
  db.rows('pharmacy_invites')[0]!['accepted_user_id'] = 'u-1'
  expect(await seedDemoPharmacyInvite(db.client, NOW)).toEqual({ ok: true, action: 'already_accepted', link: null })
})
