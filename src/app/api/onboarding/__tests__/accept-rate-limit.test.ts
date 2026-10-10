/**
 * @jest-environment node
 *
 * POST /api/onboarding/invite/accept is public (the token is the
 * credential), so it is rate limited by client IP (the first
 * x-forwarded-for entry): 10 attempts per 15 minutes, then 429 with a
 * plain message and Retry-After. Another IP is unaffected, so a real
 * invitee is never blocked by someone else's failed guesses. The token is
 * never logged; a refusal logs only the IP hash and the outcome.
 */

import { NextRequest } from 'next/server'
import { scriptedDb } from '@/__tests__/helpers/scripted-db'

const createUser = jest.fn().mockResolvedValue({ data: { user: { id: 'new-user' } }, error: null })
let db = scriptedDb(() => undefined)

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => Object.assign(db.client as object, { auth: { admin: { createUser, deleteUser: jest.fn() } } }),
}))

import { POST } from '../invite/accept/route'
import { inviteAcceptLimiter } from '@/lib/onboarding/accept-rate-limit'

const TOKEN = 'tok_abcdefghijklmnopqrstuvwxyz0123456789ABCDEF'
const GOOD = { token: TOKEN, fullName: 'Lauren Perkins', password: 'Correct-Horse-9' }
const WINDOW_MS = 15 * 60 * 1000

const req = (ip: string, body: unknown = GOOD) => new NextRequest('http://localhost/api/onboarding/invite/accept', {
  method: 'POST', body: JSON.stringify(body), headers: { 'x-forwarded-for': `${ip}, 10.0.0.1` },
})

/** An unknown token: the route answers 404 (a failed guess). */
const unknownToken = () => scriptedDb(c => (c.table === 'onboarding_invites' ? { data: null } : undefined))

/** A valid invite that accepts. */
const validInvite = () => scriptedDb(c => {
  if (c.table === 'onboarding_invites' && c.op === 'select') {
    return { data: { invite_id: 'i-1', kind: 'clinic_admin', clinic_id: 'c-1', email: 'a@b.test', provider_id: null, accepted_at: null, revoked_at: null, expires_at: '2999-01-01T00:00:00Z' } }
  }
  if (c.table === 'onboarding_invites' && c.op === 'update') return { data: [{ invite_id: 'i-1' }] }
  return undefined
})

beforeEach(() => {
  inviteAcceptLimiter.reset()
  db = unknownToken()
  jest.useFakeTimers({ now: new Date('2026-10-10T12:00:00Z') })
  process.env['PHI_ACCESS_LOG_HASH_SECRET'] = 'test-secret'
  for (const l of ['info', 'warn', 'error'] as const) jest.spyOn(console, l).mockImplementation(() => {})
})
afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
  delete process.env['PHI_ACCESS_LOG_HASH_SECRET']
})

it('under the limit, it works (10 attempts are answered normally)', async () => {
  for (let i = 0; i < 10; i++) expect((await POST(req('203.0.113.7'))).status).toBe(404)
})

it('over the limit, it returns 429 with a plain message and Retry-After', async () => {
  for (let i = 0; i < 10; i++) await POST(req('203.0.113.7'))
  const res = await POST(req('203.0.113.7'))
  expect(res.status).toBe(429)
  expect(await res.json()).toEqual({ error: 'Too many attempts. Wait a few minutes, then try again.' })
  expect(res.headers.get('Retry-After')).toBe(String(15 * 60))
})

it('a refused attempt never reaches the database', async () => {
  for (let i = 0; i < 10; i++) await POST(req('203.0.113.7'))
  const before = db.calls.length
  await POST(req('203.0.113.7'))
  expect(db.calls.length).toBe(before)
})

it('after the window, it resets', async () => {
  for (let i = 0; i < 11; i++) await POST(req('203.0.113.7'))
  jest.setSystemTime(Date.now() + WINDOW_MS)
  expect((await POST(req('203.0.113.7'))).status).toBe(404)
})

it('a different IP is unaffected: its valid invite is accepted', async () => {
  for (let i = 0; i < 11; i++) await POST(req('203.0.113.7'))
  db = validInvite()
  expect((await POST(req('198.51.100.20'))).status).toBe(201)
})

it('limits by the first x-forwarded-for entry (the client), not the proxy', async () => {
  for (let i = 0; i < 10; i++) await POST(req('203.0.113.7'))
  // Same proxy (10.0.0.1), different client: unaffected.
  expect((await POST(req('203.0.113.8'))).status).toBe(404)
})

it('never logs the token or the raw IP: only the IP hash and the outcome', async () => {
  for (let i = 0; i < 11; i++) await POST(req('203.0.113.7'))
  const logged = JSON.stringify([
    (console.info as jest.Mock).mock.calls, (console.warn as jest.Mock).mock.calls, (console.error as jest.Mock).mock.calls,
  ])
  expect(logged).not.toContain(TOKEN)
  expect(logged).not.toContain('203.0.113.7')
  expect(console.warn).toHaveBeenCalledWith(expect.stringMatching(/^\[onboarding\/accept\] rate_limited \| ip_hash=[0-9a-f]{64}$/))
})
