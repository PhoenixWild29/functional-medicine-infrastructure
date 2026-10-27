/**
 * @jest-environment node
 *
 * Ops deletes an unapproved self sign-up (security review M2/M3: a
 * squatted email or NPI is freed): its logins, provider rows (with their
 * licenses and NPI checks) and wizard steps are removed; the clinic is
 * soft-deleted (its onboarding events are append-only and keep it); a
 * 'signup_deleted' event records who did it. Only a self sign-up that ops
 * has not approved: an approved or invited clinic is refused, nothing
 * removed.
 */

import { onboardingFake } from '@/__tests__/helpers/onboarding-fake'
import { deleteSelfServeSignup } from '../delete-signup'

const CLINIC = 'c-1'
const NOW = new Date('2026-10-25T12:00:00.000Z')

function world(clinic: Record<string, unknown> = {}) {
  const db = onboardingFake({
    clinics: [{ clinic_id: CLINIC, name: 'Ruiz Family Medicine', signup_source: 'self_serve', signup_kind: 'solo_provider', onboarding_status: 'submitted', is_active: false, deleted_at: null, ...clinic }],
    providers: [{ provider_id: 'p-1', clinic_id: CLINIC, user_id: 'u-holder', npi_number: '1234567893', deleted_at: null, npi_claimed: false }],
    provider_state_licenses: [{ provider_id: 'p-1', state: 'TX' }],
    provider_npi_verifications: [{ provider_id: 'p-1', status: 'not_found' }],
    clinic_onboarding_steps: [{ clinic_id: CLINIC, step: 'providers', status: 'complete' }],
    clinic_onboarding_events: [{ clinic_id: CLINIC, event: 'self_signup', actor_user_id: 'u-holder', actor_role: 'clinic_admin' }],
    onboarding_invites: [{ invite_id: 'i-1', clinic_id: CLINIC, kind: 'staff', accepted_user_id: 'u-staff', revoked_at: null }],
    // Another clinic's rows are never touched.
    other: [],
  })
  db.users.push(
    { id: 'u-holder', email: 'dana@example.test', app_metadata: { app_role: 'clinic_admin', clinic_id: CLINIC }, user_metadata: {} },
    { id: 'u-staff', email: 'ma@example.test', app_metadata: { app_role: 'medical_assistant', clinic_id: CLINIC }, user_metadata: {} },
    { id: 'u-else', email: 'else@example.test', app_metadata: { app_role: 'clinic_admin', clinic_id: 'c-other' }, user_metadata: {} },
  )
  return db
}

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'info').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

it('removes the logins and provider rows, soft-deletes the clinic, records signup_deleted', async () => {
  const db = world()
  const res = await deleteSelfServeSignup(db.client, { clinicId: CLINIC, actorUserId: 'ops-1', now: NOW })
  expect(res).toEqual({ ok: true, removedLogins: 2, removedProviders: 1 })
  expect(db.users.map(u => u.id)).toEqual(['u-else'])
  expect(db.rows('providers')).toEqual([])
  expect(db.rows('provider_state_licenses')).toEqual([])
  expect(db.rows('provider_npi_verifications')).toEqual([])
  expect(db.rows('clinic_onboarding_steps')).toEqual([])
  expect(db.rows('clinics')[0]).toMatchObject({ deleted_at: NOW.toISOString(), is_active: false })
  expect(db.rows('clinic_onboarding_events').at(-1)).toMatchObject({ clinic_id: CLINIC, event: 'signup_deleted', actor_user_id: 'ops-1', actor_role: 'ops_admin' })
})

it.each([
  ['approved', { onboarding_status: 'approved', is_active: true }],
  ['invited (not a self sign-up)', { signup_source: 'invite' }],
])('a clinic that is %s: refused, nothing removed', async (_label, over) => {
  const db = world(over)
  expect(await deleteSelfServeSignup(db.client, { clinicId: CLINIC, actorUserId: 'ops-1', now: NOW })).toMatchObject({ ok: false, status: 409 })
  expect(db.users).toHaveLength(3)
  expect(db.rows('providers')).toHaveLength(1)
})

it('not found, or already deleted: 404', async () => {
  expect(await deleteSelfServeSignup(world().client, { clinicId: 'c-nope', actorUserId: 'ops-1', now: NOW })).toMatchObject({ ok: false, status: 404 })
  expect(await deleteSelfServeSignup(world({ deleted_at: '2026-10-01T00:00:00Z' }).client, { clinicId: CLINIC, actorUserId: 'ops-1', now: NOW })).toMatchObject({ ok: false, status: 404 })
})

it('a provider row that cannot be removed: stops before any login is deleted', async () => {
  const db = world()
  db.failOn('providers:delete')
  expect(await deleteSelfServeSignup(db.client, { clinicId: CLINIC, actorUserId: 'ops-1', now: NOW })).toMatchObject({ ok: false, status: 503 })
  expect(db.users).toHaveLength(3)
  expect(db.rows('clinics')[0]!['deleted_at']).toBeNull()
})
