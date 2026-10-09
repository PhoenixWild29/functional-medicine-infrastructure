/**
 * @jest-environment node
 *
 * Compliance C3: multi-factor sign-in for every clinic and ops user.
 *
 * The rule, in one place, so middleware, the pages and the tests agree:
 *   - REQUIRE_MFA=true enforces it for every staff role; unset (the
 *     default) leaves sign-in as it was, so demo accounts and E2E keep
 *     working until the owner turns it on;
 *   - MFA_ENFORCED_EMAILS enforces it for named accounts only, so E2E can
 *     run a dedicated user with it on while everyone else is unchanged;
 *   - a session at AAL2 passes; at AAL1 a user with a verified TOTP factor
 *     is challenged (even with enforcement off: a factor they chose to
 *     enroll is honoured), one without is sent to enroll when enforced;
 *   - patients (checkout links) have no staff role and are never gated.
 */

import { mfaGate, mfaEnforcedFor, hasVerifiedTotp, MFA_ROLES, isMfaExemptPath } from '../mfa'

const ENV_KEYS = ['REQUIRE_MFA', 'MFA_ENFORCED_EMAILS'] as const
const saved: Record<string, string | undefined> = {}
beforeEach(() => { for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k] } })
afterEach(() => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] } })

describe('mfaEnforcedFor', () => {
  it('is off when REQUIRE_MFA is unset', () => {
    expect(mfaEnforcedFor('dr.chen@clinic.test')).toBe(false)
  })

  it('is on for everyone with REQUIRE_MFA=true, and only "true" turns it on', () => {
    process.env['REQUIRE_MFA'] = 'true'
    expect(mfaEnforcedFor('dr.chen@clinic.test')).toBe(true)
    process.env['REQUIRE_MFA'] = '1'
    expect(mfaEnforcedFor('dr.chen@clinic.test')).toBe(false)
    process.env['REQUIRE_MFA'] = 'false'
    expect(mfaEnforcedFor('dr.chen@clinic.test')).toBe(false)
  })

  it('MFA_ENFORCED_EMAILS turns it on for the named accounts only, case-insensitively', () => {
    process.env['MFA_ENFORCED_EMAILS'] = ' Test-MFA-Admin@compoundiq.test , other@x.test '
    expect(mfaEnforcedFor('test-mfa-admin@compoundiq.test')).toBe(true)
    expect(mfaEnforcedFor('other@x.test')).toBe(true)
    expect(mfaEnforcedFor('test-provider@compoundiq.test')).toBe(false)
    expect(mfaEnforcedFor(null)).toBe(false)
  })
})

describe('hasVerifiedTotp', () => {
  it('only a verified TOTP factor counts', () => {
    expect(hasVerifiedTotp({ factors: [{ factor_type: 'totp', status: 'verified' }] })).toBe(true)
    expect(hasVerifiedTotp({ factors: [{ factor_type: 'totp', status: 'unverified' }] })).toBe(false)
    expect(hasVerifiedTotp({ factors: [{ factor_type: 'phone', status: 'verified' }] })).toBe(false)
    expect(hasVerifiedTotp({ factors: [] })).toBe(false)
    expect(hasVerifiedTotp({})).toBe(false)
  })
})

describe('mfaGate', () => {
  it('covers provider, medical_assistant, clinic_admin, ops_admin and pharmacy_admin', () => {
    expect([...MFA_ROLES].sort()).toEqual(['clinic_admin', 'medical_assistant', 'ops_admin', 'pharmacy_admin', 'provider'])
  })

  it.each(MFA_ROLES)('%s at AAL1 without a factor is sent to enroll when enforced', role => {
    expect(mfaGate({ appRole: role, aal: 'aal1', verifiedFactor: false, enforced: true })).toBe('enroll')
  })

  it.each(MFA_ROLES)('%s at AAL1 with a verified factor is challenged when enforced', role => {
    expect(mfaGate({ appRole: role, aal: 'aal1', verifiedFactor: true, enforced: true })).toBe('challenge')
  })

  it('AAL2 passes', () => {
    expect(mfaGate({ appRole: 'provider', aal: 'aal2', verifiedFactor: true, enforced: true })).toBe('ok')
  })

  it('enforcement off: unchanged for a user without a factor', () => {
    expect(mfaGate({ appRole: 'provider', aal: 'aal1', verifiedFactor: false, enforced: false })).toBe('ok')
  })

  it('enforcement off: a factor the user enrolled voluntarily is still challenged', () => {
    expect(mfaGate({ appRole: 'provider', aal: 'aal1', verifiedFactor: true, enforced: false })).toBe('challenge')
  })

  it('a missing AAL claim is treated as AAL1', () => {
    expect(mfaGate({ appRole: 'clinic_admin', aal: undefined, verifiedFactor: false, enforced: true })).toBe('enroll')
  })

  it('no staff role (a patient, an unknown role) is never gated', () => {
    expect(mfaGate({ appRole: undefined, aal: 'aal1', verifiedFactor: false, enforced: true })).toBe('ok')
    expect(mfaGate({ appRole: 'patient', aal: 'aal1', verifiedFactor: true, enforced: true })).toBe('ok')
  })
})

describe('isMfaExemptPath', () => {
  it('the enroll and challenge pages are reachable at AAL1 (sign-out is client-side, to Supabase)', () => {
    expect(isMfaExemptPath('/mfa/enroll')).toBe(true)
    expect(isMfaExemptPath('/mfa/challenge')).toBe(true)
  })

  it('everything else is not', () => {
    for (const p of ['/dashboard', '/settings', '/ops', '/api/orders', '/mfa-something', '/mfaenroll']) {
      expect(isMfaExemptPath(p)).toBe(false)
    }
  })
})
