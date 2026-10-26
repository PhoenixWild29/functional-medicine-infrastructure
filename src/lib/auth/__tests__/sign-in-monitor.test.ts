/**
 * @jest-environment node
 *
 * Security B12: failed sign-in and MFA challenge monitoring. Each failure
 * is recorded (email as its keyed hash, IP, user agent, time, reason),
 * the alert rules fire once at their thresholds (5 per account and 20 per
 * IP in 15 minutes, any failure on an ops or pharmacy admin), the Slack
 * payload carries no email, no IP and nothing patient-related, and the
 * throttle refuses attempts after repeated failures for a short window.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  ACCOUNT_ALERT_AT, AUTH_FAILURE, AUTH_FAILURE_ALERT, IP_ALERT_AT, THROTTLE_WINDOW_MS,
  alertRules, buildAuthAlert, createSignInThrottle, listSignInAlerts, privilegedRoleFor,
  reasonCode, recordSignInFailure, resetPrivilegedCache, throttledMessage,
} from '../sign-in-monitor'
import { isMfaExemptPath } from '../mfa'

const EMAIL = 'Jane.Doe@Clinic.test'
const IP = '203.0.113.45'
const UA = 'Mozilla/5.0 (test)'

const savedSecret = process.env['PHI_ACCESS_LOG_HASH_SECRET']
beforeEach(() => { process.env['PHI_ACCESS_LOG_HASH_SECRET'] = 'test-audit-secret' })
afterAll(() => { if (savedSecret === undefined) delete process.env['PHI_ACCESS_LOG_HASH_SECRET']; else process.env['PHI_ACCESS_LOG_HASH_SECRET'] = savedSecret })

/** ops_alert_queue: records inserts; a count filtered by account or IP answers the given number. */
function fakeSvc(opts: { accountCount?: number; ipCount?: number; insertError?: boolean; countError?: boolean } = {}) {
  const inserts: Array<Record<string, unknown>> = []
  const filters: string[] = []
  const from = jest.fn(() => {
    let field = ''
    const q: Record<string, unknown> = {}
    q['insert'] = jest.fn(async (row: Record<string, unknown>) => { inserts.push(row); return { error: opts.insertError ? { code: '42501' } : null } })
    q['select'] = () => q
    q['eq'] = () => q
    q['gte'] = () => q
    q['filter'] = (col: string) => { field = col; filters.push(col); return q }
    q['then'] = (resolve: (v: unknown) => void) => resolve(opts.countError
      ? { count: null, error: { code: 'XX000' } }
      : { count: field === 'metadata->>email_hash' ? (opts.accountCount ?? 1) : (opts.ipCount ?? 1), error: null })
    return q
  })
  return { svc: { from } as unknown as SupabaseClient, inserts, filters }
}

const failure = (over: Partial<Parameters<typeof recordSignInFailure>[1]> = {}) => ({
  step: 'password' as const, email: EMAIL, reason: 'invalid_credentials', ip: IP, userAgent: UA, ...over,
})

describe('recording a failure', () => {
  it('writes a record-only row: the email as its keyed hash, the IP, the user agent, the time, the reason', async () => {
    const { svc, inserts } = fakeSvc()
    const now = new Date('2026-10-25T12:00:00.000Z')
    await recordSignInFailure(svc, failure(), { send: jest.fn(), roleForEmail: async () => null, now: () => now })
    expect(inserts).toHaveLength(1)
    const row = inserts[0]!
    expect(row['alert_type']).toBe(AUTH_FAILURE)
    expect(row['severity']).toBe('info')
    // Record only: sent_at is set, so the queue flush never posts it.
    expect(row['sent_at']).toBe(now.toISOString())
    const m = row['metadata'] as Record<string, unknown>
    expect(m['step']).toBe('password')
    expect(m['reason']).toBe('invalid_credentials')
    expect(m['email_hash']).toMatch(/^[0-9a-f]{64}$/)
    expect(m['ip']).toBe(IP)
    expect(m['user_agent']).toBe(UA)
    // The raw email is nowhere in what is written (any case).
    expect(JSON.stringify(row).toLowerCase()).not.toContain('jane.doe')
  })

  it('the same email in another case hashes the same (counts one account)', async () => {
    const a = fakeSvc(); const b = fakeSvc()
    await recordSignInFailure(a.svc, failure({ email: EMAIL }), { send: jest.fn(), roleForEmail: async () => null })
    await recordSignInFailure(b.svc, failure({ email: '  jane.doe@clinic.TEST ' }), { send: jest.fn(), roleForEmail: async () => null })
    const hash = (r: Record<string, unknown>) => (r['metadata'] as Record<string, unknown>)['email_hash']
    expect(hash(a.inserts[0]!)).toBe(hash(b.inserts[0]!))
  })

  it('an MFA failure keeps the user id and role', async () => {
    const { svc, inserts } = fakeSvc()
    await recordSignInFailure(svc, failure({ step: 'mfa', userId: 'user-1', role: 'clinic_admin', reason: 'mfa_verification_failed' }), { send: jest.fn() })
    const m = inserts[0]!['metadata'] as Record<string, unknown>
    expect(m).toMatchObject({ step: 'mfa', user_id: 'user-1', role: 'clinic_admin', reason: 'mfa_verification_failed' })
  })

  it('counts the account by its email hash and the IP over the alert window', async () => {
    const { svc, filters } = fakeSvc()
    await recordSignInFailure(svc, failure(), { send: jest.fn(), roleForEmail: async () => null })
    expect(filters.sort()).toEqual(['metadata->>email_hash', 'metadata->>ip'])
  })

  it('never throws: a database or lookup error leaves the sign-in answer alone', async () => {
    const { svc } = fakeSvc({ insertError: true, countError: true })
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    await expect(recordSignInFailure(svc, failure(), { send: jest.fn(), roleForEmail: async () => { throw new Error('boom') } }))
      .resolves.toEqual({ alerts: [] })
    spy.mockRestore()
  })
})

describe('alert rules', () => {
  it('the account rule fires once, at 5 failures in the window', () => {
    expect(alertRules({ accountCount: ACCOUNT_ALERT_AT - 1, ipCount: 1, privileged: false })).toEqual([])
    expect(alertRules({ accountCount: ACCOUNT_ALERT_AT, ipCount: 1, privileged: false })).toEqual(['account'])
    expect(alertRules({ accountCount: ACCOUNT_ALERT_AT + 1, ipCount: 1, privileged: false })).toEqual([])
  })

  it('the IP rule fires once, at 20 failures in the window', () => {
    expect(alertRules({ accountCount: 1, ipCount: IP_ALERT_AT - 1, privileged: false })).toEqual([])
    expect(alertRules({ accountCount: 1, ipCount: IP_ALERT_AT, privileged: false })).toEqual(['ip'])
    expect(alertRules({ accountCount: 1, ipCount: IP_ALERT_AT + 1, privileged: false })).toEqual([])
  })

  it('every failure on an admin account alerts, until the account rule covers it', () => {
    for (let n = 1; n < ACCOUNT_ALERT_AT; n++) expect(alertRules({ accountCount: n, ipCount: n, privileged: true })).toEqual(['privileged'])
    expect(alertRules({ accountCount: ACCOUNT_ALERT_AT, ipCount: 1, privileged: true })).toEqual(['account'])
  })

  it('both rules can fire on one failure', () => {
    expect(alertRules({ accountCount: ACCOUNT_ALERT_AT, ipCount: IP_ALERT_AT, privileged: false })).toEqual(['account', 'ip'])
  })
})

describe('alerting', () => {
  it('the fifth failure on an account sends one Slack alert and writes an alert row', async () => {
    const { svc, inserts } = fakeSvc({ accountCount: 5, ipCount: 5 })
    const send = jest.fn().mockResolvedValue(undefined)
    const r = await recordSignInFailure(svc, failure(), { send, roleForEmail: async () => null })
    expect(r.alerts).toEqual(['account'])
    expect(send).toHaveBeenCalledTimes(1)
    const alertRow = inserts.find(i => i['alert_type'] === AUTH_FAILURE_ALERT)!
    expect(alertRow['severity']).toBe('warning')
    expect(alertRow['sent_at']).toEqual(expect.any(String))
    expect(alertRow['metadata']).toMatchObject({ rule: 'account', count: 5, ip: IP })
  })

  it('a failed sign-in on an ops_admin or pharmacy_admin account alerts at once (critical)', async () => {
    for (const role of ['ops_admin', 'pharmacy_admin']) {
      const { svc, inserts } = fakeSvc({ accountCount: 1, ipCount: 1 })
      const send = jest.fn().mockResolvedValue(undefined)
      const r = await recordSignInFailure(svc, failure(), { send, roleForEmail: async () => role })
      expect(r.alerts).toEqual(['privileged'])
      expect(inserts.find(i => i['alert_type'] === AUTH_FAILURE_ALERT)!['severity']).toBe('critical')
    }
  })

  it('a clinic account below the thresholds sends nothing', async () => {
    const { svc } = fakeSvc({ accountCount: 2, ipCount: 2 })
    const send = jest.fn()
    expect((await recordSignInFailure(svc, failure(), { send, roleForEmail: async () => null })).alerts).toEqual([])
    expect(send).not.toHaveBeenCalled()
  })

  it('when Slack fails the alert row stays unsent, so the queue flush retries it', async () => {
    const { svc, inserts } = fakeSvc({ accountCount: 1, ipCount: 20 })
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    await recordSignInFailure(svc, failure(), { send: jest.fn().mockRejectedValue(new Error('slack down')), roleForEmail: async () => null })
    spy.mockRestore()
    expect(inserts.find(i => i['alert_type'] === AUTH_FAILURE_ALERT)!['sent_at']).toBeNull()
  })

  it('the Slack payload carries no email, no IP and no user agent: codes, counts, the role and hash prefixes only', async () => {
    const { svc } = fakeSvc({ accountCount: 5, ipCount: 20 })
    const send = jest.fn().mockResolvedValue(undefined)
    await recordSignInFailure(svc, failure({ role: 'ops_admin' }), { send })
    expect(send).toHaveBeenCalledTimes(2)
    for (const [payload] of send.mock.calls) {
      const text = JSON.stringify(payload)
      expect(text.toLowerCase()).not.toContain('jane.doe')
      expect(text).not.toContain('@')
      expect(text).not.toContain(IP)
      expect(text).not.toContain('Mozilla')
      // A keyed-hash prefix (12 hex), never the full 64.
      expect(text).not.toMatch(/[0-9a-f]{64}/)
      expect(text).toMatch(/acct:[0-9a-f]{12}|ip:[0-9a-f]{12}/)
      expect(text).toContain('ops_admin')
    }
  })

  it('buildAuthAlert drops free text passed as a reason', () => {
    const payload = buildAuthAlert('account', { step: 'password', reason: 'jane@clinic.test said hi', count: 5, role: null, emailHash: 'a'.repeat(64), ipHash: null })
    expect(JSON.stringify(payload)).not.toContain('jane@clinic.test')
  })

  it('reasonCode keeps a Supabase code and replaces anything else', () => {
    expect(reasonCode('invalid_credentials')).toBe('invalid_credentials')
    expect(reasonCode('Invalid login credentials')).toBe('unknown')
    expect(reasonCode(undefined)).toBe('unknown')
  })
})

describe('the privileged account lookup (a failed password sign-in has no user)', () => {
  beforeEach(() => resetPrivilegedCache())

  it('finds ops and pharmacy admins by email, case-insensitively, and caches the list', async () => {
    const listUsers = jest.fn().mockResolvedValue({ data: { users: [
      { email: 'ops@x.test', app_metadata: { app_role: 'ops_admin' } },
      { email: 'Ph@x.test', app_metadata: { app_role: 'pharmacy_admin' } },
      { email: 'dr@x.test', app_metadata: { app_role: 'provider' } },
    ] }, error: null })
    const svc = { auth: { admin: { listUsers } } } as unknown as SupabaseClient
    expect(await privilegedRoleFor(svc, 'OPS@x.test', 0)).toBe('ops_admin')
    expect(await privilegedRoleFor(svc, 'ph@x.test', 1)).toBe('pharmacy_admin')
    expect(await privilegedRoleFor(svc, 'dr@x.test', 2)).toBeNull()
    expect(await privilegedRoleFor(svc, 'nobody@x.test', 3)).toBeNull()
    expect(listUsers).toHaveBeenCalledTimes(1)
    await privilegedRoleFor(svc, 'ops@x.test', 11 * 60_000)
    expect(listUsers).toHaveBeenCalledTimes(2)
  })
})

describe('throttle (a short delay, never a lock-out)', () => {
  it('after 5 failures for one account, attempts are refused for the rest of the 5-minute window, then allowed', () => {
    let t = 0
    const throttle = createSignInThrottle(() => t)
    const keys = { account: 'password:jane@clinic.test', ip: IP }
    for (let i = 0; i < 4; i++) { expect(throttle.peek(keys).allowed).toBe(true); throttle.fail(keys) }
    expect(throttle.peek(keys).allowed).toBe(true)
    throttle.fail(keys)
    const refused = throttle.peek(keys)
    expect(refused.allowed).toBe(false)
    expect(refused.retryAfterSeconds).toBe(THROTTLE_WINDOW_MS / 1000)
    // Peeking does not count.
    for (let i = 0; i < 10; i++) throttle.peek(keys)
    t = THROTTLE_WINDOW_MS
    expect(throttle.peek(keys).allowed).toBe(true)
  })

  it('another account on the same IP is not held up by one account\'s failures', () => {
    const throttle = createSignInThrottle(() => 0)
    for (let i = 0; i < 5; i++) throttle.fail({ account: 'password:a@x.test', ip: IP })
    expect(throttle.peek({ account: 'password:b@x.test', ip: IP }).allowed).toBe(true)
  })

  it('20 failures from one IP refuse every account from it', () => {
    const throttle = createSignInThrottle(() => 0)
    for (let i = 0; i < 20; i++) throttle.fail({ account: `password:u${i}@x.test`, ip: IP })
    expect(throttle.peek({ account: 'password:new@x.test', ip: IP }).allowed).toBe(false)
    expect(throttle.peek({ account: 'password:new@x.test', ip: '198.51.100.1' }).allowed).toBe(true)
  })

  it('the message says how long to wait, in plain words', () => {
    expect(throttledMessage(300)).toBe('Too many attempts. Wait 5 minutes and try again.')
    expect(throttledMessage(20)).toBe('Too many attempts. Wait 1 minute and try again.')
    expect(throttledMessage(300)).not.toMatch(/—/)
  })
})

describe('the Ops Security list', () => {
  it('maps alert rows to the hash prefix and the IP, newest first as read', async () => {
    const alerts = { data: [{ alert_id: 'a1', created_at: '2026-10-25T12:00:00Z', sent_at: null, metadata: { rule: 'ip', step: 'password', reason: 'invalid_credentials', count: 20, role: null, email_hash: 'b'.repeat(64), ip: IP } }], error: null }
    const failures = { count: 37, error: null }
    let call = 0
    const chain = (result: unknown) => { const q: Record<string, unknown> = {}; for (const k of ['select', 'eq', 'gte', 'order']) q[k] = () => q; q['limit'] = async () => result; q['then'] = (r: (v: unknown) => void) => r(result); return q }
    const svc = { from: () => chain(call++ === 0 ? alerts : failures) } as unknown as SupabaseClient
    const r = await listSignInAlerts(svc, new Date('2026-10-25T13:00:00Z'))
    expect(r).toEqual({ ok: true, failures24h: 37, alerts: [{ alertId: 'a1', createdAt: '2026-10-25T12:00:00Z', rule: 'ip', step: 'password', reason: 'invalid_credentials', count: 20, role: null, accountRef: 'b'.repeat(12), ip: IP, sent: false }] })
  })
})

describe('the MFA verify API is reachable at AAL1', () => {
  it('isMfaExemptPath covers /api/mfa/verify', () => {
    expect(isMfaExemptPath('/api/mfa/verify')).toBe(true)
    expect(isMfaExemptPath('/api/orders')).toBe(false)
  })
})
