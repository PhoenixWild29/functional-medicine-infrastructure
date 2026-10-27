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
const getClaimsMock = jest.fn()
const updateUserMock = jest.fn()
const signOutMock = jest.fn()
const verifySignInMock = jest.fn()
const verifySignOutMock = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  createRouteHandlerClient: jest.fn(async () => ({
    auth: {
      resetPasswordForEmail: (...a: unknown[]) => resetMock(...a),
      getUser: () => getUserMock(),
      getClaims: () => getClaimsMock(),
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
import { passwordLimiters, RESET_MIN_RESPONSE_MS } from '@/lib/auth/password-rate-limit'
import { NOT_RECOVERY_MESSAGE, RECOVERY_MAX_AGE_SECONDS } from '@/lib/auth/recovery-session'
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

/** Access-token claims for user u-1, made `ageSeconds` ago by the given method. */
function recoveryClaims(ageSeconds: number, method = 'recovery') {
  return { sub: 'u-1', amr: [{ method, timestamp: Math.floor(Date.now() / 1000) - ageSeconds }] }
}

beforeEach(() => {
  process.env['APP_BASE_URL'] = 'https://app.compoundiq.test'
  for (const m of [resetMock, getUserMock, getClaimsMock, updateUserMock, signOutMock, verifySignInMock, verifySignOutMock]) m.mockReset()
  for (const limiter of Object.values(passwordLimiters)) limiter.reset()
  resetMock.mockResolvedValue({ data: {}, error: null })
  getUserMock.mockResolvedValue({ data: { user: { id: 'u-1', email: EMAIL } }, error: null })
  // By default the session came from the reset link a minute ago.
  getClaimsMock.mockImplementation(async () => ({ data: { claims: recoveryClaims(60) }, error: null }))
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

  // Every answer after the input check is held to RESET_MIN_RESPONSE_MS
  // (review P3); fake timers (Date included) let the tests run that clock.
  beforeEach(() => { jest.useFakeTimers() })
  afterEach(() => { jest.useRealTimers() })

  /** The route's answer, with the fake clock run past the floor, and when it came (ms after the call). */
  async function reset(body: unknown, headers: Record<string, string> = {}): Promise<{ res: Response; tookMs: number }> {
    const started = Date.now()
    let doneAt = -1
    const pending = RESET(req('/api/auth/password-reset', body, headers)).then(r => { doneAt = Date.now(); return r })
    await jest.advanceTimersByTimeAsync(RESET_MIN_RESPONSE_MS + 2000)
    const res = await pending
    return { res, tookMs: doneAt - started }
  }
  const status = async (body: unknown, headers: Record<string, string> = {}) => (await reset(body, headers)).res.status

  it('asks Supabase to email the reset link, back to /auth/callback then /reset-password', async () => {
    const { res } = await reset({ email: '  Provider@Clinic.TEST ' })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ message: SENT })
    expect(resetMock).toHaveBeenCalledWith(EMAIL, { redirectTo: 'https://app.compoundiq.test/auth/callback?next=/reset-password' })
  })

  it('answers the same when Supabase refuses (no account, or an email error): nothing is revealed', async () => {
    resetMock.mockResolvedValue({ data: null, error: { message: 'User not found', code: 'user_not_found' } })
    const { res } = await reset({ email: 'nobody@clinic.test' })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ message: SENT })
  })

  it('timing (review P3): a known address (Supabase slow) and an unknown one (Supabase at once) answer at the same time', async () => {
    // Known: Supabase writes and emails before answering (here 400 ms).
    resetMock.mockImplementationOnce(() => new Promise(resolve => setTimeout(() => resolve({ data: {}, error: null }), 400)))
    const known = await reset({ email: EMAIL })
    // Unknown: Supabase answers at once.
    resetMock.mockResolvedValueOnce({ data: {}, error: null })
    const unknown = await reset({ email: 'nobody@clinic.test' })
    expect(known.res.status).toBe(unknown.res.status)
    await expect(known.res.json()).resolves.toEqual(await unknown.res.json())
    expect(known.tookMs).toBe(RESET_MIN_RESPONSE_MS)
    expect(unknown.tookMs).toBe(RESET_MIN_RESPONSE_MS)
  })

  it('timing: a rate-limited answer is held to the same floor', async () => {
    for (let i = 0; i < 3; i++) await reset({ email: EMAIL })
    const limited = await reset({ email: EMAIL })
    expect(limited.res.status).toBe(429)
    expect(limited.tookMs).toBe(RESET_MIN_RESPONSE_MS)
  })

  it('a Supabase call slower than the floor is answered when it returns, and logged without the address', async () => {
    resetMock.mockImplementationOnce(() => new Promise(resolve => setTimeout(() => resolve({ data: {}, error: null }), RESET_MIN_RESPONSE_MS + 500)))
    const { res, tookMs } = await reset({ email: EMAIL })
    expect(res.status).toBe(200)
    expect(tookMs).toBe(RESET_MIN_RESPONSE_MS + 500)
    const warned = (console.warn as jest.Mock).mock.calls.flat().join(' ')
    expect(warned).toMatch(/past the 1500 ms floor/)
    expect(warned).not.toContain(EMAIL)
  })

  it('400 for a bad email or body; cross-site refused before anything', async () => {
    expect(await status({ email: 'nope' })).toBe(400)
    expect(await status('{')).toBe(400)
    expect(await status({ email: EMAIL }, { 'sec-fetch-site': 'cross-site' })).toBe(403)
    expect(resetMock).not.toHaveBeenCalled()
  })

  it('rate limited: 3 an hour per address from one network, 5 in 15 minutes per network', async () => {
    for (let i = 0; i < 3; i++) expect(await status({ email: EMAIL })).toBe(200)
    const limited = (await reset({ email: EMAIL })).res
    expect(limited.status).toBe(429)
    await expect(limited.json()).resolves.toEqual({ error: 'Too many reset requests. Wait a few minutes, then try again.' })
    expect(resetMock).toHaveBeenCalledTimes(3)
    // The network has now made 4 requests: one more is allowed, then 429.
    expect(await status({ email: 'a@clinic.test' })).toBe(200)
    expect(await status({ email: 'b@clinic.test' })).toBe(429)
  })

  it('limiter order (review P5): the IP is checked first, so requests refused for the IP never count against the address', async () => {
    const attacker = { 'x-forwarded-for': '198.51.100.9' }
    // The attacker's network uses up its 5 on throwaway addresses...
    for (let i = 0; i < 5; i++) expect(await status({ email: `junk${i}@x.test` }, attacker)).toBe(200)
    // ...then asks for the victim's address many times: all refused for the IP.
    for (let i = 0; i < 10; i++) expect(await status({ email: EMAIL }, attacker)).toBe(429)
    resetMock.mockClear()
    // The victim, from their own network, still gets the email.
    expect(await status({ email: EMAIL }, { 'x-forwarded-for': '203.0.113.50' })).toBe(200)
    expect(resetMock).toHaveBeenCalledWith(EMAIL, expect.anything())
  })

  it('one network cannot lock an address out: after its 3, other networks still reach the address', async () => {
    const attacker = { 'x-forwarded-for': '198.51.100.9' }
    for (let i = 0; i < 3; i++) await reset({ email: EMAIL }, attacker)
    expect(await status({ email: EMAIL }, attacker)).toBe(429)
    expect(await status({ email: EMAIL }, { 'x-forwarded-for': '203.0.113.50' })).toBe(200)
  })

  it('the looser cap per address across networks: 10 an hour', async () => {
    let sent = 0
    for (let n = 0; n < 6; n++) {
      for (let i = 0; i < 2; i++) {
        if (await status({ email: EMAIL }, { 'x-forwarded-for': `192.0.2.${n + 1}` }) === 200) sent++
      }
    }
    expect(sent).toBe(10)
    expect(resetMock).toHaveBeenCalledTimes(10)
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

  // Review P1: only a recovery session (amr 'recovery', within 15 minutes).
  it('403 for an ordinary signed-in session (amr password): no password is set, nothing is signed out', async () => {
    getClaimsMock.mockImplementation(async () => ({ data: { claims: recoveryClaims(30, 'password') }, error: null }))
    const res = await SET(req('/api/auth/password', { password: NEW }))
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ error: NOT_RECOVERY_MESSAGE })
    expect(updateUserMock).not.toHaveBeenCalled()
    expect(signOutMock).not.toHaveBeenCalled()
  })

  it('403 when the reset link was used more than 15 minutes ago', async () => {
    getClaimsMock.mockImplementation(async () => ({ data: { claims: recoveryClaims(RECOVERY_MAX_AGE_SECONDS + 1) }, error: null }))
    expect((await SET(req('/api/auth/password', { password: NEW }))).status).toBe(403)
    getClaimsMock.mockImplementation(async () => ({ data: { claims: recoveryClaims(RECOVERY_MAX_AGE_SECONDS - 5) }, error: null }))
    expect((await SET(req('/api/auth/password', { password: NEW }))).status).toBe(200)
  })

  it('403 for amr as plain strings (no time to check), for claims of another user, and when the claims cannot be read', async () => {
    getClaimsMock.mockImplementation(async () => ({ data: { claims: { sub: 'u-1', amr: ['recovery'] } }, error: null }))
    expect((await SET(req('/api/auth/password', { password: NEW }))).status).toBe(403)
    getClaimsMock.mockImplementation(async () => ({ data: { claims: { ...recoveryClaims(60), sub: 'someone-else' } }, error: null }))
    expect((await SET(req('/api/auth/password', { password: NEW }))).status).toBe(403)
    getClaimsMock.mockImplementation(async () => ({ data: null, error: { message: 'invalid JWT' } }))
    expect((await SET(req('/api/auth/password', { password: NEW }))).status).toBe(403)
    expect(updateUserMock).not.toHaveBeenCalled()
  })

  it('a recovery session that also passed MFA (amr totp + recovery) is accepted', async () => {
    const now = Math.floor(Date.now() / 1000)
    getClaimsMock.mockImplementation(async () => ({ data: { claims: { sub: 'u-1', amr: [{ method: 'totp', timestamp: now - 10 }, { method: 'recovery', timestamp: now - 40 }] } }, error: null }))
    expect((await SET(req('/api/auth/password', { password: NEW }))).status).toBe(200)
  })

  it('rate limited: 5 attempts per 15 minutes per user, then 429 before Supabase is asked', async () => {
    updateUserMock.mockResolvedValue({ data: null, error: { code: 'same_password', message: 'New password should be different' } })
    for (let i = 0; i < 5; i++) expect((await SET(req('/api/auth/password', { password: NEW }))).status).toBe(400)
    updateUserMock.mockClear()
    const limited = await SET(req('/api/auth/password', { password: NEW }))
    expect(limited.status).toBe(429)
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(updateUserMock).not.toHaveBeenCalled()
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
