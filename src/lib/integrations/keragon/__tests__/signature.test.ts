/**
 * @jest-environment node
 *
 * The Keragon webhook signature: HMAC-SHA256 with the clinic's shared
 * secret over `${timestamp}.${rawBody}`, sent as `v1=<hex>`. Good passes;
 * a wrong secret, a changed body or a changed timestamp fails; a timestamp
 * more than 5 minutes from our clock is stale; the compare is
 * constant-time. (A replayed event id is refused by the route: see
 * patients-route.test.ts.)
 */

import * as crypto from 'node:crypto'

// A pass-through timingSafeEqual, so the test can see it is used.
jest.mock('node:crypto', () => {
  const actual = jest.requireActual('node:crypto')
  return { ...actual, timingSafeEqual: jest.fn((a: Buffer, b: Buffer) => actual.timingSafeEqual(a, b)) }
})

import { MAX_SKEW_SECONDS, newSharedSecret, signRequest, verifySignature } from '../signature'

const SECRET = 'kgn_whsec_test_secret_value_0123456789'
const NOW_MS = Date.parse('2026-10-12T15:00:00Z')
const TS = String(Math.floor(NOW_MS / 1000))
const BODY = JSON.stringify({ event_id: 'evt_1', patient: { external_patient_id: 'X1' } })

const check = (over: Partial<Parameters<typeof verifySignature>[0]> = {}) =>
  verifySignature({ secret: SECRET, timestamp: TS, signature: signRequest(SECRET, TS, BODY), rawBody: BODY, nowMs: NOW_MS, ...over })

describe('good', () => {
  it('a request signed with the shared secret passes', () => {
    expect(check()).toEqual({ ok: true })
  })

  it('upper-case hex and surrounding spaces are accepted', () => {
    expect(check({ signature: `  ${signRequest(SECRET, TS, BODY).toUpperCase().replace('V1=', 'v1=')} ` })).toEqual({ ok: true })
  })

  it('within 5 minutes either way is fresh', () => {
    expect(check({ nowMs: NOW_MS + MAX_SKEW_SECONDS * 1000 })).toEqual({ ok: true })
    expect(check({ nowMs: NOW_MS - MAX_SKEW_SECONDS * 1000 })).toEqual({ ok: true })
  })

  it('the signature covers timestamp.body, as documented', () => {
    const expected = crypto.createHmac('sha256', SECRET).update(`${TS}.${BODY}`).digest('hex')
    expect(signRequest(SECRET, TS, BODY)).toBe(`v1=${expected}`)
  })
})

describe('bad', () => {
  it('another secret fails', () => {
    expect(check({ signature: signRequest('another-secret', TS, BODY) })).toEqual({ ok: false, reason: 'mismatch' })
  })

  it('a changed body fails (one character)', () => {
    expect(check({ rawBody: BODY.replace('X1', 'X2') })).toEqual({ ok: false, reason: 'mismatch' })
  })

  it('a changed timestamp fails (the timestamp is signed)', () => {
    const later = String(Number(TS) + 1)
    expect(check({ timestamp: later })).toEqual({ ok: false, reason: 'mismatch' })
  })

  it('missing or malformed headers fail', () => {
    expect(check({ signature: null })).toEqual({ ok: false, reason: 'missing' })
    expect(check({ timestamp: null })).toEqual({ ok: false, reason: 'missing' })
    expect(check({ signature: 'sha256=abc' })).toEqual({ ok: false, reason: 'malformed' })
    expect(check({ signature: 'v1=deadbeef' })).toEqual({ ok: false, reason: 'malformed' })
    expect(check({ timestamp: '2026-10-12T15:00:00Z' })).toEqual({ ok: false, reason: 'malformed' })
  })
})

describe('stale', () => {
  it('more than 5 minutes old, or ahead, is stale even with a valid signature', () => {
    expect(check({ nowMs: NOW_MS + (MAX_SKEW_SECONDS + 1) * 1000 })).toEqual({ ok: false, reason: 'stale' })
    expect(check({ nowMs: NOW_MS - (MAX_SKEW_SECONDS + 1) * 1000 })).toEqual({ ok: false, reason: 'stale' })
  })
})

describe('constant time', () => {
  it('compares with crypto.timingSafeEqual', () => {
    const spy = jest.requireMock('node:crypto').timingSafeEqual as jest.Mock
    spy.mockClear()
    check({ signature: signRequest('another-secret', TS, BODY) })
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

it('new secrets are long, random and recognisable', () => {
  const a = newSharedSecret()
  const b = newSharedSecret()
  expect(a).toMatch(/^kgn_whsec_[A-Za-z0-9_-]{43}$/)
  expect(a).not.toBe(b)
})
