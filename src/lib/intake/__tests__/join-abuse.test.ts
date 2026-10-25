/**
 * @jest-environment node
 *
 * Patient Intake PR 3: abuse limits on the public sign-up link. No CAPTCHA.
 *
 *   - Rate limit per client IP: 20 submissions an hour. Generous on
 *     purpose: patients in a clinic's waiting room share its Wi-Fi, so they
 *     share one IP.
 *   - A honeypot field ("website"), hidden from people and assistive tech,
 *     that only a bot fills in.
 *   - (The per-link daily cap, 50 new patients, is SIGNUP_DAILY_CAP.)
 */

import {
  JOIN_SUBMIT_LIMIT, JOIN_SUBMIT_WINDOW_MS, joinSubmitLimiter, HONEYPOT_FIELD, honeypotTripped,
} from '../join-abuse'

beforeEach(() => joinSubmitLimiter.reset())

it('allows 20 submissions an hour per IP, then refuses with the seconds left', async () => {
  expect(JOIN_SUBMIT_LIMIT).toBe(20)
  expect(JOIN_SUBMIT_WINDOW_MS).toBe(60 * 60 * 1000)
  for (let i = 0; i < 20; i++) expect((await joinSubmitLimiter.check('203.0.113.7')).allowed).toBe(true)
  const refused = await joinSubmitLimiter.check('203.0.113.7')
  expect(refused.allowed).toBe(false)
  expect(refused.retryAfterSeconds).toBeGreaterThan(0)
})

it('one IP over the limit does not block another', async () => {
  for (let i = 0; i < 21; i++) await joinSubmitLimiter.check('203.0.113.7')
  expect((await joinSubmitLimiter.check('198.51.100.4')).allowed).toBe(true)
})

describe('the honeypot', () => {
  it('is the "website" field', () => {
    expect(HONEYPOT_FIELD).toBe('website')
  })

  it.each([
    [{ website: 'http://spam.example' }, true],
    [{ website: ' x ' }, true],
    [{ website: '' }, false],
    [{ website: '   ' }, false],
    [{}, false],
    [{ website: null }, false],
    [null, false],
    ['text', false],
  ])('%j tripped: %s', (body, tripped) => {
    expect(honeypotTripped(body)).toBe(tripped)
  })
})
