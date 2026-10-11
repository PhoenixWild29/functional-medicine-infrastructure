/**
 * @jest-environment node
 *
 * POST /api/onboard/pharmacy/<token> creates an account from an invite
 * token with no session, so it is rate limited by client IP (the first
 * x-forwarded-for value): 10 attempts per 15 minutes, then 429 with
 * Retry-After. A limited request never reaches the invite lookup, and the
 * token is never logged.
 */

import { NextRequest } from 'next/server'

jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({}) }))
jest.mock('@/lib/pharmacy-onboarding/invites', () => ({
  inviteForToken: jest.fn(async () => null),
  acceptInvite: jest.fn(async () => ({ ok: true, email: 'd@s.example' })),
}))

import * as onboard from '@/app/api/onboard/pharmacy/[token]/route'
import {
  ACCEPT_LIMIT, ACCEPT_WINDOW_MS, clientIp, createMemoryRateLimiter,
} from '@/lib/pharmacy-onboarding/accept-rate-limit'

const invites = jest.requireMock('@/lib/pharmacy-onboarding/invites') as { acceptInvite: jest.Mock }

const TOKEN = 'secret-invite-token-0123456789abcdef'
const params = { params: Promise.resolve({ token: TOKEN }) }
let ipSeq = 0
const freshIp = () => `203.0.113.${++ipSeq}`
const post = (xff: string | null) =>
  onboard.POST(new NextRequest(new URL('https://app.example/api/onboard/pharmacy/x'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(xff !== null ? { 'x-forwarded-for': xff } : {}) },
    body: JSON.stringify({ fullName: 'Dana', password: 'x' }),
  }), params)

const logs: string[] = []
beforeEach(() => {
  logs.length = 0
  invites.acceptInvite.mockClear().mockResolvedValue({ ok: true, email: 'd@s.example' })
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    jest.spyOn(console, level).mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(' ')) })
  }
})
afterEach(() => jest.restoreAllMocks())

describe('the limiter', () => {
  it('10 attempts per 15 minutes', () => {
    expect(ACCEPT_LIMIT).toBe(10)
    expect(ACCEPT_WINDOW_MS).toBe(15 * 60_000)
  })

  it('allows the limit, refuses the next with the seconds left, and opens again after the window', async () => {
    const limiter = createMemoryRateLimiter({ limit: 3, windowMs: 60_000 })
    const t0 = 1_000_000
    for (let i = 0; i < 3; i++) expect(await limiter.hit('a', t0 + i)).toEqual({ ok: true })
    expect(await limiter.hit('a', t0 + 20_000)).toEqual({ ok: false, retryAfterSeconds: 40 })
    expect(await limiter.hit('b', t0 + 20_000)).toEqual({ ok: true })
    expect(await limiter.hit('a', t0 + 60_000)).toEqual({ ok: true })
  })

  it('stays bounded in memory', async () => {
    const limiter = createMemoryRateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 100 })
    for (let i = 0; i < 1_000; i++) await limiter.hit(`k${i}`, 1_000)
    expect(limiter.size()).toBeLessThanOrEqual(100)
  })
})

describe('clientIp', () => {
  const h = (v: Record<string, string>) => new Headers(v)
  it('is the first x-forwarded-for value, trimmed', () => {
    expect(clientIp(h({ 'x-forwarded-for': ' 198.51.100.7 , 10.0.0.1, 10.0.0.2' }))).toBe('198.51.100.7')
  })
  it('with no x-forwarded-for, one shared "unknown" key', () => {
    expect(clientIp(h({}))).toBe('unknown')
    expect(clientIp(h({ 'x-forwarded-for': ' , ' }))).toBe('unknown')
  })
})

describe('POST /api/onboard/pharmacy/<token>', () => {
  it('the 11th attempt from one IP in 15 minutes is 429 with Retry-After, and never reaches the invite', async () => {
    const ip = freshIp()
    for (let i = 0; i < 10; i++) expect((await post(ip)).status).toBe(200)
    expect(invites.acceptInvite).toHaveBeenCalledTimes(10)

    const limited = await post(ip)
    expect(limited.status).toBe(429)
    const retryAfter = Number(limited.headers.get('retry-after'))
    expect(Number.isInteger(retryAfter)).toBe(true)
    expect(retryAfter).toBeGreaterThan(0)
    expect(retryAfter).toBeLessThanOrEqual(15 * 60)
    expect(await limited.json()).toEqual({ error: expect.stringMatching(/too many/i) })
    expect(invites.acceptInvite).toHaveBeenCalledTimes(10)
  })

  it('the bucket is the first x-forwarded-for value: proxies appended after it do not change it', async () => {
    const ip = freshIp()
    for (let i = 0; i < 10; i++) await post(`${ip}, 10.0.0.${i}`)
    expect((await post(`${ip}, 10.9.9.9`)).status).toBe(429)
  })

  it('another IP is not affected', async () => {
    const ip = freshIp()
    for (let i = 0; i < 11; i++) await post(ip)
    expect((await post(freshIp())).status).toBe(200)
  })

  it('the token is never logged: not when limited, not when the accept fails', async () => {
    const ip = freshIp()
    invites.acceptInvite.mockResolvedValue({ ok: false, status: 503, error: 'Your account could not be created. Try again.' })
    for (let i = 0; i < 12; i++) await post(ip)
    expect(logs.length).toBeGreaterThan(0)
    for (const line of logs) expect(line).not.toContain(TOKEN)
  })
})
