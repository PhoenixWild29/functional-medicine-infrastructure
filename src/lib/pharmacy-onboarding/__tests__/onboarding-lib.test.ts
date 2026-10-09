/**
 * @jest-environment node
 *
 * Pharmacy onboarding: the pure rules.
 *
 *   - Invite tokens: 32 random bytes, base64url; only a SHA-256 is stored;
 *     7 days; a link is /onboard/pharmacy/<token>.
 *   - Invite state from the row: accepted, revoked, expired or pending.
 *   - Each wizard step's input is validated and normalized server-side.
 *   - The BAA and terms are a DRAFT template, versioned, with a text hash
 *     the acceptance record stores.
 *   - The catalog CSV uses the ops upload format and validator.
 */

import {
  generateInviteToken, hashInviteToken, inviteState, inviteExpiry, inviteLink, INVITE_TTL_DAYS,
} from '../invite-token'
import {
  validateDetails, validateFacility, validateLicense, validateOrdering, validateShipping, validateAcceptance, normalizeEmail,
} from '../validate'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { AGREEMENT, agreementText, agreementTextSha256 } from '../agreement'
import { validateCatalogRows } from '@/lib/catalog/validate-csv-rows'
import { ONBOARDING_STEPS, stepsComplete } from '../steps'

const NOW = new Date('2026-10-09T12:00:00.000Z')

describe('invite tokens', () => {
  it('a token is 32 random bytes in base64url; the stored hash is its SHA-256 hex', async () => {
    const a = generateInviteToken()
    const b = generateInviteToken()
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(a.token).not.toBe(b.token)
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hashInviteToken(a.token)).toBe(a.hash)
    expect(hashInviteToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('expires 7 days after it is sent', () => {
    expect(INVITE_TTL_DAYS).toBe(7)
    expect(inviteExpiry(NOW)).toBe('2026-10-16T12:00:00.000Z')
  })

  it('the link is /onboard/pharmacy/<token> on the app base URL', () => {
    process.env['APP_BASE_URL'] = 'https://app.example/'
    expect(inviteLink('tok_1')).toBe('https://app.example/onboard/pharmacy/tok_1')
  })

  it('state: accepted, revoked, expired, pending', () => {
    const base = { expires_at: '2026-10-16T12:00:00.000Z', accepted_at: null, revoked_at: null }
    expect(inviteState(base, NOW)).toBe('pending')
    expect(inviteState({ ...base, expires_at: '2026-10-09T11:59:59.000Z' }, NOW)).toBe('expired')
    expect(inviteState({ ...base, revoked_at: '2026-10-09T10:00:00.000Z' }, NOW)).toBe('revoked')
    expect(inviteState({ ...base, accepted_at: '2026-10-09T10:00:00.000Z' }, NOW)).toBe('accepted')
  })

  it('emails are trimmed and lower-cased; a malformed one is refused', () => {
    expect(normalizeEmail('  Admin@Pharmacy.Example ')).toBe('admin@pharmacy.example')
    expect(normalizeEmail('not an email')).toBeNull()
  })
})

describe('step validation', () => {
  const details = {
    legalName: 'Strive Compounding LLC', dbaName: 'Strive Pharmacy', addressLine1: '1 Main St', addressLine2: '',
    city: 'Austin', state: 'tx', zip: '78701', phone: '(512) 555-0100', ncpdpId: '1234567', npi: '1234567893', deaNumber: '',
  }

  it('details: normalized; NCPDP 7 digits, NPI 10 digits with a valid check digit, DEA optional', () => {
    const r = validateDetails(details)
    expect(r.ok && r.value).toEqual(expect.objectContaining({ legal_name: 'Strive Compounding LLC', state: 'TX', phone: '+15125550100', npi: '1234567893', dea_number: null, address_line2: null }))
    expect(validateDetails({ ...details, npi: '1234567890' })).toEqual({ ok: false, errors: { npi: expect.any(String) } })
    expect(validateDetails({ ...details, ncpdpId: '12345' })).toEqual({ ok: false, errors: { ncpdpId: expect.any(String) } })
    expect(validateDetails({ ...details, deaNumber: 'ab1234567' }).ok).toBe(true)
    expect(validateDetails({ ...details, deaNumber: 'A1234' })).toEqual({ ok: false, errors: { deaNumber: expect.any(String) } })
    expect(validateDetails({ ...details, legalName: '' })).toEqual({ ok: false, errors: expect.objectContaining({ legalName: expect.any(String) }) })
  })

  it('facility: 503A or 503B only', () => {
    expect(validateFacility({ facilityType: '503B' })).toEqual({ ok: true, value: { facility_type: '503B' } })
    expect(validateFacility({ facilityType: 'retail' }).ok).toBe(false)
  })

  it('license: a state, a number, an expiry not in the past, a sterile scope answered', () => {
    expect(validateLicense({ state: 'ca', licenseNumber: ' PHY 123 ', expiresOn: '2027-06-30', sterileCompounding: true }, NOW))
      .toEqual({ ok: true, value: { state_code: 'CA', license_number: 'PHY 123', expiration_date: '2027-06-30', sterile_compounding: true } })
    expect(validateLicense({ state: 'CA', licenseNumber: 'X', expiresOn: '2026-10-08', sterileCompounding: false }, NOW)).toEqual({ ok: false, errors: { expiresOn: expect.stringContaining('expired') } })
    expect(validateLicense({ state: 'ZZ', licenseNumber: 'X', expiresOn: '2027-01-01', sterileCompounding: false }, NOW)).toEqual({ ok: false, errors: { state: expect.any(String) } })
    expect(validateLicense({ state: 'CA', licenseNumber: 'X', expiresOn: '2027-01-01', sterileCompounding: null }, NOW)).toEqual({ ok: false, errors: { sterileCompounding: expect.any(String) } })
  })

  it('ordering: API, portal or fax mapped to the integration tiers; secrets are separated out', () => {
    const api = validateOrdering({ method: 'api', api: { baseUrl: 'https://api.pharmacy.example/v1', authType: 'api_key', apiKey: 'sk_live_x' } })
    expect(api).toEqual({ ok: true, value: { method: 'api', tier: 'TIER_1_API', details: { base_url: 'https://api.pharmacy.example/v1', auth_type: 'api_key' }, secrets: { api_key: 'sk_live_x' }, faxNumber: null } })
    const portal = validateOrdering({ method: 'portal', portal: { portalUrl: 'https://portal.pharmacy.example', username: 'u', password: 'p' } })
    expect(portal).toEqual({ ok: true, value: { method: 'portal', tier: 'TIER_2_PORTAL', details: { portal_url: 'https://portal.pharmacy.example' }, secrets: { portal_username: 'u', portal_password: 'p' }, faxNumber: null } })
    const fax = validateOrdering({ method: 'fax', fax: { faxNumber: '512-555-0199' } })
    expect(fax).toEqual({ ok: true, value: { method: 'fax', tier: 'TIER_4_FAX', details: { fax_number: '+15125550199' }, secrets: {}, faxNumber: '+15125550199' } })
    expect(validateOrdering({ method: 'api', api: { baseUrl: 'http://insecure.example', authType: 'api_key', apiKey: 'k' } }).ok).toBe(false)
    expect(validateOrdering({ method: 'email' }).ok).toBe(false)
  })

  it('ordering: a saved secret may be left blank to keep it', () => {
    const r = validateOrdering({ method: 'api', api: { baseUrl: 'https://api.pharmacy.example', authType: 'api_key', apiKey: '' } }, { hasSavedSecrets: true })
    expect(r).toEqual({ ok: true, value: expect.objectContaining({ secrets: {} }) })
    expect(validateOrdering({ method: 'api', api: { baseUrl: 'https://api.pharmacy.example', authType: 'api_key', apiKey: '' } }).ok).toBe(false)
  })

  it('shipping: carriers, cold chain, states, cutoff time', () => {
    expect(validateShipping({ carriers: ['UPS', 'fedex', 'UPS'], coldChain: true, shipToStates: ['tx', 'CA'], cutoffTime: '14:30' }))
      .toEqual({ ok: true, value: { ship_carriers: ['FEDEX', 'UPS'], ships_cold_chain: true, ship_to_states: ['CA', 'TX'], order_cutoff_local: '14:30' } })
    expect(validateShipping({ carriers: [], coldChain: false, shipToStates: ['TX'], cutoffTime: '14:30' }).ok).toBe(false)
    expect(validateShipping({ carriers: ['UPS'], coldChain: false, shipToStates: [], cutoffTime: '14:30' }).ok).toBe(false)
    expect(validateShipping({ carriers: ['UPS'], coldChain: false, shipToStates: ['TX'], cutoffTime: '25:00' }).ok).toBe(false)
  })

  it('acceptance: signer, title, the current template version and text hash, and an explicit yes', () => {
    const good = { signerName: 'Dana Ruiz', signerTitle: 'Pharmacist in charge', templateVersion: AGREEMENT.version, textSha256: agreementTextSha256(), accept: true }
    expect(validateAcceptance(good).ok).toBe(true)
    expect(validateAcceptance({ ...good, accept: false }).ok).toBe(false)
    expect(validateAcceptance({ ...good, templateVersion: 'old' })).toEqual({ ok: false, errors: { templateVersion: expect.stringContaining('changed') } })
    expect(validateAcceptance({ ...good, textSha256: '0'.repeat(64) }).ok).toBe(false)
  })
})

describe('the agreement', () => {
  // The BAA is src/content/legal/baa-draft-v0.1.md (PR #213), not text of
  // our own. Version "v0.1"; the hash is the SHA-256 of the exact text as
  // committed (LF line endings, pinned by .gitattributes, so a Windows
  // checkout hashes the same as production).
  const file = () => readFileSync(join(process.cwd(), 'src', 'content', 'legal', 'baa-draft-v0.1.md'), 'utf8').replace(/\r\n/g, '\n')

  it('is the v0.1 draft file, with the draft banner kept', () => {
    expect(AGREEMENT.version).toBe('v0.1')
    expect(AGREEMENT.key).toBe('baa')
    expect(AGREEMENT.draft).toBe(true)
    expect(AGREEMENT.banner).toBe('Draft, pending legal review')
    expect(AGREEMENT.title).toBe('Business Associate Agreement')
    expect(agreementText()).toBe(file())
    expect(agreementText()).toContain('# Business Associate Agreement')
  })

  it('the stored hash is the SHA-256 of that exact text', () => {
    expect(agreementTextSha256()).toBe(createHash('sha256').update(file(), 'utf8').digest('hex'))
  })

  it('line endings are pinned to LF, and the file ships with the routes that read it', () => {
    expect(readFileSync(join(process.cwd(), '.gitattributes'), 'utf8')).toMatch(/^src\/content\/legal\/\*\.md text eol=lf\r?$/m)
    const config = readFileSync(join(process.cwd(), 'next.config.ts'), 'utf8')
    expect(config).toContain('outputFileTracingIncludes')
    for (const route of ['/api/pharmacy/**', '/pharmacy/**', '/api/ops/onboarding/**']) {
      expect(config).toContain(`'${route}': ['./src/content/legal/**']`)
    }
  })
})

describe('catalog CSV (the ops upload validator)', () => {
  it('keeps valid rows, skips incomplete ones with a warning, defaults an unknown status to ACTIVE', () => {
    const r = validateCatalogRows([
      { medication_name: 'Progesterone', form: 'Capsule', dose: '100mg', wholesale_price: '18.50', regulatory_status: 'active' },
      { medication_name: '', form: 'Capsule', dose: '100mg', wholesale_price: '1', regulatory_status: 'ACTIVE' },
      { medication_name: 'DHEA', form: 'Capsule', dose: '10mg', wholesale_price: 'x', regulatory_status: 'ACTIVE' },
      { medication_name: 'LDN', form: 'Solution', dose: '1mg/mL', wholesale_price: '30', regulatory_status: 'weird' },
    ])
    expect(r.valid.map(v => v.medication_name)).toEqual(['Progesterone', 'LDN'])
    expect(r.valid[1]!.regulatory_status).toBe('ACTIVE')
    expect(r.warnings).toEqual([
      expect.stringContaining('Row 3: skipped'),
      expect.stringContaining('Row 4: skipped'),
      expect.stringContaining("Row 5: invalid regulatory_status 'WEIRD'"),
    ])
  })
})

describe('steps', () => {
  it('the wizard order, and what complete means', () => {
    expect(ONBOARDING_STEPS.map(s => s.key)).toEqual(['details', 'facility', 'licenses', 'ordering', 'shipping', 'agreement', 'catalog', 'review'])
    expect(stepsComplete(['details', 'facility', 'licenses', 'ordering', 'shipping', 'agreement', 'catalog'])).toBe(true)
    expect(stepsComplete(['details', 'facility'])).toBe(false)
  })
})
