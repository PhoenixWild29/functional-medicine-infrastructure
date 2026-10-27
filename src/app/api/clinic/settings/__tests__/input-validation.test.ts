/**
 * @jest-environment node
 *
 * PATCH /api/clinic/settings input validation. The clinic admin check
 * comes first (admin-only.test.ts); then the body. A JSON body that is not
 * an object is a 400, not a thrown 500; an oversize logo URL is a 400.
 * Nothing is written on bad input.
 */

import type { NextRequest } from 'next/server'

const getUserMock = jest.fn()
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockResolvedValue({ auth: { getUser: () => getUserMock() } }),
}))
const updateMock = jest.fn()
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => ({ update: (u: unknown) => { updateMock(u); return { eq: () => ({ is: async () => ({ error: null }) }) } } }),
  }),
}))

import { PATCH } from '../route'

const req = (body: string) =>
  new Request('https://app.test/api/clinic/settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body }) as unknown as NextRequest

beforeEach(() => {
  updateMock.mockReset()
  getUserMock.mockResolvedValue({ data: { user: { id: 'u', app_metadata: { clinic_id: 'c1', app_role: 'clinic_admin' } } } })
  jest.spyOn(console, 'info').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('PATCH /api/clinic/settings: input', () => {
  it('invalid JSON: 400', async () => {
    const res = await PATCH(req('{'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Invalid JSON body')
  })

  it.each([['null', 'null'], ['an array', '[1]'], ['a string', '"x"']])('a JSON body that is %s: 400, nothing written', async (_l, body) => {
    const res = await PATCH(req(body))
    expect(res.status).toBe(400)
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('an oversize logo_url: 400, nothing written', async () => {
    const res = await PATCH(req(JSON.stringify({ logo_url: `https://example.com/${'a'.repeat(3000)}.png` })))
    expect(res.status).toBe(400)
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('a markup that is a string: 400 with the existing message', async () => {
    const res = await PATCH(req(JSON.stringify({ default_markup_pct: '40' })))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('default_markup_pct must be a positive number')
  })

  it('a normal Supabase Storage logo URL is still accepted', async () => {
    const url = 'https://abcdefgh.supabase.co/storage/v1/object/public/clinic-logos/c1/logo-1730000000000.png'
    const res = await PATCH(req(JSON.stringify({ logo_url: url })))
    expect(res.status).toBe(200)
    expect(updateMock).toHaveBeenCalledWith({ logo_url: url })
  })
})
