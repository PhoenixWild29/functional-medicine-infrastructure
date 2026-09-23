/**
 * @jest-environment node
 *
 * Only the clinic admin may write clinic settings. Before this, any
 * signed-in clinic user — a medical assistant, a provider — could change
 * the default markup, shipping absorption and the logo through this API.
 * Everyone else gets 403 on every field, and nothing is written.
 */

import { PATCH } from '../route'
import type { NextRequest } from 'next/server'

const getSessionMock = jest.fn()
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockResolvedValue({ auth: { getSession: () => getSessionMock() } }),
}))
const updateMock = jest.fn()
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => ({ update: (u: unknown) => { updateMock(u); return { eq: () => ({ is: async () => ({ error: null }) }) } } }),
  }),
}))

const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest
function as(role: string) {
  getSessionMock.mockResolvedValue({ data: { session: { user: { id: 'u', user_metadata: { clinic_id: 'c1', app_role: role } } } } })
}

const FIELDS: Array<[string, Record<string, unknown>]> = [
  ['default markup',     { default_markup_pct: 55 }],
  ['shipping absorption', { absorb_shipping: true }],
  ['logo',               { logo_url: 'https://example.com/logo.png' }],
  ['all three at once',  { default_markup_pct: 55, absorb_shipping: true, logo_url: null }],
]

beforeEach(() => { updateMock.mockReset(); jest.spyOn(console, 'info').mockImplementation(() => {}); jest.spyOn(console, 'warn').mockImplementation(() => {}) })
afterEach(() => { jest.restoreAllMocks() })

describe('PATCH /api/clinic/settings — admin only', () => {
  describe.each(['medical_assistant', 'provider'])('a %s', role => {
    it.each(FIELDS)('cannot change the %s: 403, nothing written', async (_label, body) => {
      as(role)
      const res = await PATCH(req(body))
      expect(res.status).toBe(403)
      expect((await res.json()).error).toBe('Only the clinic admin can change clinic settings.')
      expect(updateMock).not.toHaveBeenCalled()
    })
  })

  it.each(FIELDS)('the clinic admin can change the %s', async (_label, body) => {
    as('clinic_admin')
    const res = await PATCH(req(body))
    expect(res.status).toBe(200)
    expect(updateMock).toHaveBeenCalledWith(body)
  })
})
