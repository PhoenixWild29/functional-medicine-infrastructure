/**
 * @jest-environment node
 *
 * Tests for the demo TOTP pre-enrollment helper.
 *
 * Covers:
 *   - POC_MODE gate (no-ops when not set)
 *   - Enrolls when provider has no existing secret
 *   - Idempotent when provider already has the canonical secret
 *   - Overwrites on drift (stored decrypts to a different plaintext)
 *   - Overwrites on malformed ciphertext (decryption throws)
 *   - Provider-missing and update-error report paths
 *   - Persists all three state columns (totp_enabled + totp_verified_at + secret)
 *     — the "deliberate divergence" from the normal setup-then-verify flow
 *     per cowork review #6 finding A2.
 *   - DEMO_TOTP_SECRET is a valid 32-char Base32 string
 *
 * otplib-specific round-trip coverage (generating a code + verifying it)
 * lives in the Playwright E2E, which runs in Node and doesn't hit the
 * Next.js/jest ESM-import issue. The E2E also proves that the same
 * secret we publish in the demo doc actually produces valid 6-digit
 * codes that the EPCS gate accepts.
 */

import {
  DEMO_PROVIDER_ID,
  DEMO_TOTP_SECRET,
  enrollDemoProvider,
} from '../totp-enrollment'
import { encryptSecret } from '@/lib/epcs/crypto'

describe('enrollDemoProvider', () => {
  beforeAll(() => {
    process.env['SUPABASE_SERVICE_ROLE_KEY'] =
      'test-service-role-key-at-least-32-bytes-long-for-aes-256-gcm'
  })

  function makeSupabaseMock(scenario: {
    providerRow?: {
      provider_id: string
      totp_secret_encrypted: string | null
      totp_enabled: boolean | null
      totp_verified_at: string | null
    } | null
    fetchError?: { message: string }
    updateError?: { message: string }
  }) {
    const updateCalls: Array<Record<string, unknown>> = []
    const mock = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: scenario.providerRow ?? null,
              error: scenario.fetchError ?? null,
            }),
          }),
        }),
        update: (payload: Record<string, unknown>) => {
          updateCalls.push(payload)
          return {
            eq: async () => ({ error: scenario.updateError ?? null }),
          }
        },
      }),
    }
    return { mock, updateCalls }
  }

  it('skips without touching the DB when POC_MODE is not true', async () => {
    delete process.env['POC_MODE']
    const { mock, updateCalls } = makeSupabaseMock({})
    const result = await enrollDemoProvider(mock as never)
    expect(result.action).toBe('skipped_not_poc_mode')
    expect(updateCalls).toHaveLength(0)
  })

  describe('when POC_MODE=true', () => {
    beforeAll(() => {
      process.env['POC_MODE'] = 'true'
    })

    it('enrolls when the provider row has a null totp_secret_encrypted', async () => {
      const { mock, updateCalls } = makeSupabaseMock({
        providerRow: {
          provider_id: DEMO_PROVIDER_ID,
          totp_secret_encrypted: null,
          totp_enabled: false,
          totp_verified_at: null,
        },
      })
      const result = await enrollDemoProvider(mock as never)
      expect(result.action).toBe('enrolled')
      // Persists all three columns — the deliberate divergence from the
      // normal interactive setup-then-verify flow.
      expect(updateCalls).toHaveLength(1)
      const payload = updateCalls[0]!
      expect(payload['totp_secret_encrypted']).toEqual(expect.stringMatching(/^[a-f0-9]{24}:[a-f0-9]{32}:[a-f0-9]+$/))
      expect(payload['totp_enabled']).toBe(true)
      expect(typeof payload['totp_verified_at']).toBe('string')
    })

    it('is idempotent when the stored secret already decrypts to DEMO_TOTP_SECRET', async () => {
      const alreadyEncrypted = encryptSecret(DEMO_TOTP_SECRET)
      const { mock, updateCalls } = makeSupabaseMock({
        providerRow: {
          provider_id: DEMO_PROVIDER_ID,
          totp_secret_encrypted: alreadyEncrypted,
          totp_enabled: true,
          totp_verified_at: new Date().toISOString(),
        },
      })
      const result = await enrollDemoProvider(mock as never)
      expect(result.action).toBe('already_correct')
      expect(updateCalls).toHaveLength(0)
    })

    it('overwrites when the stored secret decrypts to a different plaintext', async () => {
      const staleEncrypted = encryptSecret('SOMEOTHERSECRETXXXXXXXXXXXXXXXXXX')
      const { mock, updateCalls } = makeSupabaseMock({
        providerRow: {
          provider_id: DEMO_PROVIDER_ID,
          totp_secret_encrypted: staleEncrypted,
          totp_enabled: true,
          totp_verified_at: new Date().toISOString(),
        },
      })
      const result = await enrollDemoProvider(mock as never)
      expect(result.action).toBe('overwrote_drift')
      expect(updateCalls).toHaveLength(1)
    })

    it('overwrites (does not throw) when the stored ciphertext is malformed', async () => {
      const { mock, updateCalls } = makeSupabaseMock({
        providerRow: {
          provider_id: DEMO_PROVIDER_ID,
          totp_secret_encrypted: 'not-valid-ciphertext-format',
          totp_enabled: true,
          totp_verified_at: new Date().toISOString(),
        },
      })
      const result = await enrollDemoProvider(mock as never)
      expect(result.action).toBe('overwrote_drift')
      expect(updateCalls).toHaveLength(1)
    })

    it('returns provider_missing when the row is absent', async () => {
      const { mock, updateCalls } = makeSupabaseMock({ providerRow: null })
      const result = await enrollDemoProvider(mock as never)
      expect(result.action).toBe('provider_missing')
      expect(updateCalls).toHaveLength(0)
    })

    it('returns provider_missing on fetch error', async () => {
      const { mock } = makeSupabaseMock({
        fetchError: { message: 'connection closed' },
      })
      const result = await enrollDemoProvider(mock as never)
      expect(result.action).toBe('provider_missing')
      expect(result.detail).toBe('connection closed')
    })

    it('reports provider_missing with detail when the update fails', async () => {
      const { mock } = makeSupabaseMock({
        providerRow: {
          provider_id: DEMO_PROVIDER_ID,
          totp_secret_encrypted: null,
          totp_enabled: false,
          totp_verified_at: null,
        },
        updateError: { message: 'permission denied' },
      })
      const result = await enrollDemoProvider(mock as never)
      expect(result.action).toBe('provider_missing')
      expect(result.detail).toBe('permission denied')
    })
  })
})

describe('DEMO_TOTP_SECRET shape', () => {
  it('is a valid RFC 4648 Base32 string of 32 chars (160 bits)', () => {
    // Base32 alphabet: A-Z and 2-7, no padding.
    expect(DEMO_TOTP_SECRET).toMatch(/^[A-Z2-7]{32}$/)
  })

  it('is not a known published test vector (avoids secret-scanner noise)', () => {
    // RFC 6238 section 5.1 Appendix B and commonly published demo secrets.
    const knownVectors = [
      'JBSWY3DPEHPK3PXP', // Google Authenticator docs
      'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', // RFC 6238 Appendix B
      'HXDMVJECJJWSRB3HWIZR4IFUGFTMXBOZ', // Authy default
    ]
    expect(knownVectors).not.toContain(DEMO_TOTP_SECRET)
  })
})
