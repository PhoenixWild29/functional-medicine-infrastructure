/**
 * @jest-environment node
 *
 * EPCS: a wrong authenticator code must not verify.
 *
 * otplib 13's verifySync returns an OBJECT — { valid: true, delta, … } or
 * { valid: false } — not a boolean. The route read it as a boolean
 * (`const isValid = verifySync(...)`; `if (isValid)`), and { valid: false }
 * is truthy. Every 6-digit code "verified", so the second factor DEA 21 CFR
 * 1311 requires at the point of signing a controlled substance did nothing.
 *
 * The mock below returns exactly what otplib 13 returns (checked against
 * the real library: a wrong code gives {"valid":false}, the current code
 * gives {"valid":true,"delta":0,…}). The old mock returned `true`, which is
 * why no test ever caught this.
 */

import { POST } from '../route'
import type { NextRequest } from 'next/server'

const PROVIDER_ID = 'a2000000-0000-0000-0000-000000000001'
const GOOD_CODE = '123456'

const providerUpdateMock = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockResolvedValue({
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
  }),
}))

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn().mockReturnValue({
    from: (table: string) => {
      if (table === 'providers') {
        return {
          select: () => ({ eq: () => ({ single: async () => ({ data: { totp_secret_encrypted: 'enc(SECRET)' }, error: null }) }) }),
          update: (values: unknown) => ({ eq: (col: string, val: unknown) => providerUpdateMock(values, col, val) }),
        }
      }
      throw new Error(`Unexpected table in test: ${table}`)
    },
  }),
}))

// otplib 13's real contract (see the file comment).
jest.mock('otplib', () => ({
  TOTP: class {},
  generateSecret: () => 'NEWSECRET',
  generateURI: () => 'otpauth://totp/x',
  verifySync: ({ token }: { token: string }) =>
    token === GOOD_CODE ? { valid: true, delta: 0, epoch: 0, timeStep: 0 } : { valid: false },
}))
jest.mock('qrcode', () => ({ toDataURL: async () => 'data:image/png;base64,AAA' }))
jest.mock('@/lib/epcs/crypto', () => ({
  encryptSecret: (s: string) => `enc(${s})`,
  decryptSecret: (s: string) => s.replace(/^enc\(|\)$/g, ''),
}))

function verify(code: string) {
  return POST({
    url:  'https://app.test/api/epcs?action=verify',
    json: async () => ({ provider_id: PROVIDER_ID, code }),
  } as unknown as NextRequest)
}

beforeEach(() => {
  providerUpdateMock.mockReset().mockResolvedValue({ error: null })
})

describe('POST ?action=verify', () => {
  it('rejects a wrong code', async () => {
    const res = await verify('000000')

    expect(res.status).toBe(401)
    expect((await res.json() as { verified: boolean }).verified).toBe(false)
  })

  it('does not mark the authenticator enrolled on a wrong code', async () => {
    await verify('000000')

    expect(providerUpdateMock).not.toHaveBeenCalled()
  })

  it('accepts the current code', async () => {
    const res = await verify(GOOD_CODE)

    expect(res.status).toBe(200)
    expect((await res.json() as { verified: boolean }).verified).toBe(true)
    expect(providerUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ totp_enabled: true }), 'provider_id', PROVIDER_ID,
    )
  })
})
