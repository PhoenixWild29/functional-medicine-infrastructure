/**
 * @jest-environment node
 *
 * Roundtrip tests for the EPCS TOTP secret encryption helpers.
 * Guards against a future refactor of one side drifting from the other.
 */

import { encryptSecret, decryptSecret } from '../crypto'

describe('EPCS crypto roundtrip', () => {
  beforeAll(() => {
    process.env['SUPABASE_SERVICE_ROLE_KEY'] =
      'test-service-role-key-at-least-32-bytes-long-for-aes-256-gcm'
  })

  it('encrypt then decrypt returns the original plaintext', () => {
    const plaintext = 'KBWXKJSXT4XFKUGUZKI2OYCNNYPUCVBH'
    const encrypted = encryptSecret(plaintext)
    expect(decryptSecret(encrypted)).toBe(plaintext)
  })

  it('ciphertext has the 3-part colon-delimited shape', () => {
    const encrypted = encryptSecret('test-secret')
    const parts = encrypted.split(':')
    expect(parts).toHaveLength(3)
    // iv = 12 bytes = 24 hex chars; tag = 16 bytes = 32 hex chars
    expect(parts[0]).toMatch(/^[a-f0-9]{24}$/)
    expect(parts[1]).toMatch(/^[a-f0-9]{32}$/)
    expect(parts[2]).toMatch(/^[a-f0-9]+$/)
  })

  it('decryptSecret throws on malformed input (not silently wrong)', () => {
    expect(() => decryptSecret('not-valid')).toThrow()
    expect(() => decryptSecret('a:b')).toThrow()
    expect(() => decryptSecret('')).toThrow()
  })

  it('repeated encrypts of the same plaintext produce different ciphertexts (IV is random)', () => {
    const plaintext = 'test-secret-value'
    const c1 = encryptSecret(plaintext)
    const c2 = encryptSecret(plaintext)
    expect(c1).not.toBe(c2)
    // But both decrypt back to the same plaintext.
    expect(decryptSecret(c1)).toBe(plaintext)
    expect(decryptSecret(c2)).toBe(plaintext)
  })
})
