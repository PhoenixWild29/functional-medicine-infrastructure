/**
 * @jest-environment node
 *
 * Batch 1, finding 6 (server half).
 *
 * Two holes, either of which costs a provider their authenticator:
 *
 *   - GET ?action=status read the row as `{ data }` with the error
 *     discarded and answered `totp_enabled: false`. A database blip told
 *     the client "not enrolled".
 *   - POST ?action=setup then generated a new secret and wrote it over
 *     the existing one, unconditionally.
 *
 * Enrolment is not something to guess at: status must fail loud, and
 * setup must refuse to replace a secret that is already there.
 */

import { GET, POST } from '../route'
import type { NextRequest } from 'next/server'

const PROVIDER_ID = 'a2000000-0000-0000-0000-000000000001'

const getSessionMock   = jest.fn()
const providerFetchMock = jest.fn()
const providerUpdateMock = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockResolvedValue({ auth: { getSession: () => getSessionMock() } }),
}))

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn().mockReturnValue({
    from: (table: string) => {
      if (table === 'providers') {
        return {
          select: () => ({ eq: () => ({ single: () => providerFetchMock() }) }),
          update: (values: unknown) => ({ eq: (col: string, val: unknown) => providerUpdateMock(values, col, val) }),
        }
      }
      throw new Error(`Unexpected table in test: ${table}`)
    },
  }),
}))

jest.mock('@/lib/epcs/crypto', () => ({
  encryptSecret: (s: string) => `enc(${s})`,
  decryptSecret: (s: string) => s.replace(/^enc\(|\)$/g, ''),
}))

function getRequest(qs: string) {
  return { url: `https://app.test/api/epcs?${qs}` } as unknown as NextRequest
}
function postRequest(qs: string, body: unknown) {
  return { url: `https://app.test/api/epcs?${qs}`, json: async () => body } as unknown as NextRequest
}

beforeEach(() => {
  getSessionMock.mockReset().mockResolvedValue({ data: { session: { user: { id: 'u1' } } } })
  providerFetchMock.mockReset()
  providerUpdateMock.mockReset().mockResolvedValue({ error: null })
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { jest.restoreAllMocks() })

describe('GET ?action=status when the lookup fails', () => {
  it('does not answer "not enrolled"', async () => {
    providerFetchMock.mockResolvedValue({ data: null, error: { message: 'connection reset', code: '08006' } })

    const res = await GET(getRequest(`action=status&provider_id=${PROVIDER_ID}`))

    expect(res.status).toBeGreaterThanOrEqual(500)
    const body = await res.json() as { totp_enabled?: boolean }
    expect(body.totp_enabled).toBeUndefined()
  })

  it('still reports an enrolled provider', async () => {
    providerFetchMock.mockResolvedValue({ data: { totp_enabled: true, totp_verified_at: '2026-09-01T00:00:00Z' }, error: null })

    const res = await GET(getRequest(`action=status&provider_id=${PROVIDER_ID}`))

    expect(res.status).toBe(200)
    expect((await res.json() as { totp_enabled: boolean }).totp_enabled).toBe(true)
  })
})

describe('POST ?action=setup on a provider who already has a secret', () => {
  it('refuses, so the existing authenticator keeps working', async () => {
    providerFetchMock.mockResolvedValue({
      data: { first_name: 'Sarah', last_name: 'Chen', totp_secret_encrypted: 'enc(EXISTING)' },
      error: null,
    })

    const res = await POST(postRequest('action=setup', { provider_id: PROVIDER_ID }))

    expect(res.status).toBe(409)
    expect(providerUpdateMock).not.toHaveBeenCalled()
  })

  it('still enrols a provider who has none', async () => {
    providerFetchMock.mockResolvedValue({
      data: { first_name: 'Sarah', last_name: 'Chen', totp_secret_encrypted: null },
      error: null,
    })

    const res = await POST(postRequest('action=setup', { provider_id: PROVIDER_ID }))

    expect(res.status).toBe(200)
    expect(providerUpdateMock).toHaveBeenCalled()
  })

  it('refuses when the provider lookup itself failed', async () => {
    providerFetchMock.mockResolvedValue({ data: null, error: { message: 'connection reset', code: '08006' } })

    const res = await POST(postRequest('action=setup', { provider_id: PROVIDER_ID }))

    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(providerUpdateMock).not.toHaveBeenCalled()
  })
})
