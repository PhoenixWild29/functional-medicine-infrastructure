/**
 * @jest-environment node
 *
 * Ops review of a clinic's providers (the queue card and the review page):
 *
 *   - Self sign-up: the provider who is the account holder (their own
 *     login, no invite) shows their sign-in email and "Account holder
 *     (signed up on their own)", never a dash or "Not invited".
 *   - Unverified NPI: any provider whose NPI is not verified in the
 *     national registry gets the warning, and approval needs ops to say
 *     they checked the license with the state board; that confirmation is
 *     the approval event's note.
 */

import { scriptedDb, DB_DOWN, type ScriptedCall, type ScriptedAnswer } from '@/__tests__/helpers/scripted-db'
import {
  ACCOUNT_HOLDER_LABEL, LICENSE_CHECK_LABEL, licenseCheckNote, loadProviderSummaries, unverifiedWarning,
} from '../provider-review'

const SELF = 'c1000000-0000-4000-8000-000000000001'
const INVITED = 'c1000000-0000-4000-8000-000000000002'

let script: (c: ScriptedCall) => ScriptedAnswer | undefined = () => undefined
let db = scriptedDb(c => script(c))
const getUserById = jest.fn()
const client = () => Object.assign(db.client as object, { auth: { admin: { getUserById } } }) as never

beforeEach(() => {
  db = scriptedDb(c => script(c))
  getUserById.mockReset().mockImplementation(async (id: string) => ({ data: { user: id === 'u-solo' ? { id, email: 'solo@practice.test' } : null }, error: null }))
  script = c => {
    if (c.table === 'providers') {
      return { data: [
        { provider_id: 'p-solo', clinic_id: SELF, first_name: 'Sol', last_name: 'Owner', user_id: 'u-solo' },
        { provider_id: 'p-inv', clinic_id: INVITED, first_name: 'Ivy', last_name: 'Invited', user_id: null },
        { provider_id: 'p-none', clinic_id: INVITED, first_name: 'Ned', last_name: 'Nobody', user_id: null },
      ] }
    }
    if (c.table === 'onboarding_invites') {
      return { data: [{ provider_id: 'p-inv', email: 'ivy@clinic.test', accepted_at: null, revoked_at: null, expires_at: '2999-01-01T00:00:00Z', created_at: '2026-10-01T00:00:00Z' }] }
    }
    if (c.table === 'provider_npi_verifications') {
      return { data: [
        { provider_id: 'p-solo', status: 'not_found' },
        { provider_id: 'p-inv', status: 'verified' },
      ] }
    }
    return undefined
  }
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

it('the words ops reads', () => {
  expect(ACCOUNT_HOLDER_LABEL).toBe('Account holder (signed up on their own)')
  expect(LICENSE_CHECK_LABEL).toBe('I checked this provider’s license with the state board')
  expect(unverifiedWarning('Sol Owner')).toBe('Sol Owner’s NPI was not found in the national registry. Check their license with the state board before approving.')
  expect(licenseCheckNote(['Sol Owner'])).toContain('I checked this provider’s license with the state board')
  expect(licenseCheckNote(['Sol Owner'])).toContain('Sol Owner')
  for (const s of [ACCOUNT_HOLDER_LABEL, LICENSE_CHECK_LABEL, unverifiedWarning('X'), licenseCheckNote(['X', 'Y'])]) expect(s).not.toContain('—')
})

it('the self sign-up account holder: their sign-in email, marked as the account holder', async () => {
  const map = await loadProviderSummaries(client(), [{ clinicId: SELF, signupSource: 'self_serve' }, { clinicId: INVITED, signupSource: 'invite' }])
  expect(map.get(SELF)).toEqual([
    { providerId: 'p-solo', name: 'Sol Owner', email: 'solo@practice.test', accountHolder: true, inviteStatus: null, npiStatus: 'not_found', npiVerified: false },
  ])
  expect(getUserById).toHaveBeenCalledWith('u-solo')
})

it('invited providers: the invite’s email and status; none: no invite; NPI verified or not', async () => {
  const map = await loadProviderSummaries(client(), [{ clinicId: INVITED, signupSource: 'invite' }])
  expect(map.get(INVITED)).toEqual([
    { providerId: 'p-inv', name: 'Ivy Invited', email: 'ivy@clinic.test', accountHolder: false, inviteStatus: 'pending', npiStatus: 'verified', npiVerified: true },
    { providerId: 'p-none', name: 'Ned Nobody', email: null, accountHolder: false, inviteStatus: null, npiStatus: null, npiVerified: false },
  ])
})

it('a linked login in an invited clinic is not an account holder', async () => {
  const map = await loadProviderSummaries(client(), [{ clinicId: SELF, signupSource: 'invite' }])
  expect(map.get(SELF)?.[0]?.accountHolder).toBe(false)
})

it('reads the clinics’ providers only, live ones', async () => {
  await loadProviderSummaries(client(), [{ clinicId: SELF, signupSource: 'self_serve' }])
  expect(db.to('providers')[0]?.filters).toMatchObject({ 'clinic_id:in': [SELF], 'deleted_at:is': null })
})

it('a failed read throws: ops never approve from a partial review', async () => {
  script = c => (c.table === 'providers' ? DB_DOWN : undefined)
  await expect(loadProviderSummaries(client(), [{ clinicId: SELF, signupSource: 'self_serve' }])).rejects.toThrow()
})

it('no clinics: no reads', async () => {
  expect((await loadProviderSummaries(client(), [])).size).toBe(0)
  expect(db.calls).toHaveLength(0)
})
