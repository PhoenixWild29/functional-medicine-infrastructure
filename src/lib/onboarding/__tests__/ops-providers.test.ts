/**
 * @jest-environment node
 *
 * loadOpsOnboarding: each clinic in the queue carries its providers (name,
 * email, account holder, invite, NPI verified or not), from
 * lib/onboarding/provider-review, so the queue card can show the account
 * holder and the unverified-provider warning.
 */

import { scriptedDb, type ScriptedCall } from '@/__tests__/helpers/scripted-db'

const SELF = 'c1000000-0000-4000-8000-000000000001'
const summariesMock = jest.fn()
jest.mock('../provider-review', () => ({
  ...jest.requireActual('../provider-review'),
  loadProviderSummaries: (...a: unknown[]) => summariesMock(...a),
}))

import { loadOpsOnboarding } from '../ops'

const SOL = { providerId: 'p-solo', name: 'Sol Owner', email: 'solo@practice.test', accountHolder: true, inviteStatus: null, npiStatus: 'not_found', npiVerified: false }

it('passes each queued clinic with its signup source and attaches its providers', async () => {
  summariesMock.mockResolvedValue(new Map([[SELF, [SOL]]]))
  const d = scriptedDb((c: ScriptedCall) => {
    if (c.table === 'clinics' && 'onboarding_status:neq' in c.filters) {
      return { data: [{ clinic_id: SELF, name: 'Solo Practice', onboarding_status: 'submitted', onboarding_submitted_at: null, onboarding_review_note: null, signup_source: 'self_serve', signup_kind: 'solo_provider' }] }
    }
    return { data: [] }
  })
  const client = Object.assign(d.client as object, { auth: { admin: { getUserById: async () => ({ data: { user: null }, error: null }) } } }) as never
  const out = await loadOpsOnboarding(client)
  expect(summariesMock).toHaveBeenCalledWith(client, [{ clinicId: SELF, signupSource: 'self_serve' }])
  expect(out.clinics[0]?.providers).toEqual([SOL])
})
