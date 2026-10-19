/**
 * @jest-environment node
 *
 * POST /api/signup: public (no session), rate limited per client IP with
 * lib/security/rate-limit, then lib/signup/self-serve. Cross-site writes
 * are refused. The IP itself is never logged.
 */

import { NextRequest } from 'next/server'

const selfServeSignupMock = jest.fn()
jest.mock('@/lib/signup/self-serve', () => ({
  ...jest.requireActual('@/lib/signup/self-serve'),
  selfServeSignup: (...a: unknown[]) => selfServeSignupMock(...a),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ marker: 'service' }) }))

import { POST } from '../route'
import { signupLimiter, SIGNUP_RATE_LIMITED_MESSAGE } from '@/lib/signup/rate-limit'

const req = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(new URL('https://app.example/api/signup'), {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7', ...headers }, body: JSON.stringify(body),
  })

beforeEach(() => {
  signupLimiter.reset()
  selfServeSignupMock.mockReset().mockResolvedValue({ ok: true, email: 'd@example.test', next: '/dashboard' })
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

it('201 with where to go next; the body reaches the library', async () => {
  const res = await POST(req({ kind: 'clinic' }))
  expect(res.status).toBe(201)
  expect(await res.json()).toEqual({ email: 'd@example.test', next: '/dashboard' })
  expect(selfServeSignupMock).toHaveBeenCalledWith({ marker: 'service' }, { kind: 'clinic' })
  expect(res.headers.get('cache-control')).toBe('no-store')
})

it('the honeypot: the same 201 a person gets, nothing said about it', async () => {
  selfServeSignupMock.mockResolvedValue({ ok: true, honeypot: true, email: 'bot@example.test', next: '/login' })
  const res = await POST(req({ kind: 'clinic', website: 'x' }))
  expect(res.status).toBe(201)
  expect(await res.json()).toEqual({ email: 'bot@example.test', next: '/login' })
})

it('a refusal keeps its status, message and field errors', async () => {
  selfServeSignupMock.mockResolvedValue({ ok: false, status: 400, error: 'Check the highlighted fields.', errors: { password: 'Use at least 12 characters.' } })
  const res = await POST(req({}))
  expect(res.status).toBe(400)
  expect(await res.json()).toEqual({ error: 'Check the highlighted fields.', errors: { password: 'Use at least 12 characters.' } })
})

it('rate limited per IP: the 6th attempt in 15 minutes is 429 with Retry-After, and the library is not called', async () => {
  for (let i = 0; i < 5; i++) expect((await POST(req({}))).status).toBe(201)
  selfServeSignupMock.mockClear()
  const res = await POST(req({}))
  expect(res.status).toBe(429)
  expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0)
  expect(await res.json()).toEqual({ error: SIGNUP_RATE_LIMITED_MESSAGE })
  expect(selfServeSignupMock).not.toHaveBeenCalled()
  // Another address is not affected.
  expect((await POST(req({}, { 'x-forwarded-for': '198.51.100.9' }))).status).toBe(201)
  // The address is never logged.
  const logged = (console.warn as jest.Mock).mock.calls.flat().map(String).join(' ')
  expect(logged).not.toContain('203.0.113.7')
})

it('a cross-site request is refused before anything runs', async () => {
  const res = await POST(req({}, { 'sec-fetch-site': 'cross-site' }))
  expect(res.status).toBe(403)
  expect(selfServeSignupMock).not.toHaveBeenCalled()
})

it('not JSON: 400', async () => {
  const res = await POST(new NextRequest(new URL('https://app.example/api/signup'), { method: 'POST', body: '{nope' }))
  expect(res.status).toBe(400)
  expect(selfServeSignupMock).not.toHaveBeenCalled()
})
