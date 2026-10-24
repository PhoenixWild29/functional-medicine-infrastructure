/**
 * @jest-environment node
 *
 * Security review M2 (email enumeration) at POST /api/signup. There is no
 * email provider, and the new account is signed in at once, so a
 * duplicate cannot be made to look like a success (the sign-in that
 * follows would tell them apart). The duplicate keeps its neutral 409,
 * but:
 *   - it is logged with keyed hashes of the IP and the email, never the
 *     address;
 *   - an IP that gets 2 duplicate answers in an hour gets 429 for every
 *     sign-up for the rest of that hour, so emails cannot be probed in
 *     bulk (on top of the 5 per 15 minutes for every sign-up).
 */

const signupMock = jest.fn()
jest.mock('@/lib/signup/self-serve', () => ({ selfServeSignup: (...a: unknown[]) => signupMock(...a) }))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({}) }))
jest.mock('@/lib/audit/keyed-hash', () => ({
  clientIp: (h: Headers) => h.get('x-forwarded-for'),
  auditHash: async (v: string | null) => (v ? `hash(${v})` : null),
}))

import { POST } from '../route'
import { duplicateEmailGuard, signupLimiter, DUPLICATE_EMAIL_LIMIT } from '@/lib/signup/rate-limit'

const DUP = { ok: false, status: 409, code: 'DUPLICATE_EMAIL', error: 'We could not create an account with these details. If you already have an account, sign in instead.' }
const req = (ip: string, email = 'someone@example.test') => new Request('https://app.test/api/signup', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
  body: JSON.stringify({ kind: 'clinic', email }),
}) as never

const logs: string[] = []
beforeEach(() => {
  signupLimiter.reset()
  duplicateEmailGuard.reset()
  logs.length = 0
  signupMock.mockReset().mockResolvedValue(DUP)
  jest.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(' ')) })
})
afterEach(() => jest.restoreAllMocks())

it('a duplicate: the neutral 409, logged with hashes only', async () => {
  const res = await POST(req('1.1.1.1', 'Taken@Example.test'))
  expect(res.status).toBe(409)
  expect(await res.json()).toEqual({ error: DUP.error })
  expect(logs.join('\n')).toContain('[signup] duplicate_email | ip_hash=hash(1.1.1.1) | email_hash=hash(taken@example.test)')
  expect(logs.join('\n')).not.toMatch(/Taken@Example|taken@example\.test(?!\))/i)
})

it(`after ${DUPLICATE_EMAIL_LIMIT} duplicates in an hour, every sign-up from that IP is 429 (and not even read)`, async () => {
  for (let i = 0; i < DUPLICATE_EMAIL_LIMIT; i++) expect((await POST(req('2.2.2.2', `a${i}@example.test`))).status).toBe(409)
  signupMock.mockClear().mockResolvedValue({ ok: true, email: 'new@example.test', next: '/onboarding' })
  const res = await POST(req('2.2.2.2', 'new@example.test'))
  expect(res.status).toBe(429)
  expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0)
  expect(signupMock).not.toHaveBeenCalled()
  // Another IP is not affected.
  expect((await POST(req('3.3.3.3', 'new@example.test'))).status).toBe(201)
})

it('a successful sign-up is not counted as a duplicate', async () => {
  signupMock.mockResolvedValue({ ok: true, email: 'new@example.test', next: '/onboarding' })
  for (let i = 0; i < 3; i++) expect((await POST(req('4.4.4.4', `n${i}@example.test`))).status).toBe(201)
})
