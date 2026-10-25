/**
 * @jest-environment node
 *
 * B11 (technical-safeguards-evidence-2026-10-25.md): password reset and
 * change, with Supabase Auth's own email. No network: Supabase is mocked.
 *
 *   POST /api/auth/password-reset { email }  public. Sends Supabase's reset
 *     email with a link back to /auth/callback?next=/reset-password. The
 *     same answer whether or not the email has an account. Rate limited.
 *   POST /api/auth/password { password }  the signed-in (recovery) session
 *     sets a new password under the policy, then every session is signed
 *     out, so the person signs in again.
 *   POST /api/auth/password/change { currentPassword, newPassword }
 *     Settings > Account: the current password is checked, the new one
 *     must meet the policy and differ, then other sessions are signed out.
 */

import { NextRequest } from 'next/server'

const resetMock = jest.fn()
const getUserMock = jest.fn()
const updateUserMock = jest.fn()
const signOutMock = jest.fn()
const verifySignInMock = jest.fn()
const verifySignOutMock = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  createRouteHandlerClient: jest.fn(async () => ({
    auth: {
      resetPasswordForEmail: (...a: unknown[]) => resetMock(...a),
      getUser: () => getUserMock(),
      updateUser: (...a: unknown[]) => updateUserMock(...a),
      signOut: (...a: unknown[]) => signOutMock(...a),
    },
  })),
}))
jest.mock('@/lib/supabase/password-check', () => ({
  createPasswordCheckClient: () => ({
    auth: {
      signInWithPassword: (...a: unknown[]) => verifySignInMock(...a),
      signOut: (...a: unknown[]) => verifySignOutMock(...a),
    },
  }),
}))
jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }))

import { POST as RESET } from '../password-reset/route'
import { POST as SET } from '../password/route'
import { POST as CHANGE } from '../password/change/route'
import { passwordLimiters } from '@/lib/auth/password-rate-limit'
import { COMMON_PASSWORD_MESSAGE } from '@/lib/auth/password-policy'

const EMAIL = 'provider@clinic.test'
const NEW = 'violet harbor 42 lantern'
const CURRENT = 'the old password 2026'

function req(url: string, body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(new URL(`http://localhost${url}`), {
    method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7', ...headers },
  })
}

beforeEach(() => {
  process.env['APP_BASE_URL'] = 'https://app.compoundiq.test'
  for (const m of [resetMock, getUserMock, updateUserMock, signOutMock, verifySignInMock, verifySignOutMock]) m.mockReset()
  passwordLimiters.resetByIp.reset()
  passwordLimiters.resetByEmail.reset()
  passwordLimiters.changeByUser.reset()
  resetMock.mockResolvedValue({ data: {}, error: null })
  getUserMock.mockResolvedValue({ data: { user: { id: 'u-1', email: EMAIL } }, error: null })
  updateUserMock.mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null })
  signOutMock.mockResolvedValue({ error: null })
  verifySignInMock.mockResolvedValue({ data: { session: {} }, error: null })
  verifySignOutMock.mockResolvedValue({ error: null })
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('POST /api/auth/password-reset', () => {
  const SENT = 'If an account uses that email, we sent it a link to set a new password. The link works once.'

  it('asks Supabase to email the reset link, back to /auth/callback then /reset-password', async () => {
    const res = await RESET(req('/api/auth/password-reset', { email: '  Provider@Clinic.TEST ' }))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ message: SENT })
    expect(resetMock).toHaveBeenCalledWith(EMAIL, { redirectTo: 'https://app.compoundiq.test/auth/callback?next=/reset-password' })
  })

  it('answers the same when Supabase refuses (no account, or an email error): nothing is revealed', async () => {
    resetMock.mockResolvedValue({ data: null, error: { message: 'User not found', code: 'user_not_found' } })
    const res = await RESET(req('/api/auth/password-reset', { email: 'nobody@clinic.test' }))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ message: SENT })
  })

  it('400 for a bad email or body; cross-site refused before anything', async () => {
    expect((await RESET(req('/api/auth/password-reset', { email: 'nope' }))).status).toBe(400)
    expect((await RESET(req('/api/auth/password-reset', '{'))).status).toBe(400)
    expect((await RESET(req('/api/auth/password-reset', { email: EMAIL }, { 'sec-fetch-site': 'cross-site' }))).status).toBe(403)
    expect(resetMock).not.toHaveBeenCalled()
  })

  it('rate limited per address and per network', async () => {
    for (let i = 0; i < 3; i++) expect((await RESET(req('/api/auth/password-reset', { email: EMAIL }))).status).toBe(200)
    const limited = await RESET(req('/api/auth/password-reset', { email: EMAIL }))
    expect(limited.status).toBe(429)
    await expect(limited.json()).resolves.toEqual({ error: 'Too many reset requests. Wait a few minutes, then try again.' })
    expect(resetMock).toHaveBeenCalledTimes(3)
    // Other addresses from the same network: 5 in 15 minutes in all.
    expect((await RESET(req('/api/auth/password-reset', { email: 'a@clinic.test' }))).status).toBe(200)
    expect((await RESET(req('/api/auth/password-reset', { email: 'b@clinic.test' }))).status).toBe(200)
    expect((await RESET(req('/api/auth/password-reset', { email: 'c@clinic.test' }))).status).toBe(429)
  })
})

describe('POST /api/auth/password (set a new password from the reset link)', () => {
  it('sets it, then signs out every session so the person signs in again', async () => {
    const res = await SET(req('/api/auth/password', { password: NEW }))
    expect(res.status).toBe(200)
    expect(updateUserMock).toHaveBeenCalledWith({ password: NEW })
    expect(signOutMock).toHaveBeenCalledWith({ scope: 'global' })
  })

  it('applies the policy: too short, common, or the email address', async () => {
    expect(await (await SET(req('/api/auth/password', { password: 'short' }))).json()).toEqual({ error: 'Use at least 12 characters.' })
    expect(await (await SET(req('/api/auth/password', { password: 'Password1234' }))).json()).toEqual({ error: COMMON_PASSWORD_MESSAGE })
    const mail = await SET(req('/api/auth/password', { password: EMAIL }))
    expect(mail.status).toBe(400)
    expect(updateUserMock).not.toHaveBeenCalled()
  })

  it('401 when the reset link has expired (no session)', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const res = await SET(req('/api/auth/password', { password: NEW }))
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toEqual({ error: 'Your reset link has expired or was already used. Request a new one.' })
  })

  it('Supabase refusing a reused or leaked password is a 400 with a plain message', async () => {
    updateUserMock.mockResolvedValue({ data: null, error: { code: 'same_password', message: 'New password should be different' } })
    expect(await (await SET(req('/api/auth/password', { password: NEW }))).json())
      .toEqual({ error: 'Choose a password you have not used for this account before.' })
    updateUserMock.mockResolvedValue({ data: null, error: { code: 'weak_password', message: 'Password is known to be weak' } })
    expect(await (await SET(req('/api/auth/password', { password: NEW }))).json())
      .toEqual({ error: 'That password is not allowed. Choose a different one.' })
    expect(signOutMock).not.toHaveBeenCalled()
  })

  it('cross-site refused', async () => {
    expect((await SET(req('/api/auth/password', { password: NEW }, { 'sec-fetch-site': 'cross-site' }))).status).toBe(403)
  })
})

describe('POST /api/auth/password/change (Settings > Account)', () => {
  const body = { currentPassword: CURRENT, newPassword: NEW }

  it('checks the current password, sets the new one, signs out the other sessions', async () => {
    const res = await CHANGE(req('/api/auth/password/change', body))
    expect(res.status).toBe(200)
    expect(verifySignInMock).toHaveBeenCalledWith({ email: EMAIL, password: CURRENT })
    // The check's own session is ended at once.
    expect(verifySignOutMock).toHaveBeenCalledWith({ scope: 'local' })
    expect(updateUserMock).toHaveBeenCalledWith({ password: NEW })
    expect(signOutMock).toHaveBeenCalledWith({ scope: 'others' })
  })

  it('a wrong current password is a 400 and nothing changes', async () => {
    verifySignInMock.mockResolvedValue({ data: { session: null }, error: { message: 'Invalid login credentials' } })
    const res = await CHANGE(req('/api/auth/password/change', body))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'Your current password is not right.' })
    expect(updateUserMock).not.toHaveBeenCalled()
  })

  it('the new password must differ from the current one and meet the policy', async () => {
    expect(await (await CHANGE(req('/api/auth/password/change', { currentPassword: CURRENT, newPassword: CURRENT }))).json())
      .toEqual({ error: 'Choose a new password that is different from your current one.' })
    expect(await (await CHANGE(req('/api/auth/password/change', { currentPassword: CURRENT, newPassword: 'qwerty123456' }))).json())
      .toEqual({ error: COMMON_PASSWORD_MESSAGE })
    expect(updateUserMock).not.toHaveBeenCalled()
  })

  it('401 signed out; 400 for a bad body; rate limited per user; cross-site refused', async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: null }, error: null })
    expect((await CHANGE(req('/api/auth/password/change', body))).status).toBe(401)
    expect((await CHANGE(req('/api/auth/password/change', { currentPassword: CURRENT }))).status).toBe(400)
    verifySignInMock.mockResolvedValue({ data: { session: null }, error: { message: 'Invalid login credentials' } })
    for (let i = 0; i < 5; i++) await CHANGE(req('/api/auth/password/change', body))
    const limited = await CHANGE(req('/api/auth/password/change', body))
    expect(limited.status).toBe(429)
    expect((await CHANGE(req('/api/auth/password/change', body, { 'sec-fetch-site': 'cross-site' }))).status).toBe(403)
  })
})
