/**
 * @jest-environment node
 *
 * Ops review of a submitted pharmacy (/ops/onboarding/pharmacies).
 *
 *   - Each ops action is audit-logged first; no audit row, no action.
 *   - Verifying a license applies C5: it has its document, an expiry not
 *     in the past, and its sterile scope recorded. Verified, it becomes
 *     active; rejected (with a note), it stays inactive.
 *   - Approval needs a submitted application, at least one license, every
 *     license verified and unexpired, and the current BAA accepted. Only
 *     then does the pharmacy become active (and so appear in the builder
 *     and routing). Before that it stays inactive.
 *   - Send back records the note and reopens the wizard.
 *   - The review shows license documents through short-lived signed URLs
 *     and never the ordering secrets or their Vault ids.
 */

import { onboardingFake } from '@/__tests__/helpers/onboarding-fake'
import { AGREEMENT, agreementTextSha256 } from '../agreement'
import { listApplications, getApplicationReview, decideLicense, approveApplication, sendBackApplication, markAdapterConfigured } from '../review'
import { isLivePharmacy } from '@/lib/pharmacies/live'

const NOW = new Date('2026-10-09T12:00:00.000Z')
const PH = 'ph000000-0000-4000-8000-000000000001'
const APP = 'ap000000-0000-4000-8000-000000000001'
const OPS = { userId: 'op000000-0000-4000-8000-000000000001', role: 'ops_admin' }

const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
afterAll(() => errorSpy.mockRestore())

const license = (over: Record<string, unknown> = {}) => ({
  pharmacy_id: PH, state_code: 'TX', license_number: 'TX-1', expiration_date: '2027-06-30', sterile_compounding: true,
  is_active: false, verification_status: 'pending', document_path: `${PH}/TX/doc.pdf`, ...over,
})

function world(over: { status?: string; licenses?: Record<string, unknown>[]; accepted?: boolean; method?: string; adapterConfigured?: boolean } = {}) {
  return onboardingFake({
    pharmacies: [{ pharmacy_id: PH, name: 'Strive Pharmacy', legal_name: 'Strive Compounding LLC', npi: '1234567893', ncpdp_id: '1234567', facility_type: '503A', is_active: false, onboarding_status: 'onboarding', integration_tier: 'TIER_2_PORTAL' }],
    pharmacy_onboarding_applications: [{
      application_id: APP, pharmacy_id: PH, status: over.status ?? 'submitted', submitted_at: '2026-10-08T10:00:00.000Z', updated_at: '2026-10-08T10:00:00.000Z',
      steps_completed: ['details', 'facility', 'licenses', 'ordering', 'shipping', 'agreement', 'catalog'],
      ordering_method: over.method ?? 'portal',
      ordering_details: (over.method ?? 'portal') === 'fax' ? { fax_number: '+15125550199' } : { portal_url: 'https://portal.strive.example', vault: { portal_username: 'v-1', portal_password: 'v-2' } },
      adapter_configured_at: over.adapterConfigured ? '2026-10-08T11:00:00.000Z' : null,
      adapter_configured_by: over.adapterConfigured ? OPS.userId : null,
      catalog_choice: 'uploaded', catalog_row_count: 1, catalog_rows: [{ medication_name: 'Progesterone', form: 'Capsule', dose: '100mg', wholesale_price: 18.5, regulatory_status: 'ACTIVE' }], catalog_warnings: [],
    }],
    pharmacy_state_licenses: over.licenses ?? [license()],
    pharmacy_agreement_acceptances: over.accepted === false ? [] : [{
      pharmacy_id: PH, user_id: 'u-1', signer_name: 'Dana Ruiz', signer_title: 'PIC', template_key: AGREEMENT.key,
      template_version: AGREEMENT.version, text_sha256: agreementTextSha256(), accepted_at: '2026-10-08T09:00:00.000Z',
    }],
    pharmacy_onboarding_events: [],
  })
}

const lic = (db: ReturnType<typeof world>, state = 'TX') => db.rows('pharmacy_state_licenses').find(l => l['state_code'] === state)!
const pharmacy = (db: ReturnType<typeof world>) => db.rows('pharmacies')[0]!
const app = (db: ReturnType<typeof world>) => db.rows('pharmacy_onboarding_applications')[0]!
const actions = (db: ReturnType<typeof world>) => db.rows('pharmacy_onboarding_events').map(e => e['action'])

describe('licenses', () => {
  it('verify: C5 rules hold; the license becomes verified and active; audit-logged', async () => {
    const db = world()
    expect(await decideLicense(db.client, { actor: OPS, applicationId: APP, state: 'TX', decision: 'verify', note: null }, NOW)).toMatchObject({ ok: true })
    expect(lic(db)).toEqual(expect.objectContaining({ verification_status: 'verified', is_active: true, verified_by: OPS.userId, verified_at: NOW.toISOString() }))
    expect(db.rows('pharmacy_onboarding_events')).toEqual([expect.objectContaining({ action: 'license_verified', actor_role: 'ops_admin', state_code: 'TX', pharmacy_id: PH, application_id: APP })])
  })

  it.each([
    ['no document', { document_path: null }, 'document'],
    ['an expired license', { expiration_date: '2026-10-08' }, 'expired'],
    ['no sterile scope recorded', { sterile_compounding: null }, 'sterile'],
  ])('verify is refused with %s', async (_n, over, word) => {
    const db = world({ licenses: [license(over)] })
    expect(await decideLicense(db.client, { actor: OPS, applicationId: APP, state: 'TX', decision: 'verify', note: null }, NOW)).toMatchObject({ ok: false, status: 422, error: expect.stringContaining(word) })
    expect(lic(db)).toEqual(expect.objectContaining({ verification_status: 'pending', is_active: false }))
  })

  it('reject needs a note; the license stays inactive', async () => {
    const db = world()
    expect(await decideLicense(db.client, { actor: OPS, applicationId: APP, state: 'TX', decision: 'reject', note: '' }, NOW)).toMatchObject({ ok: false, status: 400 })
    expect(await decideLicense(db.client, { actor: OPS, applicationId: APP, state: 'TX', decision: 'reject', note: 'Document is for a different pharmacy.' }, NOW)).toMatchObject({ ok: true })
    expect(lic(db)).toEqual(expect.objectContaining({ verification_status: 'rejected', is_active: false, verification_note: 'Document is for a different pharmacy.' }))
  })

  it('no audit row: nothing is verified', async () => {
    const db = world()
    db.failOn('pharmacy_onboarding_events:insert')
    expect(await decideLicense(db.client, { actor: OPS, applicationId: APP, state: 'TX', decision: 'verify', note: null }, NOW)).toMatchObject({ ok: false, status: 503 })
    expect(lic(db)['verification_status']).toBe('pending')
  })

  it('an application not submitted cannot be reviewed', async () => {
    const db = world({ status: 'in_progress' })
    expect(await decideLicense(db.client, { actor: OPS, applicationId: APP, state: 'TX', decision: 'verify', note: null }, NOW)).toMatchObject({ ok: false, status: 409 })
  })
})

describe('approve', () => {
  it('refused while any license is not verified: the pharmacy stays inactive (not in the builder or routing)', async () => {
    const db = world({ licenses: [license({ verification_status: 'verified', is_active: true }), license({ state_code: 'CA' })] })
    expect(await approveApplication(db.client, { actor: OPS, applicationId: APP }, NOW)).toMatchObject({ ok: false, status: 409, error: expect.stringContaining('CA') })
    expect(pharmacy(db)).toEqual(expect.objectContaining({ is_active: false, onboarding_status: 'onboarding' }))
    expect(isLivePharmacy(pharmacy(db) as never)).toBe(false)
  })

  it('refused with no license, an expired verified license, or no BAA acceptance', async () => {
    expect(await approveApplication(world({ licenses: [] }).client, { actor: OPS, applicationId: APP }, NOW)).toMatchObject({ ok: false, status: 409 })
    expect(await approveApplication(world({ licenses: [license({ verification_status: 'verified', is_active: true, expiration_date: '2026-10-01' })] }).client, { actor: OPS, applicationId: APP }, NOW)).toMatchObject({ ok: false, status: 409, error: expect.stringContaining('expired') })
    expect(await approveApplication(world({ licenses: [license({ verification_status: 'verified', is_active: true })], accepted: false }).client, { actor: OPS, applicationId: APP }, NOW)).toMatchObject({ ok: false, status: 409, error: expect.stringContaining('BAA') })
  })

  it('every license verified and the BAA accepted: the pharmacy becomes active and approved; audit-logged', async () => {
    const db = world({ licenses: [license({ verification_status: 'verified', is_active: true })], adapterConfigured: true })
    expect(await approveApplication(db.client, { actor: OPS, applicationId: APP }, NOW)).toMatchObject({ ok: true })
    expect(pharmacy(db)).toEqual(expect.objectContaining({ is_active: true, onboarding_status: 'approved' }))
    expect(isLivePharmacy(pharmacy(db) as never)).toBe(true)
    expect(app(db)).toEqual(expect.objectContaining({ status: 'approved', approved_at: NOW.toISOString(), reviewed_by: OPS.userId }))
    expect(actions(db)).toEqual(['application_approved'])
  })

  it('the application cannot be marked approved: the pharmacy is put back inactive', async () => {
    const db = world({ licenses: [license({ verification_status: 'verified', is_active: true })], adapterConfigured: true })
    db.failOn('pharmacy_onboarding_applications:update')
    expect(await approveApplication(db.client, { actor: OPS, applicationId: APP }, NOW)).toMatchObject({ ok: false, status: 503 })
    expect(pharmacy(db)).toEqual(expect.objectContaining({ is_active: false, onboarding_status: 'onboarding' }))
  })
})

describe('the adapter (API and portal pharmacies)', () => {
  const verified = [license({ verification_status: 'verified', is_active: true })]

  it('an API or portal pharmacy cannot be approved until ops marks its adapter configured', async () => {
    const db = world({ licenses: verified })
    expect(await approveApplication(db.client, { actor: OPS, applicationId: APP }, NOW)).toMatchObject({ ok: false, status: 409, error: expect.stringContaining('adapter') })
    expect(pharmacy(db)).toEqual(expect.objectContaining({ is_active: false, onboarding_status: 'onboarding' }))
    expect(await markAdapterConfigured(db.client, { actor: OPS, applicationId: APP, configured: true }, NOW)).toMatchObject({ ok: true })
    expect(app(db)).toEqual(expect.objectContaining({ adapter_configured_at: NOW.toISOString(), adapter_configured_by: OPS.userId }))
    expect(await approveApplication(db.client, { actor: OPS, applicationId: APP }, NOW)).toMatchObject({ ok: true })
    expect(actions(db)).toEqual(['adapter_marked_configured', 'application_approved'])
  })

  it('a fax pharmacy is approved once its licenses are verified; it has no adapter to mark', async () => {
    const db = world({ licenses: verified, method: 'fax' })
    expect(await markAdapterConfigured(db.client, { actor: OPS, applicationId: APP, configured: true }, NOW)).toMatchObject({ ok: false, status: 409 })
    expect(await approveApplication(db.client, { actor: OPS, applicationId: APP }, NOW)).toMatchObject({ ok: true })
  })

  it('unmarking clears it; audit-logged', async () => {
    const db = world({ licenses: verified, adapterConfigured: true })
    expect(await markAdapterConfigured(db.client, { actor: OPS, applicationId: APP, configured: false }, NOW)).toMatchObject({ ok: true })
    expect(app(db)).toEqual(expect.objectContaining({ adapter_configured_at: null, adapter_configured_by: null }))
    expect(actions(db)).toEqual(['adapter_marked_unconfigured'])
  })

  it('no audit row: nothing is marked', async () => {
    const db = world({ licenses: verified })
    db.failOn('pharmacy_onboarding_events:insert')
    expect(await markAdapterConfigured(db.client, { actor: OPS, applicationId: APP, configured: true }, NOW)).toMatchObject({ ok: false, status: 503 })
    expect(app(db)['adapter_configured_at']).toBeNull()
  })

  it('the review says whether an adapter is needed and when it was marked', async () => {
    const r = await getApplicationReview(world({ adapterConfigured: true }).client, APP)
    if (!r.ok) throw new Error(r.error)
    expect(r.review.adapter).toEqual({ required: true, configuredAt: '2026-10-08T11:00:00.000Z' })
    const fax = await getApplicationReview(world({ method: 'fax' }).client, APP)
    if (!fax.ok) throw new Error(fax.error)
    expect(fax.review.adapter).toEqual({ required: false, configuredAt: null })
  })
})

describe('send back', () => {
  it('needs a note; reopens the wizard with it; the note is not in the audit log', async () => {
    const db = world()
    expect(await sendBackApplication(db.client, { actor: OPS, applicationId: APP, note: ' ' }, NOW)).toMatchObject({ ok: false, status: 400 })
    expect(await sendBackApplication(db.client, { actor: OPS, applicationId: APP, note: 'Upload the CA license document.' }, NOW)).toMatchObject({ ok: true })
    expect(app(db)).toEqual(expect.objectContaining({ status: 'sent_back', review_note: 'Upload the CA license document.', reviewed_by: OPS.userId }))
    expect(actions(db)).toEqual(['application_sent_back'])
    expect(JSON.stringify(db.rows('pharmacy_onboarding_events'))).not.toContain('Upload the CA')
  })
})

describe('reading', () => {
  it('lists applications with license counts', async () => {
    const db = world({ licenses: [license({ verification_status: 'verified', is_active: true }), license({ state_code: 'CA' })] })
    expect(await listApplications(db.client)).toEqual({ ok: true, applications: [expect.objectContaining({ applicationId: APP, pharmacyName: 'Strive Pharmacy', status: 'submitted', licenses: { total: 2, verified: 1, pending: 1, rejected: 0 } })] })
  })

  it('the review: documents through 15-minute signed URLs; no secrets or Vault ids; the staged catalog', async () => {
    const db = world()
    const r = await getApplicationReview(db.client, APP)
    if (!r.ok) throw new Error(r.error)
    expect(r.review.licenses).toEqual([expect.objectContaining({ state: 'TX', documentUrl: expect.stringContaining('expires=900') })])
    expect(r.review.ordering).toEqual({ method: 'portal', portalUrl: 'https://portal.strive.example', secretsStored: true })
    expect(JSON.stringify(r.review)).not.toMatch(/v-1|v-2|vault/)
    expect(r.review.catalog).toEqual(expect.objectContaining({ choice: 'uploaded', rowCount: 1, rows: [expect.objectContaining({ medication_name: 'Progesterone' })] }))
    expect(r.review.acceptance).toEqual(expect.objectContaining({ signerName: 'Dana Ruiz', templateVersion: AGREEMENT.version, current: true }))
  })
})
