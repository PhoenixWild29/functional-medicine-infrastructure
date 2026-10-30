/**
 * @jest-environment node
 *
 * Pharmacy Terms of Service, alongside the BAA.
 *
 *   - The text is src/content/legal/pharmacy-terms-v1.1.md, in the shared
 *     agreement source (PHARMACY_TERMS, key pharmacy_terms, v1.1, final).
 *     It is not one of the clinic's agreements. v0.1 is archived.
 *   - The wizard records its acceptance in pharmacy_agreement_acceptances
 *     with template_key 'pharmacy_terms', the version and the server's
 *     SHA-256 of the exact text. No new step key: 'agreement' is complete
 *     once both the BAA and the terms are accepted at their current versions.
 *   - Every read of the acceptances is filtered by template_key, so a terms
 *     row never counts as a BAA (load, accept, submit, ops review, approve).
 *   - Submit and approve need both.
 *   - /pharmacy/agreements lists what was accepted, and the text accepted
 *     (found by key, version and hash: an older version's text included).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { onboardingFake } from '@/__tests__/helpers/onboarding-fake'
import { AGREEMENTS, PHARMACY_TERMS, isAgreementKey } from '@/lib/onboarding/agreement-texts'
import { PHARMACY_TERMS_V0_1_TEXT, PHARMACY_TERMS_V1_1_TEXT } from '@/lib/onboarding/legal-texts.generated'
import { pharmacyAgreement, acceptedText } from '../agreement'
import { acceptAgreement, loadOnboarding, submitApplication } from '../application'
import { getApplicationReview, approveApplication } from '../review'
import { listPharmacyAgreements, acceptedAgreementText } from '../agreements-history'

const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex')
const md = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n')

const NOW = new Date('2026-10-11T12:00:00.000Z')
const PH = 'ph000000-0000-4000-8000-000000000001'
const OTHER = 'ph000000-0000-4000-8000-000000000002'
const APP = 'ap000000-0000-4000-8000-000000000001'
const USER = 'us000000-0000-4000-8000-000000000001'
const OPS = { userId: 'op000000-0000-4000-8000-000000000001', role: 'ops_admin' }
const ctx = { pharmacyId: PH, userId: USER }
const ALL_STEPS = ['details', 'facility', 'licenses', 'ordering', 'shipping', 'agreement', 'catalog']

const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
afterAll(() => errorSpy.mockRestore())

const BAA = () => pharmacyAgreement('baa')
const TERMS = () => pharmacyAgreement('pharmacy_terms')
const row = (key: 'baa' | 'pharmacy_terms', over: Record<string, unknown> = {}) => {
  const a = pharmacyAgreement(key)
  return {
    acceptance_id: `acc-${key}-${String(over['template_version'] ?? a.version)}`, pharmacy_id: PH, application_id: APP, user_id: USER,
    signer_name: 'Dana Ruiz', signer_title: 'Pharmacist in charge', template_key: key,
    template_version: a.version, text_sha256: a.textSha256, accepted_at: '2026-10-10T09:00:00.000Z', ...over,
  }
}

function world(opts: { status?: string; steps?: string[]; acceptances?: Record<string, unknown>[]; method?: string } = {}) {
  return onboardingFake({
    pharmacies: [
      { pharmacy_id: PH, name: 'Strive Pharmacy', is_active: false, onboarding_status: 'onboarding', integration_tier: 'TIER_4_FAX', ship_carriers: [], ship_to_states: [] },
      { pharmacy_id: OTHER, name: 'Other Rx', is_active: true },
    ],
    pharmacy_onboarding_applications: [{
      application_id: APP, pharmacy_id: PH, admin_user_id: USER, status: opts.status ?? 'in_progress', steps_completed: opts.steps ?? [],
      submitted_at: null, updated_at: '2026-10-10T10:00:00.000Z',
      ordering_method: opts.method ?? 'fax', ordering_details: { fax_number: '+15125550199' },
      adapter_configured_at: null, adapter_configured_by: null,
      catalog_choice: 'skipped', catalog_row_count: null, catalog_rows: null, catalog_warnings: [],
    }],
    pharmacy_state_licenses: [{ pharmacy_id: PH, state_code: 'TX', license_number: 'TX-1', expiration_date: '2027-06-30', sterile_compounding: true, is_active: true, verification_status: 'verified', document_path: `${PH}/TX/doc.pdf` }],
    pharmacy_agreement_acceptances: opts.acceptances ?? [],
    pharmacy_onboarding_events: [],
  })
}
const app = (db: ReturnType<typeof world>) => db.rows('pharmacy_onboarding_applications')[0]!
const accepts = (key: 'baa' | 'pharmacy_terms') => {
  const a = pharmacyAgreement(key)
  return { agreement: key, signerName: 'Dana Ruiz', signerTitle: 'Pharmacist in charge', templateVersion: a.version, textSha256: a.textSha256, accept: true }
}

describe('the shared source', () => {
  it('pharmacy_terms v1.1 is the committed Markdown, final, and not a clinic agreement', () => {
    expect(PHARMACY_TERMS).toEqual(expect.objectContaining({ key: 'pharmacy_terms', version: 'v1.1', title: 'Pharmacy Terms of Service' }))
    expect('draft' in PHARMACY_TERMS).toBe(false)
    expect(PHARMACY_TERMS.text).toBe(md('src/content/legal/pharmacy-terms-v1.1.md'))
    expect(PHARMACY_TERMS_V1_1_TEXT).toBe(PHARMACY_TERMS.text)
    expect(Object.keys(AGREEMENTS).sort()).toEqual(['baa', 'terms'])
    expect(isAgreementKey('pharmacy_terms')).toBe(false)
  })

  it('the pharmacy flow takes both from it, with the hash of the exact text', () => {
    expect(TERMS()).toEqual(expect.objectContaining({ key: 'pharmacy_terms', version: 'v1.1', text: PHARMACY_TERMS.text, textSha256: sha(PHARMACY_TERMS.text) }))
    expect(TERMS()).not.toHaveProperty('banner')
    expect(BAA()).toEqual(expect.objectContaining({ key: 'baa', version: AGREEMENTS.baa.version, text: AGREEMENTS.baa.text }))
  })

  it('the text of an accepted version is found by key, version and hash; the BAA v0.1 text that #220 recorded too', () => {
    expect(acceptedText('pharmacy_terms', 'v1.1', sha(PHARMACY_TERMS.text))).toBe(PHARMACY_TERMS.text)
    expect(acceptedText('pharmacy_terms', 'v0.1', sha(PHARMACY_TERMS_V0_1_TEXT))).toBe(PHARMACY_TERMS_V0_1_TEXT)
    const v01 = acceptedText('baa', 'v0.1', '14367b35e4b4ef51e6ed53d150275474635929a38c9bb900eef8d6e77ebc064e')
    expect(v01).toContain('# Business Associate Agreement')
    expect(v01).toContain('Notes for counsel')
    expect(acceptedText('baa', 'v0.1', sha('something else'))).toBeNull()
    expect(acceptedText('pharmacy_terms', 'v9', sha(PHARMACY_TERMS.text))).toBeNull()
  })
})

describe('accepting the terms in the wizard', () => {
  it('records template_key pharmacy_terms, the version and the server-side hash', async () => {
    const db = world()
    expect(await acceptAgreement(db.client, ctx, accepts('pharmacy_terms'), NOW)).toMatchObject({ ok: true })
    expect(db.rows('pharmacy_agreement_acceptances')).toEqual([expect.objectContaining({
      pharmacy_id: PH, user_id: USER, signer_name: 'Dana Ruiz', signer_title: 'Pharmacist in charge',
      template_key: 'pharmacy_terms', template_version: PHARMACY_TERMS.version, text_sha256: sha(PHARMACY_TERMS.text), accepted_at: NOW.toISOString(),
    })])
  })

  it('the client hash must match the server text; an unknown agreement is refused', async () => {
    const db = world()
    expect(await acceptAgreement(db.client, ctx, { ...accepts('pharmacy_terms'), textSha256: sha('tampered') }, NOW)).toMatchObject({ ok: false, status: 400 })
    expect(await acceptAgreement(db.client, ctx, { ...accepts('pharmacy_terms'), agreement: 'terms' }, NOW)).toMatchObject({ ok: false, status: 400 })
    expect(db.rows('pharmacy_agreement_acceptances')).toEqual([])
  })

  it("a BAA acceptance does not stand in for the terms, or the reverse (each is recorded once per version)", async () => {
    const db = world({ acceptances: [row('baa')] })
    expect(await acceptAgreement(db.client, ctx, accepts('pharmacy_terms'), NOW)).toMatchObject({ ok: true })
    expect(db.rows('pharmacy_agreement_acceptances').map(r => r['template_key']).sort()).toEqual(['baa', 'pharmacy_terms'])
    expect(await acceptAgreement(db.client, ctx, accepts('pharmacy_terms'), NOW)).toMatchObject({ ok: true })
    expect(db.rows('pharmacy_agreement_acceptances')).toHaveLength(2)
  })

  it("'agreement' is complete only once both are accepted", async () => {
    const db = world()
    await acceptAgreement(db.client, ctx, accepts('baa'), NOW)
    expect(app(db)['steps_completed']).toEqual([])
    await acceptAgreement(db.client, ctx, accepts('pharmacy_terms'), NOW)
    expect(app(db)['steps_completed']).toEqual(['agreement'])
  })

  it('every acceptance read is filtered by template_key', async () => {
    const db = world()
    await acceptAgreement(db.client, ctx, accepts('pharmacy_terms'), NOW)
    await loadOnboarding(db.client, PH)
    const reads = db.calls.filter(c => c.name === 'pharmacy_agreement_acceptances' && c.op === 'select')
    expect(reads.length).toBeGreaterThan(0)
    for (const r of reads) expect(r.filters).toEqual(expect.arrayContaining([expect.stringMatching(/^template_key=/)]))
  })
})

describe('load and submit', () => {
  it('load shows each agreement with its own acceptance; a terms row is never the BAA', async () => {
    const r = await loadOnboarding(world({ acceptances: [row('pharmacy_terms')] }).client, PH)
    if (!r.ok) throw new Error(r.error)
    expect(r.state.agreement).toEqual(expect.objectContaining({ key: 'baa', acceptance: null }))
    expect(r.state.terms).toEqual(expect.objectContaining({ key: 'pharmacy_terms', version: 'v1.1', title: 'Pharmacy Terms of Service', text: PHARMACY_TERMS.text, acceptance: expect.objectContaining({ signerName: 'Dana Ruiz' }) }))
    expect(r.state.stepsCompleted).toContain('terms')
    expect(r.state.stepsCompleted).not.toContain('agreement')
  })

  it('submit needs both, even when the agreement step was marked before the terms existed', async () => {
    const baaOnly = world({ steps: ALL_STEPS, acceptances: [row('baa')] })
    expect(await submitApplication(baaOnly.client, ctx, NOW)).toMatchObject({ ok: false, status: 409, error: expect.stringContaining('Terms of service') })
    const both = world({ steps: ALL_STEPS, acceptances: [row('baa'), row('pharmacy_terms')] })
    expect(await submitApplication(both.client, ctx, NOW)).toMatchObject({ ok: true })
  })
})

describe('ops review and approve', () => {
  it('the review shows both acceptances: signer, title, version, time, first 12 of the hash', async () => {
    const r = await getApplicationReview(world({ status: 'submitted', steps: ALL_STEPS, acceptances: [row('baa'), row('pharmacy_terms', { accepted_at: '2026-10-10T09:05:00.000Z' })] }).client, APP)
    if (!r.ok) throw new Error(r.error)
    expect(r.review.acceptances.baa).toEqual(expect.objectContaining({ signerName: 'Dana Ruiz', signerTitle: 'Pharmacist in charge', templateVersion: BAA().version, acceptedAt: '2026-10-10T09:00:00.000Z', hashPrefix: BAA().textSha256.slice(0, 12), current: true }))
    expect(r.review.acceptances.terms).toEqual(expect.objectContaining({ templateVersion: 'v1.1', acceptedAt: '2026-10-10T09:05:00.000Z', hashPrefix: sha(PHARMACY_TERMS.text).slice(0, 12), current: true }))
  })

  it('a terms row is not shown as the BAA', async () => {
    const r = await getApplicationReview(world({ status: 'submitted', acceptances: [row('pharmacy_terms')] }).client, APP)
    if (!r.ok) throw new Error(r.error)
    expect(r.review.acceptances.baa).toBeNull()
  })

  it('approve needs both current acceptances, each matched by template_key', async () => {
    const terms = await approveApplication(world({ status: 'submitted', steps: ALL_STEPS, acceptances: [row('pharmacy_terms')] }).client, { actor: OPS, applicationId: APP }, NOW)
    expect(terms).toMatchObject({ ok: false, status: 409, error: expect.stringContaining('BAA') })
    const baa = await approveApplication(world({ status: 'submitted', steps: ALL_STEPS, acceptances: [row('baa')] }).client, { actor: OPS, applicationId: APP }, NOW)
    expect(baa).toMatchObject({ ok: false, status: 409, error: expect.stringContaining('Terms of service') })
    const both = await approveApplication(world({ status: 'submitted', steps: ALL_STEPS, acceptances: [row('baa'), row('pharmacy_terms')] }).client, { actor: OPS, applicationId: APP }, NOW)
    expect(both).toMatchObject({ ok: true })
  })
})

describe('/pharmacy/agreements', () => {
  const OLD_BAA = row('baa', { acceptance_id: 'acc-old', template_version: 'v0.1', text_sha256: '14367b35e4b4ef51e6ed53d150275474635929a38c9bb900eef8d6e77ebc064e', accepted_at: '2026-10-09T09:00:00.000Z' })

  it('lists each agreement with what was accepted; a newer current version is flagged', async () => {
    const db = world({ status: 'approved', acceptances: [OLD_BAA, row('pharmacy_terms'), { ...row('baa'), pharmacy_id: OTHER, acceptance_id: 'acc-other' }] })
    const r = await listPharmacyAgreements(db.client, PH)
    if (!r.ok) throw new Error(r.error)
    const baa = r.agreements.find(a => a.key === 'baa')!
    expect(baa).toEqual(expect.objectContaining({ title: 'Business Associate Agreement', currentVersion: BAA().version, newVersionAvailable: true, acceptedCurrent: false }))
    expect(baa.acceptances).toEqual([expect.objectContaining({ acceptanceId: 'acc-old', version: 'v0.1', signerName: 'Dana Ruiz', acceptedAt: '2026-10-09T09:00:00.000Z' })])
    const terms = r.agreements.find(a => a.key === 'pharmacy_terms')!
    expect(terms).toEqual(expect.objectContaining({ title: 'Pharmacy Terms of Service', newVersionAvailable: false, acceptedCurrent: true }))
    expect(JSON.stringify(r)).not.toContain('acc-other')
  })

  it('the text of one acceptance: its own version, this pharmacy only', async () => {
    const db = world({ acceptances: [OLD_BAA, { ...row('pharmacy_terms'), pharmacy_id: OTHER, acceptance_id: 'acc-other' }] })
    const r = await acceptedAgreementText(db.client, PH, 'acc-old')
    if (!r.ok) throw new Error(r.error)
    expect(r.acceptance).toEqual(expect.objectContaining({ title: 'Business Associate Agreement', version: 'v0.1', signerName: 'Dana Ruiz' }))
    expect(r.acceptance.text).toContain('Notes for counsel')
    expect(await acceptedAgreementText(db.client, PH, 'acc-other')).toMatchObject({ ok: false, status: 404 })
  })

  it('a new version can be accepted after approval; the application is not changed', async () => {
    const db = world({ status: 'approved', steps: ALL_STEPS, acceptances: [OLD_BAA, row('pharmacy_terms')] })
    expect(await acceptAgreement(db.client, ctx, accepts('baa'), NOW)).toMatchObject({ ok: true })
    expect(db.rows('pharmacy_agreement_acceptances').filter(r => r['template_key'] === 'baa').map(r => r['template_version']).sort()).toEqual([BAA().version, 'v0.1'].sort())
    expect(app(db)).toEqual(expect.objectContaining({ status: 'approved', steps_completed: ALL_STEPS }))
  })
})
