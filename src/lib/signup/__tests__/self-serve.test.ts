/**
 * @jest-environment node
 *
 * Self sign-up (/get-started): a solo provider, a clinic or a compounding
 * pharmacy creates its own account, with no invite, and can look around at
 * once. Nothing can be ordered, signed or received until ops approves.
 *
 *   - solo provider: a clinic (signup_kind solo_provider), a clinic_admin
 *     login who is also the clinic's provider (providers.user_id), the
 *     state licenses with expiry, DEA if given, and the NPPES check (the
 *     same runNpiCheck as the onboarding wizard)
 *   - clinic: a clinic (signup_kind clinic) and its clinic_admin, then the
 *     existing clinic wizard
 *   - pharmacy: an onboarding pharmacy (inactive), a pharmacy_admin and an
 *     application, then the existing pharmacy wizard
 *   - every clinic is created inactive, in onboarding, signup_source
 *     'self_serve'; a 'self_signup' event is logged
 *   - the login is created with its email already confirmed, as invites
 *     are, so sign-in works whatever the hosted "Confirm email" setting
 *     is. Ops confirms the email and phone before approving.
 *   - password 12+ characters; a duplicate email gets a neutral answer and
 *     nothing is left behind; a failure part way removes what was made.
 */

import { onboardingFake } from '@/__tests__/helpers/onboarding-fake'
import type { NpiLookup } from '@/lib/providers/npi'

const lookupNpiMock = jest.fn()
jest.mock('@/lib/providers/npi', () => ({
  ...jest.requireActual('@/lib/providers/npi'),
  lookupNpi: (...a: unknown[]) => lookupNpiMock(...a),
}))

import { selfServeSignup, DUPLICATE_EMAIL_MESSAGE } from '../self-serve'

const NPI = '1234567893'
const VERIFIED: NpiLookup = {
  status: 'verified', nameMatch: true, enumerationType: 'NPI-1', taxonomyCode: '207Q00000X', taxonomyDesc: 'Family Medicine',
  registryFirstName: 'DANA', registryLastName: 'RUIZ', reason: null,
} as NpiLookup

function world() {
  return onboardingFake({
    clinics: [], providers: [], provider_state_licenses: [], provider_npi_verifications: [],
    clinic_onboarding_steps: [], clinic_onboarding_events: [],
    pharmacies: [], pharmacy_onboarding_applications: [], pharmacy_onboarding_events: [],
  }, { unique: { clinic_onboarding_steps: ['clinic_id+step'], provider_state_licenses: ['provider_id+state'], provider_npi_verifications: ['provider_id'] } })
}

const BASE = { firstName: 'Dana', lastName: 'Ruiz', email: 'Dana.Ruiz@Example.test', password: 'a long passphrase 42', website: '' }
const SOLO = {
  ...BASE, kind: 'solo_provider', organizationName: 'Ruiz Family Medicine', npiNumber: NPI, deaNumber: 'BR1234563',
  licenses: [{ state: 'TX', licenseNumber: 'TX-MD-1234', expiresOn: '2099-06-30' }, { state: 'OK', licenseNumber: 'OK-5678', expiresOn: '2099-01-31' }],
}
const CLINIC = { ...BASE, kind: 'clinic', organizationName: 'Sunrise Functional Medicine' }
const PHARMACY = { ...BASE, kind: 'pharmacy', organizationName: 'Strive Compounding' }

beforeEach(() => {
  lookupNpiMock.mockReset().mockResolvedValue(VERIFIED)
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'info').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

const created = (db: ReturnType<typeof world>) =>
  db.calls.filter(c => c.kind === 'auth' && c.name === 'createUser').map(c => c.payload as Record<string, unknown>)

describe('a solo provider', () => {
  it('gets a clinic, a clinic_admin login that is also its provider, licenses, DEA and the NPI check', async () => {
    const db = world()
    const r = await selfServeSignup(db.client, SOLO)
    expect(r).toEqual({ ok: true, email: 'dana.ruiz@example.test', next: '/dashboard', npiStatus: 'verified' })

    const [clinic] = db.rows('clinics')
    expect(clinic).toEqual(expect.objectContaining({
      name: 'Ruiz Family Medicine', is_active: false, onboarding_status: 'in_progress', signup_source: 'self_serve', signup_kind: 'solo_provider',
    }))
    const [user] = db.users
    expect(user).toEqual(expect.objectContaining({
      email: 'dana.ruiz@example.test',
      app_metadata: { app_role: 'clinic_admin', clinic_id: clinic!['clinic_id'] },
      user_metadata: { full_name: 'Dana Ruiz' },
    }))
    expect(created(db)[0]!['email_confirm']).toBe(true)

    const [provider] = db.rows('providers')
    expect(provider).toEqual(expect.objectContaining({
      clinic_id: clinic!['clinic_id'], user_id: user!.id, first_name: 'Dana', last_name: 'Ruiz', npi_number: NPI,
      license_state: 'TX', license_number: 'TX-MD-1234', dea_number: 'BR1234563', is_active: true,
    }))
    expect(db.rows('provider_state_licenses')).toEqual([
      expect.objectContaining({ provider_id: provider!['provider_id'], state: 'TX', license_number: 'TX-MD-1234', expires_on: '2099-06-30' }),
      expect.objectContaining({ provider_id: provider!['provider_id'], state: 'OK', license_number: 'OK-5678', expires_on: '2099-01-31' }),
    ])
    // The same NPPES check as the onboarding wizard.
    expect(lookupNpiMock).toHaveBeenCalledWith(NPI, { firstName: 'Dana', lastName: 'Ruiz' })
    expect(db.rows('provider_npi_verifications')).toEqual([expect.objectContaining({ provider_id: provider!['provider_id'], npi: NPI, status: 'verified' })])
    // The wizard's providers step is done: they are the provider.
    expect(db.rows('clinic_onboarding_steps')).toEqual([expect.objectContaining({ clinic_id: clinic!['clinic_id'], step: 'providers', status: 'complete' })])
    expect(db.rows('clinic_onboarding_events')).toEqual([expect.objectContaining({ clinic_id: clinic!['clinic_id'], event: 'self_signup', actor_user_id: user!.id, actor_role: 'clinic_admin' })])
  })

  it('a registry mismatch is saved and reported, never blocks the sign-up (they cannot sign until it passes)', async () => {
    lookupNpiMock.mockResolvedValue({ ...VERIFIED, status: 'mismatch', nameMatch: false })
    const db = world()
    expect(await selfServeSignup(db.client, SOLO)).toEqual(expect.objectContaining({ ok: true, npiStatus: 'mismatch' }))
    expect(db.rows('provider_npi_verifications')[0]).toEqual(expect.objectContaining({ status: 'mismatch' }))
  })

  it('DEA is optional', async () => {
    const db = world()
    expect(await selfServeSignup(db.client, { ...SOLO, deaNumber: '' })).toEqual(expect.objectContaining({ ok: true }))
    expect(db.rows('providers')[0]!['dea_number']).toBeNull()
  })

  it.each([
    ['an NPI that is not 10 digits', { npiNumber: '12345' }, 'npiNumber'],
    ['an NPI whose check digit is wrong', { npiNumber: '1234567890' }, 'npiNumber'],
    ['no license', { licenses: [] }, 'licenses'],
    ['an expired license', { licenses: [{ state: 'TX', licenseNumber: 'TX-1', expiresOn: '2020-01-01' }] }, 'licenses.0.expiresOn'],
    ['a license with no state', { licenses: [{ state: '', licenseNumber: 'TX-1', expiresOn: '2099-01-01' }] }, 'licenses.0.state'],
    ['the same state twice', { licenses: [{ state: 'TX', licenseNumber: 'A1', expiresOn: '2099-01-01' }, { state: 'TX', licenseNumber: 'B2', expiresOn: '2099-01-01' }] }, 'licenses.1.state'],
    ['a malformed DEA', { deaNumber: 'not-a-dea' }, 'deaNumber'],
  ])('%s: 400 naming the field, nothing created', async (_l, over, field) => {
    const db = world()
    const r = await selfServeSignup(db.client, { ...SOLO, ...over })
    expect(r).toEqual(expect.objectContaining({ ok: false, status: 400, errors: expect.objectContaining({ [field]: expect.any(String) }) }))
    expect(db.users).toEqual([])
    expect(db.rows('clinics')).toEqual([])
  })

  // Security review M3: the NPI is checked at ops approval, not here. A
  // pending sign-up never blocks another, and an NPI an approved clinic
  // holds gets exactly the answer any new NPI gets (no probing which NPIs
  // are customers). The provider row is unclaimed until ops approves.
  it.each([
    ['another pending sign-up has it', { npi_claimed: false }],
    ['an approved clinic's provider holds it', { npi_claimed: true }],
  ])('an NPI %s: the same answer as any sign-up, and the new provider is unclaimed', async (_label, existing) => {
    const db = world()
    db.rows('providers').push({ provider_id: 'p-x', clinic_id: 'c-x', npi_number: NPI, deleted_at: null, ...existing })
    const r = await selfServeSignup(db.client, SOLO)
    expect(r).toEqual({ ok: true, email: 'dana.ruiz@example.test', next: '/dashboard', npiStatus: 'verified' })
    const mine = db.rows('providers').filter(p => p['provider_id'] !== 'p-x')
    expect(mine).toEqual([expect.objectContaining({ npi_number: NPI, npi_claimed: false })])
  })

  it('a new NPI: the provider row is unclaimed too (claimed at approval)', async () => {
    const db = world()
    await selfServeSignup(db.client, SOLO)
    expect(db.rows('providers')[0]).toEqual(expect.objectContaining({ npi_claimed: false }))
  })

  it('a failure part way (the license) removes the login, the provider and the clinic', async () => {
    const db = world()
    db.failOn('provider_state_licenses:upsert')
    const r = await selfServeSignup(db.client, SOLO)
    expect(r).toEqual(expect.objectContaining({ ok: false, status: 503 }))
    expect(db.users).toEqual([])
    expect(db.rows('providers')).toEqual([])
    expect(db.rows('clinics')).toEqual([])
  })
})

describe('a clinic or practice', () => {
  it('gets a clinic and its clinic_admin, then the clinic wizard', async () => {
    const db = world()
    const r = await selfServeSignup(db.client, CLINIC)
    expect(r).toEqual({ ok: true, email: 'dana.ruiz@example.test', next: '/onboarding' })
    const [clinic] = db.rows('clinics')
    expect(clinic).toEqual(expect.objectContaining({
      name: 'Sunrise Functional Medicine', is_active: false, onboarding_status: 'in_progress', signup_source: 'self_serve', signup_kind: 'clinic',
    }))
    expect(db.users[0]).toEqual(expect.objectContaining({ app_metadata: { app_role: 'clinic_admin', clinic_id: clinic!['clinic_id'] } }))
    expect(created(db)[0]!['email_confirm']).toBe(true)
    expect(db.rows('providers')).toEqual([])
    expect(lookupNpiMock).not.toHaveBeenCalled()
    expect(db.rows('clinic_onboarding_events')).toEqual([expect.objectContaining({ event: 'self_signup', actor_role: 'clinic_admin' })])
  })

  it('the login cannot be created: the clinic is removed', async () => {
    const db = world()
    db.failOn('auth:createUser')
    expect(await selfServeSignup(db.client, CLINIC)).toEqual(expect.objectContaining({ ok: false, status: 503 }))
    expect(db.rows('clinics')).toEqual([])
  })
})

describe('a compounding pharmacy', () => {
  it('gets an inactive onboarding pharmacy, a pharmacy_admin and an application, then the pharmacy wizard', async () => {
    const db = world()
    const r = await selfServeSignup(db.client, PHARMACY)
    expect(r).toEqual({ ok: true, email: 'dana.ruiz@example.test', next: '/pharmacy/onboarding' })
    const [pharmacy] = db.rows('pharmacies')
    // Inactive while onboarding: it receives no orders and is not shown to
    // prescribers (unchanged).
    expect(pharmacy).toEqual(expect.objectContaining({ name: 'Strive Compounding', is_active: false, onboarding_status: 'onboarding', integration_tier: 'TIER_4_FAX', email: 'dana.ruiz@example.test' }))
    expect(db.users[0]).toEqual(expect.objectContaining({ app_metadata: { app_role: 'pharmacy_admin', clinic_id: null, pharmacy_id: pharmacy!['pharmacy_id'] } }))
    expect(created(db)[0]!['email_confirm']).toBe(true)
    expect(db.rows('pharmacy_onboarding_applications')).toEqual([expect.objectContaining({
      pharmacy_id: pharmacy!['pharmacy_id'], invite_id: null, admin_user_id: db.users[0]!.id, status: 'in_progress', signup_source: 'self_serve',
    })])
    expect(db.rows('pharmacy_onboarding_events')).toEqual([expect.objectContaining({ action: 'self_signup', pharmacy_id: pharmacy!['pharmacy_id'] })])
    expect(db.rows('clinics')).toEqual([])
  })

  it('the application cannot be created: the login and the pharmacy are removed', async () => {
    const db = world()
    db.failOn('pharmacy_onboarding_applications:insert')
    expect(await selfServeSignup(db.client, PHARMACY)).toEqual(expect.objectContaining({ ok: false, status: 503 }))
    expect(db.users).toEqual([])
    expect(db.rows('pharmacies')).toEqual([])
  })
})

describe('every kind', () => {
  it.each([SOLO, CLINIC, PHARMACY])('a duplicate email: 409 with a neutral message, nothing left behind ($kind)', async input => {
    const db = world()
    db.users.push({ id: 'u-existing', email: 'dana.ruiz@example.test', app_metadata: {}, user_metadata: {} })
    const r = await selfServeSignup(db.client, input)
    expect(r).toEqual({ ok: false, status: 409, code: 'DUPLICATE_EMAIL', error: DUPLICATE_EMAIL_MESSAGE })
    expect(db.rows('clinics')).toEqual([])
    expect(db.rows('pharmacies')).toEqual([])
    expect(db.rows('providers')).toEqual([])
    expect(db.users).toHaveLength(1)
  })

  it('the duplicate-email message says nothing about whether an account exists', () => {
    expect(DUPLICATE_EMAIL_MESSAGE).toBe('We could not create an account with these details. If you already have an account, sign in instead.')
  })

  it.each([SOLO, CLINIC, PHARMACY])('the honeypot filled in: answered like a success, nothing created ($kind)', async input => {
    const db = world()
    const r = await selfServeSignup(db.client, { ...input, website: 'http://spam.example' })
    expect(r).toEqual(expect.objectContaining({ ok: true, honeypot: true }))
    expect(db.users).toEqual([])
    expect(db.calls.filter(c => c.op !== 'select')).toEqual([])
  })

  it.each([
    ['a password under 12 characters', { password: 'short pass1' }, 'password'],
    ['a password over 72 bytes', { password: 'x'.repeat(73) }, 'password'],
    ['no first name', { firstName: '' }, 'firstName'],
    ['no last name', { lastName: '' }, 'lastName'],
    ['a bad email', { email: 'not-an-email' }, 'email'],
    ['no organization name', { organizationName: '  ' }, 'organizationName'],
  ])('%s: 400 naming the field', async (_l, over, field) => {
    const db = world()
    const r = await selfServeSignup(db.client, { ...CLINIC, ...over })
    expect(r).toEqual(expect.objectContaining({ ok: false, status: 400, errors: expect.objectContaining({ [field]: expect.any(String) }) }))
    expect(db.users).toEqual([])
  })

  it('an unknown kind: 400', async () => {
    const db = world()
    expect(await selfServeSignup(db.client, { ...CLINIC, kind: 'ops' })).toEqual(expect.objectContaining({ ok: false, status: 400 }))
    expect(db.users).toEqual([])
  })
})
