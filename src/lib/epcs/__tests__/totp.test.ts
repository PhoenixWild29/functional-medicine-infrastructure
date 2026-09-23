/**
 * @jest-environment node
 *
 * EPCS code check at the point of signing (WO-99). otplib 13's verifySync
 * returns { valid, … } — the stub below returns exactly that shape (the
 * contract #171 established against the real library).
 */

import { isValidTotpResult, verifyProviderTotp, TOTP_EPOCH_TOLERANCE_SECONDS } from '../totp'

const verifySyncMock = jest.fn()
jest.mock('otplib', () => ({ verifySync: (...a: unknown[]) => verifySyncMock(...a) }))
jest.mock('../crypto', () => ({ decryptSecret: (s: string) => s.replace(/^enc\(|\)$/g, '') }))

function db(result: { data: unknown; error: { message: string } | null }) {
  return {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => result }) }) }),
  } as never
}
const enrolled = db({ data: { totp_secret_encrypted: 'enc(SECRET)', totp_enabled: true }, error: null })

beforeEach(() => {
  verifySyncMock.mockReset().mockImplementation(({ token }: { token: string }) =>
    token === '123456' ? { valid: true, delta: 0, epoch: 0, timeStep: 0 } : { valid: false })
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { jest.restoreAllMocks() })

describe('isValidTotpResult', () => {
  it('{ valid: false } — truthy as an object — is NOT valid', () => {
    expect(isValidTotpResult({ valid: false })).toBe(false)
  })
  it('only { valid: true } is valid', () => {
    expect(isValidTotpResult({ valid: true, delta: 0 })).toBe(true)
    expect(isValidTotpResult(true)).toBe(false)
    expect(isValidTotpResult(null)).toBe(false)
  })
})

describe('verifyProviderTotp', () => {
  it('the current code is valid, checked against the decrypted secret with one step of tolerance', async () => {
    expect(await verifyProviderTotp(enrolled, 'p1', '123456')).toBe('valid')
    expect(verifySyncMock).toHaveBeenCalledWith({ token: '123456', secret: 'SECRET', epochTolerance: TOTP_EPOCH_TOLERANCE_SECONDS })
  })
  it('a wrong code is invalid', async () => {
    expect(await verifyProviderTotp(enrolled, 'p1', '000000')).toBe('invalid')
  })
  it('a non-6-digit code is invalid without a lookup', async () => {
    expect(await verifyProviderTotp(enrolled, 'p1', '12345')).toBe('invalid')
    expect(await verifyProviderTotp(enrolled, 'p1', undefined)).toBe('invalid')
    expect(verifySyncMock).not.toHaveBeenCalled()
  })
  it('a provider with no working authenticator is not enrolled', async () => {
    expect(await verifyProviderTotp(db({ data: { totp_secret_encrypted: 'enc(S)', totp_enabled: false }, error: null }), 'p1', '123456')).toBe('not_enrolled')
    expect(await verifyProviderTotp(db({ data: null, error: null }), 'p1', '123456')).toBe('not_enrolled')
  })
  it('a lookup that failed is "unavailable" — never "valid", never "not enrolled"', async () => {
    expect(await verifyProviderTotp(db({ data: null, error: { message: 'connection reset' } }), 'p1', '123456')).toBe('unavailable')
  })
})
