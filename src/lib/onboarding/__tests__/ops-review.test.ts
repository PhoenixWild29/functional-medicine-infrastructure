/**
 * @jest-environment node
 *
 * Ops review of one clinic in onboarding (loadClinicReview) and the
 * "Approved clinics" list (loadOpsOnboarding().approved). Read with the
 * service role behind the ops_admin gate; no patient data.
 *
 *   - practice: legal name, DBA, address, phone, practice NPI, tax ID
 *     last 4, who pays shipping
 *   - providers: name, email (their invite's), NPI, the registry result
 *     (status, reason, registry name), licenses, invite status
 *   - staff: the medical assistant invites
 *   - agreements: signer, title, version, accepted at, first 12
 *     characters of the text hash (BAA and terms, latest of each)
 *   - history: clinic_onboarding_events, oldest first, with who acted
 *     (a name from user_metadata, else the role; never an email)
 *   - approved clinics: approved through onboarding (reviewed), newest
 *     first, with when and who approved
 */

import { scriptedDb, type ScriptedCall } from '@/__tests__/helpers/scripted-db'
import { loadClinicReview } from '../review'
import { loadOpsOnboarding } from '../ops'

const CLINIC = 'c0000000-0000-4000-8000-000000000001'
const OPS_USER = 'u0000000-0000-4000-8000-0000000000aa'
const ADMIN_USER = 'u0000000-0000-4000-8000-0000000000bb'
const NOW = new Date('2026-10-11T12:00:00Z')
const HASH = 'abcdef0123456789'.repeat(4)

const users: Record<string, { email: string; user_metadata: Record<string, unknown>; app_metadata: Record<string, unknown> }> = {
  [OPS_USER]:   { email: 'dana.ops@compoundiq.test', user_metadata: { full_name: 'Dana Reyes' }, app_metadata: { app_role: 'ops_admin' } },
  [ADMIN_USER]: { email: 'owner@bluecedar.test', user_metadata: {}, app_metadata: { app_role: 'clinic_admin', clinic_id: CLINIC } },
}

function withAuth(db: ReturnType<typeof scriptedDb>) {
  const getUserById = jest.fn(async (id: string) => (users[id] ? { data: { user: { id, ...users[id] } }, error: null } : { data: { user: null }, error: { message: 'not found' } }))
  return { client: { ...(db.client as object), auth: { admin: { getUserById } } } as never, getUserById }
}

function reviewDb(over: (c: ScriptedCall) => unknown = () => undefined) {
  return scriptedDb(c => {
    const o = over(c)
    if (o) return o as never
    switch (c.table) {
      case 'clinics': return { data: {
        clinic_id: CLINIC, name: 'Blue Cedar', onboarding_status: 'submitted', onboarding_review_note: null,
        legal_name: 'Blue Cedar Health PLLC', dba_name: 'Blue Cedar', address_line1: '12 Elm St', address_line2: 'Suite 4',
        city: 'Austin', state: 'TX', postal_code: '78701', contact_phone: '(512) 555-0100', practice_npi: '1234567893',
        tax_id_last4: '6789', absorb_shipping: true, onboarding_submitted_at: '2026-10-10T15:00:00Z',
        onboarding_reviewed_at: null, onboarding_reviewed_by: null,
      } }
      case 'clinic_onboarding_steps': return { data: [] }
      case 'providers': return { data: [
        { provider_id: 'p1', first_name: 'Ana', last_name: 'Ortiz', npi_number: '1487000001' },
        { provider_id: 'p2', first_name: 'Ben', last_name: 'Cole', npi_number: '1487000002' },
      ] }
      case 'onboarding_invites': return { data: [
        { invite_id: 'i-p1', kind: 'provider', email: 'ana@bluecedar.test', provider_id: 'p1', accepted_at: '2026-10-09T00:00:00Z', revoked_at: null, expires_at: '2026-10-16T00:00:00Z', created_at: '2026-10-08T00:00:00Z' },
        { invite_id: 'i-p2', kind: 'provider', email: 'ben@bluecedar.test', provider_id: 'p2', accepted_at: null, revoked_at: null, expires_at: '2026-10-16T00:00:00Z', created_at: '2026-10-08T00:00:00Z' },
        { invite_id: 'i-ma', kind: 'medical_assistant', email: 'ma@bluecedar.test', provider_id: null, accepted_at: null, revoked_at: null, expires_at: '2026-10-01T00:00:00Z', created_at: '2026-09-24T00:00:00Z' },
        { invite_id: 'i-admin', kind: 'clinic_admin', email: 'owner@bluecedar.test', provider_id: null, accepted_at: '2026-10-01T00:00:00Z', revoked_at: null, expires_at: '2026-10-08T00:00:00Z', created_at: '2026-10-01T00:00:00Z' },
      ] }
      case 'agreement_acceptances': return { data: [
        { agreement: 'terms', template_version: 'v0.1', text_sha256: HASH, signer_name: 'Jo Park', signer_title: 'Owner', accepted_at: '2026-10-10T14:00:00Z' },
        { agreement: 'baa', template_version: 'v0.1', text_sha256: HASH, signer_name: 'Jo Park', signer_title: 'Owner', accepted_at: '2026-10-10T13:00:00Z' },
        { agreement: 'baa', template_version: 'v0.0', text_sha256: '0'.repeat(64), signer_name: 'Old', signer_title: 'Old', accepted_at: '2026-10-01T13:00:00Z' },
      ] }
      case 'provider_state_licenses': return { data: [
        { provider_id: 'p1', state: 'TX', license_number: 'TX-12345', expires_on: '2027-06-30' },
        { provider_id: 'p1', state: 'NM', license_number: 'NM-9', expires_on: '2026-12-31' },
        { provider_id: 'p2', state: 'TX', license_number: 'TX-777', expires_on: '2027-01-31' },
      ] }
      case 'provider_npi_verifications': return { data: [
        { provider_id: 'p1', status: 'verified', reason: null, registry_first_name: 'ANA', registry_last_name: 'ORTIZ', checked_at: '2026-10-08T00:00:00Z' },
        { provider_id: 'p2', status: 'not_found', reason: 'No provider with this NPI in the registry.', registry_first_name: null, registry_last_name: null, checked_at: '2026-10-08T00:00:00Z' },
      ] }
      case 'clinic_onboarding_events': return { data: [
        { event_id: 'e2', event: 'submitted', actor_user_id: ADMIN_USER, actor_role: 'clinic_admin', note: null, created_at: '2026-10-10T15:00:00Z' },
        { event_id: 'e1', event: 'invite_created', actor_user_id: OPS_USER, actor_role: 'ops_admin', note: null, created_at: '2026-10-01T00:00:00Z' },
      ] }
    }
    return undefined
  })
}

describe('loadClinicReview', () => {
  it('practice details, including who pays shipping', async () => {
    const { client } = withAuth(reviewDb())
    const r = (await loadClinicReview(client, CLINIC, NOW))!
    expect(r.clinic).toEqual(expect.objectContaining({
      name: 'Blue Cedar', legalName: 'Blue Cedar Health PLLC', dbaName: 'Blue Cedar', addressLine1: '12 Elm St', addressLine2: 'Suite 4',
      city: 'Austin', state: 'TX', postalCode: '78701', phone: '(512) 555-0100', practiceNpi: '1234567893', taxIdLast4: '6789',
      absorbShipping: true, submittedAt: '2026-10-10T15:00:00Z',
    }))
  })

  it('providers: name, invite email, NPI, registry result, licenses and invite status', async () => {
    const { client } = withAuth(reviewDb())
    const r = (await loadClinicReview(client, CLINIC, NOW))!
    expect(r.providers).toEqual([
      expect.objectContaining({
        providerId: 'p1', firstName: 'Ana', lastName: 'Ortiz', email: 'ana@bluecedar.test', npiNumber: '1487000001',
        npi: expect.objectContaining({ status: 'verified', registryName: 'ANA ORTIZ' }),
        licenses: [{ state: 'TX', licenseNumber: 'TX-12345', expiresOn: '2027-06-30' }, { state: 'NM', licenseNumber: 'NM-9', expiresOn: '2026-12-31' }],
        invite: expect.objectContaining({ status: 'accepted' }),
      }),
      expect.objectContaining({
        providerId: 'p2', email: 'ben@bluecedar.test',
        npi: expect.objectContaining({ status: 'not_found', reason: 'No provider with this NPI in the registry.', registryName: null }),
        invite: expect.objectContaining({ status: 'pending' }),
      }),
    ])
  })

  it('staff: the medical assistant invites only', async () => {
    const { client } = withAuth(reviewDb())
    const r = (await loadClinicReview(client, CLINIC, NOW))!
    expect(r.staff).toEqual([{ inviteId: 'i-ma', email: 'ma@bluecedar.test', status: 'expired' }])
  })

  it('agreements: the latest BAA and terms, with the first 12 characters of the text hash', async () => {
    const { client } = withAuth(reviewDb())
    const r = (await loadClinicReview(client, CLINIC, NOW))!
    expect(r.agreements).toEqual([
      { agreement: 'baa', signerName: 'Jo Park', signerTitle: 'Owner', version: 'v0.1', acceptedAt: '2026-10-10T13:00:00Z', textHashPrefix: 'abcdef012345' },
      { agreement: 'terms', signerName: 'Jo Park', signerTitle: 'Owner', version: 'v0.1', acceptedAt: '2026-10-10T14:00:00Z', textHashPrefix: 'abcdef012345' },
    ])
  })

  it('history: oldest first; who acted is a name or the role, never an email', async () => {
    const { client } = withAuth(reviewDb())
    const r = (await loadClinicReview(client, CLINIC, NOW))!
    expect(r.history.map(h => h.event)).toEqual(['invite_created', 'submitted'])
    expect(r.history[0]!.actor).toBe('Dana Reyes (CompoundIQ ops)')
    expect(r.history[1]!.actor).toBe('Clinic admin')
    expect(JSON.stringify(r.history)).not.toMatch(/@/)
  })

  it('an unknown clinic is null', async () => {
    const { client } = withAuth(reviewDb(c => (c.table === 'clinics' ? { data: null } : undefined)))
    expect(await loadClinicReview(client, CLINIC, NOW)).toBeNull()
  })

  it('a read that fails throws (the page shows an error, never a partial review)', async () => {
    const { client } = withAuth(reviewDb(c => (c.table === 'clinic_onboarding_events' ? { error: { message: 'down' } } : undefined)))
    await expect(loadClinicReview(client, CLINIC, NOW)).rejects.toThrow()
  })
})

describe('approved clinics', () => {
  it('lists clinics approved through onboarding, newest first, with when and who approved (a name, never an email)', async () => {
    const db = scriptedDb(c => {
      if (c.table === 'clinics' && c.filters['onboarding_status'] === 'approved') {
        return { data: [
          { clinic_id: 'c-new', name: 'Sunrise', onboarding_reviewed_at: '2026-10-11T09:00:00Z', onboarding_reviewed_by: OPS_USER },
          { clinic_id: 'c-old', name: 'Harbor', onboarding_reviewed_at: '2026-10-02T09:00:00Z', onboarding_reviewed_by: 'u0000000-0000-4000-8000-0000000000cc' },
        ] }
      }
      return { data: [] }
    })
    const { client } = withAuth(db)
    const data = await loadOpsOnboarding(client, NOW)
    expect(data.approved).toEqual([
      { clinicId: 'c-new', name: 'Sunrise', approvedAt: '2026-10-11T09:00:00Z', approvedBy: 'Dana Reyes' },
      { clinicId: 'c-old', name: 'Harbor', approvedAt: '2026-10-02T09:00:00Z', approvedBy: 'CompoundIQ ops' },
    ])
    const [q] = db.to('clinics').filter(c => c.filters['onboarding_status'] === 'approved')
    expect(q!.filters['onboarding_reviewed_at:not']).toEqual(['is', null])
  })
})
