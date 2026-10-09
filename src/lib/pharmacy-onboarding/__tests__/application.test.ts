/**
 * @jest-environment node
 *
 * The pharmacy's wizard, server side. Every read and write is scoped to
 * the signed-in pharmacy_admin's own pharmacy (its id comes from the
 * caller's claims, never from the request body).
 *
 *   - Progress is saved per step; the application can be edited while in
 *     progress or sent back, not after it is submitted or approved.
 *   - Licenses are written pending and inactive (C5 never counts them
 *     until ops verifies). The licenses step is complete when there is at
 *     least one license and each has a document. A document goes to the
 *     private bucket; uploading one puts the license back to pending.
 *   - Ordering secrets go to Vault (create, then rotate on a later save);
 *     the application keeps only the Vault ids; the pharmacy's integration
 *     tier follows the method.
 *   - The BAA acceptance is an append-only record of signer, title, user,
 *     time, template version and text hash.
 *   - The catalog CSV is validated with the ops rules and staged for ops.
 *   - Submit needs every step, and is recorded.
 */

import { onboardingFake } from '@/__tests__/helpers/onboarding-fake'
import { AGREEMENT, agreementTextSha256 } from '../agreement'
import {
  loadOnboarding, saveDetails, saveFacility, saveLicense, deleteLicense, attachLicenseDocument,
  saveOrdering, saveShipping, acceptAgreement, saveCatalog, submitApplication,
} from '../application'

const NOW = new Date('2026-10-09T12:00:00.000Z')
const PH = 'ph000000-0000-4000-8000-000000000001'
const OTHER = 'ph000000-0000-4000-8000-000000000002'
const APP = 'ap000000-0000-4000-8000-000000000001'
const USER = 'us000000-0000-4000-8000-000000000001'
const ctx = { pharmacyId: PH, userId: USER }

const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
afterAll(() => errorSpy.mockRestore())

function world(status = 'in_progress', steps: string[] = []) {
  return onboardingFake({
    pharmacies: [
      { pharmacy_id: PH, name: 'Strive Pharmacy', is_active: false, onboarding_status: 'onboarding', integration_tier: 'TIER_4_FAX', ship_carriers: [], ship_to_states: [] },
      { pharmacy_id: OTHER, name: 'Other Rx', is_active: true, onboarding_status: null, integration_tier: 'TIER_1_API' },
    ],
    pharmacy_onboarding_applications: [{ application_id: APP, pharmacy_id: PH, admin_user_id: USER, status, steps_completed: steps, ordering_details: {} }],
    pharmacy_state_licenses: [
      { pharmacy_id: OTHER, state_code: 'TX', license_number: 'OTHER-1', expiration_date: '2099-01-01', is_active: true, verification_status: 'verified', sterile_compounding: true },
    ],
    pharmacy_agreement_acceptances: [],
    pharmacy_onboarding_events: [],
  })
}

const app = (db: ReturnType<typeof world>) => db.rows('pharmacy_onboarding_applications')[0]!
const pharmacy = (db: ReturnType<typeof world>, id = PH) => db.rows('pharmacies').find(p => p['pharmacy_id'] === id)!

const DETAILS = {
  legalName: 'Strive Compounding LLC', dbaName: 'Strive Pharmacy', addressLine1: '1 Main St', addressLine2: '',
  city: 'Austin', state: 'TX', zip: '78701', phone: '512-555-0100', ncpdpId: '1234567', npi: '1234567893', deaNumber: '',
}
const LICENSE = { state: 'TX', licenseNumber: 'TX-PH-1', expiresOn: '2027-06-30', sterileCompounding: true }
const pdf = (size = 2048) => ({ name: 'license.pdf', type: 'application/pdf', size, bytes: new Uint8Array(size) })

describe('details, facility, shipping', () => {
  it('details update only this pharmacy, and mark the step', async () => {
    const db = world()
    expect(await saveDetails(db.client, ctx, DETAILS)).toMatchObject({ ok: true })
    expect(pharmacy(db)).toEqual(expect.objectContaining({ legal_name: 'Strive Compounding LLC', npi: '1234567893', ncpdp_id: '1234567', phone: '+15125550100', name: 'Strive Pharmacy' }))
    expect(pharmacy(db, OTHER)['legal_name']).toBeUndefined()
    expect(app(db)['steps_completed']).toEqual(['details'])
  })

  it('invalid input names the fields and changes nothing', async () => {
    const db = world()
    expect(await saveDetails(db.client, ctx, { ...DETAILS, npi: '1' })).toMatchObject({ ok: false, status: 400, errors: { npi: expect.any(String) } })
    expect(pharmacy(db)['npi']).toBeUndefined()
  })

  it('facility type and shipping are saved on the pharmacy', async () => {
    const db = world()
    expect(await saveFacility(db.client, ctx, { facilityType: '503B' })).toMatchObject({ ok: true })
    expect(await saveShipping(db.client, ctx, { carriers: ['UPS'], coldChain: true, shipToStates: ['TX', 'CA'], cutoffTime: '15:00' })).toMatchObject({ ok: true })
    expect(pharmacy(db)).toEqual(expect.objectContaining({ facility_type: '503B', ship_carriers: ['UPS'], ships_cold_chain: true, ship_to_states: ['CA', 'TX'], order_cutoff_local: '15:00' }))
    expect(app(db)['steps_completed']).toEqual(['facility', 'shipping'])
  })

  it('after submit nothing can be edited (409)', async () => {
    const db = world('submitted')
    expect(await saveDetails(db.client, ctx, DETAILS)).toMatchObject({ ok: false, status: 409 })
    const approved = world('approved')
    expect(await saveFacility(approved.client, ctx, { facilityType: '503A' })).toMatchObject({ ok: false, status: 409 })
  })

  it('a sent-back application can be edited again', async () => {
    const db = world('sent_back')
    expect(await saveFacility(db.client, ctx, { facilityType: '503A' })).toMatchObject({ ok: true })
  })
})

describe('licenses', () => {
  it('a license is saved pending and inactive; the step waits for a document', async () => {
    const db = world()
    expect(await saveLicense(db.client, ctx, LICENSE, NOW)).toMatchObject({ ok: true })
    expect(db.rows('pharmacy_state_licenses').find(l => l['pharmacy_id'] === PH)).toEqual(expect.objectContaining({
      state_code: 'TX', license_number: 'TX-PH-1', expiration_date: '2027-06-30', sterile_compounding: true, is_active: false, verification_status: 'pending',
    }))
    expect(app(db)['steps_completed']).toEqual([])
  })

  it('a document: PDF or image up to 10 MB, private bucket under the pharmacy, license back to pending, step complete', async () => {
    const db = world()
    await saveLicense(db.client, ctx, LICENSE, NOW)
    expect(await attachLicenseDocument(db.client, ctx, 'TX', { name: 'x.exe', type: 'application/x-msdownload', size: 10, bytes: new Uint8Array(10) })).toMatchObject({ ok: false, status: 400 })
    expect(await attachLicenseDocument(db.client, ctx, 'TX', pdf(11 * 1024 * 1024))).toMatchObject({ ok: false, status: 400 })
    expect(await attachLicenseDocument(db.client, ctx, 'TX', pdf())).toMatchObject({ ok: true })
    const lic = db.rows('pharmacy_state_licenses').find(l => l['pharmacy_id'] === PH)!
    expect(String(lic['document_path'])).toMatch(new RegExp(`^${PH}/TX/[0-9a-f-]{36}\\.pdf$`))
    expect([...db.objects.keys()]).toEqual([`pharmacy-license-documents/${lic['document_path']}`])
    expect(lic).toEqual(expect.objectContaining({ verification_status: 'pending', is_active: false }))
    expect(app(db)['steps_completed']).toEqual(['licenses'])
  })

  it('a document for a state with no license of this pharmacy is refused', async () => {
    const db = world()
    expect(await attachLicenseDocument(db.client, ctx, 'TX', pdf())).toMatchObject({ ok: false, status: 404 })
  })

  it('an upload that fails changes nothing', async () => {
    const db = world()
    await saveLicense(db.client, ctx, LICENSE, NOW)
    db.failOn('storage:upload')
    expect(await attachLicenseDocument(db.client, ctx, 'TX', pdf())).toMatchObject({ ok: false, status: 503 })
    expect(db.rows('pharmacy_state_licenses').find(l => l['pharmacy_id'] === PH)!['document_path']).toBeUndefined()
  })

  it('an expired license is refused (C5)', async () => {
    const db = world()
    expect(await saveLicense(db.client, ctx, { ...LICENSE, expiresOn: '2026-01-01' }, NOW)).toMatchObject({ ok: false, status: 400, errors: { expiresOn: expect.stringContaining('expired') } })
  })

  it('removing a license removes its document; never another pharmacy’s', async () => {
    const db = world()
    await saveLicense(db.client, ctx, LICENSE, NOW)
    await attachLicenseDocument(db.client, ctx, 'TX', pdf())
    expect(await deleteLicense(db.client, ctx, 'TX')).toMatchObject({ ok: true })
    expect(db.rows('pharmacy_state_licenses').filter(l => l['pharmacy_id'] === PH)).toEqual([])
    expect(db.objects.size).toBe(0)
    expect(db.rows('pharmacy_state_licenses').filter(l => l['pharmacy_id'] === OTHER)).toHaveLength(1)
    expect(app(db)['steps_completed']).toEqual([])
  })
})

describe('ordering', () => {
  it('API: the key goes to Vault, the application keeps the Vault id only; tier TIER_1_API', async () => {
    const db = world()
    const input = { method: 'api', api: { baseUrl: 'https://api.strive.example/v1', authType: 'api_key', apiKey: 'sk_live_secret' } }
    expect(await saveOrdering(db.client, ctx, input)).toMatchObject({ ok: true })
    const details = app(db)['ordering_details'] as Record<string, unknown>
    expect(details).toEqual({ base_url: 'https://api.strive.example/v1', auth_type: 'api_key', vault: { api_key: expect.any(String) } })
    expect(JSON.stringify(db.tables)).not.toContain('sk_live_secret')
    expect([...db.vault.values()]).toEqual([{ name: `pharmacy_${PH}_api_key`, secret: 'sk_live_secret' }])
    expect(app(db)['ordering_method']).toBe('api')
    expect(pharmacy(db)['integration_tier']).toBe('TIER_1_API')
    expect(app(db)['steps_completed']).toEqual(['ordering'])
  })

  it('a later save rotates the same Vault secret; a blank key keeps it', async () => {
    const db = world()
    await saveOrdering(db.client, ctx, { method: 'api', api: { baseUrl: 'https://api.strive.example', authType: 'api_key', apiKey: 'first' } })
    const id = ((app(db)['ordering_details'] as Record<string, Record<string, string>>)['vault']!)['api_key']!
    await saveOrdering(db.client, ctx, { method: 'api', api: { baseUrl: 'https://api.strive.example', authType: 'api_key', apiKey: 'second' } })
    expect(db.vault.get(id)!.secret).toBe('second')
    expect(db.vault.size).toBe(1)
    expect(await saveOrdering(db.client, ctx, { method: 'api', api: { baseUrl: 'https://api.strive.example/v2', authType: 'api_key', apiKey: '' } })).toMatchObject({ ok: true })
    expect(db.vault.get(id)!.secret).toBe('second')
  })

  it('portal: username and password to Vault; fax: the number on the pharmacy, TIER_4_FAX', async () => {
    const db = world()
    await saveOrdering(db.client, ctx, { method: 'portal', portal: { portalUrl: 'https://portal.strive.example', username: 'ops', password: 'pw-1' } })
    expect(app(db)['ordering_details']).toEqual({ portal_url: 'https://portal.strive.example', vault: { portal_username: expect.any(String), portal_password: expect.any(String) } })
    expect(pharmacy(db)['integration_tier']).toBe('TIER_2_PORTAL')
    await saveOrdering(db.client, ctx, { method: 'fax', fax: { faxNumber: '512-555-0199' } })
    expect(pharmacy(db)).toEqual(expect.objectContaining({ integration_tier: 'TIER_4_FAX', fax_number: '+15125550199' }))
    expect(app(db)['ordering_details']).toEqual({ fax_number: '+15125550199' })
  })

  it('Vault unavailable: nothing is saved', async () => {
    const db = world()
    db.failOn('rpc:create_vault_secret')
    expect(await saveOrdering(db.client, ctx, { method: 'api', api: { baseUrl: 'https://api.strive.example', authType: 'api_key', apiKey: 'k' } })).toMatchObject({ ok: false, status: 503 })
    expect(app(db)['ordering_method']).toBeUndefined()
  })
})

describe('BAA and terms', () => {
  const accept = { signerName: 'Dana Ruiz', signerTitle: 'Pharmacist in charge', templateVersion: AGREEMENT.version, textSha256: agreementTextSha256(), accept: true }

  it('records signer, title, user, time, version and text hash; once', async () => {
    const db = world()
    expect(await acceptAgreement(db.client, ctx, accept, NOW)).toMatchObject({ ok: true })
    expect(db.rows('pharmacy_agreement_acceptances')).toEqual([expect.objectContaining({
      pharmacy_id: PH, application_id: APP, user_id: USER, signer_name: 'Dana Ruiz', signer_title: 'Pharmacist in charge',
      template_key: 'pharmacy_baa_terms', template_version: AGREEMENT.version, text_sha256: agreementTextSha256(), accepted_at: NOW.toISOString(),
    })])
    expect(app(db)['steps_completed']).toEqual(['agreement'])
    expect(await acceptAgreement(db.client, ctx, accept, NOW)).toMatchObject({ ok: true })
    expect(db.rows('pharmacy_agreement_acceptances')).toHaveLength(1)
  })

  it('without the explicit yes nothing is recorded', async () => {
    const db = world()
    expect(await acceptAgreement(db.client, ctx, { ...accept, accept: false }, NOW)).toMatchObject({ ok: false, status: 400 })
    expect(db.rows('pharmacy_agreement_acceptances')).toEqual([])
  })
})

describe('catalog', () => {
  it('a CSV is validated with the ops rules and staged for ops, with warnings', async () => {
    const db = world()
    const rows = [
      { medication_name: 'Progesterone', form: 'Capsule', dose: '100mg', wholesale_price: '18.5', regulatory_status: 'ACTIVE' },
      { medication_name: '', form: 'Capsule', dose: '1', wholesale_price: '1', regulatory_status: 'ACTIVE' },
    ]
    expect(await saveCatalog(db.client, ctx, { choice: 'uploaded', rows })).toMatchObject({ ok: true, rowCount: 1, warnings: [expect.stringContaining('Row 3')] })
    expect(app(db)).toEqual(expect.objectContaining({ catalog_choice: 'uploaded', catalog_row_count: 1, catalog_rows: [expect.objectContaining({ medication_name: 'Progesterone', wholesale_price: 18.5 })] }))
    expect(db.rows('catalog' as never)).toEqual([])
    expect(app(db)['steps_completed']).toEqual(['catalog'])
  })

  it('a CSV with no valid row is refused; skipping is allowed', async () => {
    const db = world()
    expect(await saveCatalog(db.client, ctx, { choice: 'uploaded', rows: [{ medication_name: '' }] })).toMatchObject({ ok: false, status: 422 })
    expect(await saveCatalog(db.client, ctx, { choice: 'skipped' })).toMatchObject({ ok: true })
    expect(app(db)).toEqual(expect.objectContaining({ catalog_choice: 'skipped', catalog_rows: null, catalog_row_count: null }))
  })

  it('at most 5000 rows', async () => {
    const db = world()
    const rows = Array.from({ length: 5001 }, () => ({ medication_name: 'A', form: 'B', dose: 'C', wholesale_price: '1', regulatory_status: 'ACTIVE' }))
    expect(await saveCatalog(db.client, ctx, { choice: 'uploaded', rows })).toMatchObject({ ok: false, status: 400 })
  })
})

describe('load and submit', () => {
  it('load: this pharmacy only; ordering shows that secrets are stored, never their ids or values', async () => {
    const db = world()
    await saveLicense(db.client, ctx, LICENSE, NOW)
    await saveOrdering(db.client, ctx, { method: 'portal', portal: { portalUrl: 'https://portal.strive.example', username: 'ops', password: 'pw-1' } })
    const r = await loadOnboarding(db.client, PH)
    if (!r.ok) throw new Error(r.error)
    expect(r.state.licenses).toEqual([expect.objectContaining({ state: 'TX', verificationStatus: 'pending', hasDocument: false })])
    expect(r.state.ordering).toEqual({ method: 'portal', portalUrl: 'https://portal.strive.example', secretsStored: true })
    expect(JSON.stringify(r.state)).not.toMatch(/vault|pw-1/)
    expect(r.state.agreement).toEqual(expect.objectContaining({ version: AGREEMENT.version, banner: 'Draft, pending legal review', acceptance: null }))
  })

  it('submit needs every step; then it is submitted, recorded, and locked', async () => {
    const db = world('in_progress', ['details', 'facility'])
    expect(await submitApplication(db.client, ctx, NOW)).toMatchObject({ ok: false, status: 409, error: expect.stringContaining('Licenses') })
    const done = world('in_progress', ['details', 'facility', 'licenses', 'ordering', 'shipping', 'agreement', 'catalog'])
    expect(await submitApplication(done.client, ctx, NOW)).toMatchObject({ ok: true })
    expect(app(done)).toEqual(expect.objectContaining({ status: 'submitted', submitted_at: NOW.toISOString() }))
    expect(done.rows('pharmacy_onboarding_events')).toEqual([expect.objectContaining({ action: 'application_submitted', pharmacy_id: PH, application_id: APP, actor_role: 'pharmacy_admin' })])
    expect(await submitApplication(done.client, ctx, NOW)).toMatchObject({ ok: false, status: 409 })
  })
})
