/**
 * @jest-environment node
 *
 * A small fixed-window rate limiter: N attempts per window per key. Over
 * the limit it refuses and says when to retry; the window resets; keys are
 * independent.
 */

import { createRateLimiter } from '../rate-limit'

function limiter(limit = 3, windowMs = 60_000) {
  let now = 1_000_000
  const l = createRateLimiter({ limit, windowMs, now: () => now })
  return { l, advance: (ms: number) => { now += ms } }
}

it('allows up to the limit, then refuses with the seconds left in the window', () => {
  const { l, advance } = limiter()
  expect([l.check('a'), l.check('a'), l.check('a')].map(r => r.allowed)).toEqual([true, true, true])
  advance(15_000)
  expect(l.check('a')).toEqual({ allowed: false, retryAfterSeconds: 45 })
})

it('a refused attempt does not extend the window', () => {
  const { l, advance } = limiter(1)
  l.check('a')
  advance(10_000)
  l.check('a')
  advance(10_000)
  expect(l.check('a')).toEqual({ allowed: false, retryAfterSeconds: 40 })
})

it('resets after the window', () => {
  const { l, advance } = limiter()
  for (let i = 0; i < 3; i++) l.check('a')
  advance(60_000)
  expect(l.check('a').allowed).toBe(true)
})

it('keys are independent', () => {
  const { l } = limiter()
  for (let i = 0; i < 3; i++) l.check('a')
  expect(l.check('a').allowed).toBe(false)
  expect(l.check('b').allowed).toBe(true)
})

it('reset() clears every key', () => {
  const { l } = limiter(1)
  l.check('a')
  l.reset()
  expect(l.check('a').allowed).toBe(true)
})

it('forgets expired keys, so memory does not grow without bound', () => {
  const { l, advance } = limiter(1, 1_000)
  for (let i = 0; i < 50; i++) l.check(`ip-${i}`)
  advance(1_000)
  l.check('fresh')
  expect(l.size()).toBe(1)
})

it('peek says whether a key is over the limit without counting an attempt (security B12)', () => {
  const { l, advance } = limiter(2)
  for (let i = 0; i < 5; i++) expect(l.peek('a')).toEqual({ allowed: true, retryAfterSeconds: 0 })
  l.check('a')
  expect(l.peek('a').allowed).toBe(true)
  l.check('a')
  advance(20_000)
  expect(l.peek('a')).toEqual({ allowed: false, retryAfterSeconds: 40 })
  advance(40_000)
  expect(l.peek('a').allowed).toBe(true)
  expect(l.peek('b').allowed).toBe(true)
})
