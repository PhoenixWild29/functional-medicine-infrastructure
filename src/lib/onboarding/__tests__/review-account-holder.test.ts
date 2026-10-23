/**
 * @jest-environment node
 *
 * loadClinicReview: a self sign-up clinic's account-holder provider has
 * their sign-in email and is marked as the account holder (from
 * lib/onboarding/provider-review); the review lists which providers are
 * not verified in the registry.
 */

import { scriptedDb, type ScriptedCall } from '@/__tests__/helpers/scripted-db'

const CLINIC = 'c1000000-0000-4000-8000-000000000001'
const summariesMock = jest.fn()
jest.mock('../provider-review', () => ({
  ...jest.requireActual('../provider-review'),
  loadProviderSummaries: (...a: unknown[]) => summariesMock(...a),
}))

import { loadClinicReview } from '../review'

const CLINIC_ROW = {
  clinic_id: CLINIC, name: 'Solo Practice', onboarding_status: 'submitted', onboarding_review_note: null, legal_name: null, dba_name: null,
  address_line1: null, address_line2: null, city: null, state: null, postal_code: null, contact_phone: null, practice_npi: null,
  tax_id_last4: null, absorb_shipping: false, onboarding_submitted_at: null, onboarding_reviewed_at: null, onboarding_reviewed_by: null,
  signup_source: 'self_serve',
}

function db() {
  const d = scriptedDb((c: ScriptedCall) => {
    if (c.table === 'clinics') return { data: CLINIC_ROW }
    if (c.table === 'providers') return { data: [{ provider_id: 'p-solo', first_name: 'Sol', last_name: 'Owner', npi_number: '1234567893' }] }
    if (c.table === 'provider_npi_verifications') return { data: [{ provider_id: 'p-solo', status: 'not_found', reason: null, registry_first_name: null, registry_last_name: null, checked_at: null }] }
    return { data: [] }
  })
  return { d, client: Object.assign(d.client as object, { auth: { admin: { getUserById: async () => ({ data: { user: null }, error: null }) } } }) as never }
}

beforeEach(() => {
  summariesMock.mockReset().mockResolvedValue(new Map([[CLINIC, [
    { providerId: 'p-solo', name: 'Sol Owner', email: 'solo@practice.test', accountHolder: true, inviteStatus: null, npiStatus: 'not_found', npiVerified: false },
  ]]]))
})

it('the account holder: sign-in email, marked; the clinic’s signup source passed along', async () => {
  const { client } = db()
  const review = await loadClinicReview(client, CLINIC)
  expect(summariesMock).toHaveBeenCalledWith(client, [{ clinicId: CLINIC, signupSource: 'self_serve' }])
  expect(review?.providers[0]).toMatchObject({ providerId: 'p-solo', email: 'solo@practice.test', accountHolder: true, invite: null })
  expect(review?.unverifiedProviders).toEqual(['Sol Owner'])
})
