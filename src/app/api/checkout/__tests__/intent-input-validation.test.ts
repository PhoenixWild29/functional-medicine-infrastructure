/**
 * @jest-environment node
 *
 * Input validation for the patient checkout intent endpoints. The token is
 * the credential: its shape is checked before it is verified or anything is
 * read. A JSON body that is not an object (null, an array) is a 400, not a
 * thrown 500; an oversize token is a 400 and is never verified.
 * Stripe and the database are mocked; nothing is charged.
 */

import type { NextRequest } from 'next/server'

const verifyMock = jest.fn()
const fromMock = jest.fn()
const stripeMock = jest.fn()
jest.mock('@/lib/auth/checkout-token', () => ({ verifyCheckoutToken: (t: string) => verifyMock(t) }))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ from: (t: string) => fromMock(t) }) }))
jest.mock('@/lib/stripe/client', () => ({ createStripeClient: () => stripeMock() }))

import { POST as soloPOST } from '../payment-intent/route'
import { POST as groupPOST } from '../payment-group-intent/route'

const req = (body: string) =>
  new Request('https://app.test/api/checkout/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body }) as unknown as NextRequest

beforeEach(() => {
  verifyMock.mockReset().mockResolvedValue(null)
  fromMock.mockReset()
  stripeMock.mockReset()
  process.env['PHASE_C_GROUPS_ENABLED'] = 'true'
})
afterEach(() => { delete process.env['PHASE_C_GROUPS_ENABLED'] })

describe.each([['payment-intent', soloPOST], ['payment-group-intent', groupPOST]])('POST /api/checkout/%s', (_name, POST) => {
  it('invalid JSON: 400 Invalid JSON body', async () => {
    const res = await POST(req('{'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Invalid JSON body')
  })

  it.each([['null', 'null'], ['an array', '[]']])('a JSON body that is %s: 400 Missing token, nothing read', async (_l, body) => {
    const res = await POST(req(body))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Missing token')
    expect(verifyMock).not.toHaveBeenCalled()
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('an oversize token: 400, never verified', async () => {
    const res = await POST(req(JSON.stringify({ token: 'a'.repeat(5000) })))
    expect(res.status).toBe(400)
    expect(verifyMock).not.toHaveBeenCalled()
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('a token that is not a string: 400 Missing token', async () => {
    const res = await POST(req(JSON.stringify({ token: 42 })))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Missing token')
  })

  it('a well-formed token that does not verify: still 401, nothing read', async () => {
    const res = await POST(req(JSON.stringify({ token: 'aaa.bbb.ccc' })))
    expect(res.status).toBe(401)
    expect(fromMock).not.toHaveBeenCalled()
    expect(stripeMock).not.toHaveBeenCalled()
  })
})
