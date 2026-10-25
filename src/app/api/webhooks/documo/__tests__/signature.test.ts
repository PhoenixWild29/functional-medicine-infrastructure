/**
 * @jest-environment node
 *
 * The Documo webhooks (outbound fax status and inbound fax) check the
 * X-Documo-Signature HMAC on the raw body before the body is parsed. A
 * missing or malformed signature is refused 400 'Invalid signature' like
 * a wrong one, never a thrown 500, and nothing is read or written. The
 * real verifier runs here; only the secret is a test value.
 */

import { createHmac } from 'node:crypto'
import type { NextRequest } from 'next/server'

const SECRET = 'documo-test-secret'
jest.mock('@/lib/env', () => ({ serverEnv: { documoWebhookSecret: () => 'documo-test-secret' } }))
const serviceMock = jest.fn()
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => serviceMock() }))
jest.spyOn(console, 'error').mockImplementation(() => {})

import { POST as outbound } from '../route'
import { POST as inbound } from '../inbound/route'

const BODY = JSON.stringify({ id: 'evt-1', event: 'fax.received', data: { id: 'fax-1' } })
const sign = (body: string) => createHmac('sha256', SECRET).update(body).digest('hex')

function request(body: string, signature?: string) {
  return {
    text: async () => body,
    url: 'https://app.test/api/webhooks/documo',
    headers: new Headers(signature === undefined ? {} : { 'x-documo-signature': signature }),
  } as unknown as NextRequest
}

beforeEach(() => serviceMock.mockReset().mockImplementation(() => { throw new Error('the database must not be reached') }))

describe.each([
  ['outbound', outbound],
  ['inbound', inbound],
])('POST /api/webhooks/documo (%s)', (_name, POST) => {
  it.each([
    ['no signature', undefined],
    ['an empty signature', ''],
    ['a signature that is not hex', 'zz'.repeat(32)],
    ['a signature of odd length', 'abc'],
    ['a wrong signature', 'ab'.repeat(32)],
    ["another body's signature", sign('{"id":"other"}')],
  ])('%s: 400 Invalid signature, nothing read', async (_what, signature) => {
    const res = await POST(request(BODY, signature))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid signature' })
    expect(serviceMock).not.toHaveBeenCalled()
  })

  it('the body is never parsed before the signature: unparseable body, bad signature is still 400', async () => {
    const res = await POST(request('{not json', 'ab'.repeat(32)))
    expect(res.status).toBe(400)
    expect(serviceMock).not.toHaveBeenCalled()
  })
})
