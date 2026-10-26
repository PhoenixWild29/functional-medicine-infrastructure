/**
 * @jest-environment node
 *
 * Security B12: POST /api/sign-in and POST /api/mfa/verify. The server
 * signs in and verifies the two-step code, so each failure is recorded
 * (lib/auth/sign-in-monitor) and repeated failures are throttled; a
 * success leaves the session to the route handler client's cookies.
 */

import { NextRequest } from 'next/server'

const signInWithPassword = jest.fn()
const challengeAndVerify = jest.fn()
const getUser = jest.fn()
jest.mock('@/lib/supabase/server', () => ({
  createRouteHandlerClient: async () => ({ auth: { signInWithPassword, getUser, mfa: { challengeAndVerify } } }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ marker: 'service' }) }))
const recordMock = jest.fn()
jest.mock('@/lib/auth/sign-in-monitor', () => ({
  ...jest.requireActual('@/lib/auth/sign-in-monitor'),
  recordSignInFailure: (...a: unknown[]) => recordMock(...a),
}))

import { POST as signIn } from '../route'
import { POST as verify } from '../../mfa/verify/route'
import { signInThrottle } from '@/lib/auth/sign-in-monitor'

const IP = '203.0.113.7'
const req = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(new URL(`https://app.example${path}`), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': IP, 'user-agent': 'UA/1', ...headers },
    body: JSON.stringify(body),
  })

const user = { id: 'user-1', email: 'Jane@Clinic.test', app_metadata: { app_role: 'clinic_admin' } }

beforeEach(() => {
  signInThrottle.reset()
  signInWithPassword.mockReset().mockResolvedValue({ data: { user, session: { user } }, error: null })
  challengeAndVerify.mockReset().mockResolvedValue({ data: {}, error: null })
  getUser.mockReset().mockResolvedValue({ data: { user } })
  recordMock.mockReset().mockResolvedValue({ alerts: [] })
})

describe('POST /api/sign-in', () => {
  it('signs in with the normalised email and answers the role; nothing is recorded', async () => {
    const res = await signIn(req('/api/sign-in', { email: ' Jane@Clinic.test ', password: 'pw-pw-pw-pw-pw' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ appRole: 'clinic_admin' })
    expect(signInWithPassword).toHaveBeenCalledWith({ email: 'jane@clinic.test', password: 'pw-pw-pw-pw-pw' })
    expect(recordMock).not.toHaveBeenCalled()
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('a wrong password: 401 with the one message, and the failure is recorded with the IP, user agent and reason', async () => {
    signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error: { code: 'invalid_credentials', message: 'Invalid login credentials' } })
    const res = await signIn(req('/api/sign-in', { email: 'jane@clinic.test', password: 'wrong-wrong-wrong' }))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Invalid email or password. Please try again.' })
    expect(recordMock).toHaveBeenCalledWith({ marker: 'service' }, {
      step: 'password', email: 'jane@clinic.test', reason: 'invalid_credentials', ip: IP, userAgent: 'UA/1',
    })
  })

  it('a deactivated member: 403 user_banned, recorded', async () => {
    signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error: { code: 'user_banned', message: 'User is banned' } })
    const res = await signIn(req('/api/sign-in', { email: 'jane@clinic.test', password: 'pw-pw-pw-pw-pw' }))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('user_banned')
    expect(recordMock.mock.calls[0]![1]).toMatchObject({ reason: 'user_banned' })
  })

  it('after 5 failures for the account, the next attempt is 429 with Retry-After, before Supabase is asked', async () => {
    signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error: { code: 'invalid_credentials' } })
    for (let i = 0; i < 5; i++) expect((await signIn(req('/api/sign-in', { email: 'jane@clinic.test', password: 'x' }))).status).toBe(401)
    signInWithPassword.mockClear()
    const res = await signIn(req('/api/sign-in', { email: 'JANE@clinic.test', password: 'the-right-one' }))
    expect(res.status).toBe(429)
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0)
    expect((await res.json()).error).toMatch(/^Too many attempts\. Wait \d+ minutes? and try again\.$/)
    expect(signInWithPassword).not.toHaveBeenCalled()
  })

  it('a missing email or password is 400, and nothing reaches Supabase', async () => {
    expect((await signIn(req('/api/sign-in', { email: 'jane@clinic.test' }))).status).toBe(400)
    expect((await signIn(req('/api/sign-in', { password: 'x' }))).status).toBe(400)
    expect(signInWithPassword).not.toHaveBeenCalled()
  })

  it('a cross-site request is refused', async () => {
    const res = await signIn(req('/api/sign-in', { email: 'jane@clinic.test', password: 'x' }, { 'sec-fetch-site': 'cross-site' }))
    expect(res.status).toBe(403)
    expect(signInWithPassword).not.toHaveBeenCalled()
  })
})

describe('POST /api/mfa/verify', () => {
  it('verifies the code for the session\'s user', async () => {
    const res = await verify(req('/api/mfa/verify', { factorId: 'factor-1', code: '123456' }))
    expect(res.status).toBe(200)
    expect(challengeAndVerify).toHaveBeenCalledWith({ factorId: 'factor-1', code: '123456' })
    expect(recordMock).not.toHaveBeenCalled()
  })

  it('a wrong code: 400 with the message, recorded with the user id and role', async () => {
    challengeAndVerify.mockResolvedValue({ data: null, error: { code: 'mfa_verification_failed', message: 'Invalid TOTP code entered' } })
    const res = await verify(req('/api/mfa/verify', { factorId: 'factor-1', code: '000000' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/That code did not match/)
    expect(recordMock).toHaveBeenCalledWith({ marker: 'service' }, {
      step: 'mfa', email: 'Jane@Clinic.test', userId: 'user-1', role: 'clinic_admin',
      reason: 'mfa_verification_failed', ip: IP, userAgent: 'UA/1',
    })
  })

  it('after 5 wrong codes, 429 before Supabase is asked', async () => {
    challengeAndVerify.mockResolvedValue({ data: null, error: { code: 'mfa_verification_failed' } })
    for (let i = 0; i < 5; i++) await verify(req('/api/mfa/verify', { factorId: 'factor-1', code: '000000' }))
    challengeAndVerify.mockClear()
    expect((await verify(req('/api/mfa/verify', { factorId: 'factor-1', code: '123456' }))).status).toBe(429)
    expect(challengeAndVerify).not.toHaveBeenCalled()
  })

  it('no session: 401', async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    expect((await verify(req('/api/mfa/verify', { factorId: 'factor-1', code: '123456' }))).status).toBe(401)
  })

  it('a code that is not 6 digits is 400, and nothing reaches Supabase', async () => {
    expect((await verify(req('/api/mfa/verify', { factorId: 'factor-1', code: '12ab' }))).status).toBe(400)
    expect(challengeAndVerify).not.toHaveBeenCalled()
  })
})
