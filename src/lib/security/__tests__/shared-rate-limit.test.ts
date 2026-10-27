/**
 * @jest-environment node
 *
 * Security review L7: in-memory limits are per Vercel instance, so N warm
 * instances allow N times the limit. createSharedRateLimiter keeps the
 * in-memory limiter as the first, cheap layer and adds a count shared by
 * every instance, in Postgres (lib/security/db-rate-limit). If the shared
 * count cannot be read, it fails open: the limiter being down never locks
 * anyone out.
 */

const dbHit = jest.fn()
jest.mock('@/lib/security/db-rate-limit', () => ({ dbRateLimitHit: (...a: unknown[]) => dbHit(...a) }))

import { createSharedRateLimiter } from '../shared-rate-limit'

const WINDOW_MS = 15 * 60_000

beforeEach(() => dbHit.mockReset())

it('under the limit everywhere: allowed; the shared count is asked with the bucket, key and window', async () => {
  dbHit.mockResolvedValue({ count: 3, windowStart: Date.now() })
  const limiter = createSharedRateLimiter({ bucket: 'signup', limit: 5, windowMs: WINDOW_MS })
  expect(await limiter.check('203.0.113.7')).toEqual({ allowed: true, retryAfterSeconds: 0 })
  expect(dbHit).toHaveBeenCalledWith('signup', '203.0.113.7', WINDOW_MS / 1000)
})

it('over the shared limit (other instances used it up): refused, Retry-After to the end of the shared window', async () => {
  const windowStart = Date.now() - 5 * 60_000
  dbHit.mockResolvedValue({ count: 6, windowStart })
  const limiter = createSharedRateLimiter({ bucket: 'signup', limit: 5, windowMs: WINDOW_MS })
  const r = await limiter.check('203.0.113.7')
  expect(r.allowed).toBe(false)
  expect(r.retryAfterSeconds).toBeGreaterThan(9 * 60)
  expect(r.retryAfterSeconds).toBeLessThanOrEqual(10 * 60)
})

it('exactly at the limit is still allowed (the limit-th request)', async () => {
  dbHit.mockResolvedValue({ count: 5, windowStart: Date.now() })
  const limiter = createSharedRateLimiter({ bucket: 'signup', limit: 5, windowMs: WINDOW_MS })
  expect((await limiter.check('k')).allowed).toBe(true)
})

it('the in-memory layer refuses first, without a database call', async () => {
  dbHit.mockResolvedValue({ count: 1, windowStart: Date.now() })
  const limiter = createSharedRateLimiter({ bucket: 'join', limit: 2, windowMs: WINDOW_MS })
  await limiter.check('k')
  await limiter.check('k')
  dbHit.mockClear()
  const r = await limiter.check('k')
  expect(r.allowed).toBe(false)
  expect(dbHit).not.toHaveBeenCalled()
})

it('the shared count cannot be read: fails open (allowed)', async () => {
  dbHit.mockResolvedValue(null)
  const limiter = createSharedRateLimiter({ bucket: 'signup', limit: 5, windowMs: WINDOW_MS })
  expect(await limiter.check('k')).toEqual({ allowed: true, retryAfterSeconds: 0 })
})

it('reset() clears the in-memory layer (tests)', async () => {
  dbHit.mockResolvedValue(null)
  const limiter = createSharedRateLimiter({ bucket: 'join', limit: 1, windowMs: WINDOW_MS })
  await limiter.check('k')
  expect((await limiter.check('k')).allowed).toBe(false)
  limiter.reset()
  expect((await limiter.check('k')).allowed).toBe(true)
})

it('a bucket name must be a short lower-case code (it is stored and checked by the database)', () => {
  expect(() => createSharedRateLimiter({ bucket: 'Sign Up', limit: 5, windowMs: WINDOW_MS })).toThrow()
  expect(() => createSharedRateLimiter({ bucket: 'signup', limit: 5, windowMs: 500 })).toThrow()
})
