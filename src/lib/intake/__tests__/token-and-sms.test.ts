/**
 * @jest-environment node
 *
 * Patient Intake PR 2: the intake link token and the one text message.
 *
 *   - A token is 32 random bytes, base64url (43 characters). Only its
 *     SHA-256 (hex) is stored; the token itself is shown once to staff.
 *   - Twilio counts as configured only when the account SID, auth token
 *     and sending number are all set, and TWILIO_ENABLED is not 'false'.
 *     Prod has no Twilio, so the app must work without it.
 *   - The text carries no PHI: the clinic name and the link, exactly the
 *     spec's wording, nothing about the patient or a prescription.
 */

import { createHash } from 'node:crypto'
import { hashIntakeToken, isWellFormedIntakeToken, newIntakeToken, INTAKE_LINK_TTL_HOURS } from '../token'
import { intakeSmsText } from '../sms-text'
import { isTwilioConfigured } from '@/lib/twilio/config'

describe('intake token', () => {
  it('is 43 base64url characters, different every time', () => {
    const a = newIntakeToken()
    const b = newIntakeToken()
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(a).not.toBe(b)
    expect(isWellFormedIntakeToken(a)).toBe(true)
  })

  it('rejects anything that is not a token before touching the database', () => {
    for (const bad of ['', 'abc', 'x'.repeat(43) + '=', '../../etc/passwd', 'a b'.padEnd(43, 'c')]) {
      expect(isWellFormedIntakeToken(bad)).toBe(false)
    }
  })

  it('is stored as its SHA-256 hex, matching the migration CHECK', () => {
    const token = newIntakeToken()
    const hash = hashIntakeToken(token)
    expect(hash).toBe(createHash('sha256').update(token, 'utf8').digest('hex'))
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).not.toContain(token)
  })

  it('expires like a checkout link (72 hours)', () => {
    expect(INTAKE_LINK_TTL_HOURS).toBe(72)
  })
})

describe('isTwilioConfigured', () => {
  const FULL = { TWILIO_ACCOUNT_SID: 'AC123', TWILIO_AUTH_TOKEN: 'secret', TWILIO_PHONE_NUMBER: '+15125550100' }

  it('is true only with the SID, auth token and number all set', () => {
    expect(isTwilioConfigured(FULL)).toBe(true)
    expect(isTwilioConfigured({ ...FULL, TWILIO_ACCOUNT_SID: '' })).toBe(false)
    expect(isTwilioConfigured({ ...FULL, TWILIO_AUTH_TOKEN: undefined })).toBe(false)
    expect(isTwilioConfigured({ ...FULL, TWILIO_PHONE_NUMBER: '  ' })).toBe(false)
    expect(isTwilioConfigured({})).toBe(false)
  })

  it('is false when texting is switched off', () => {
    expect(isTwilioConfigured({ ...FULL, TWILIO_ENABLED: 'false' })).toBe(false)
  })
})

describe('the intake text', () => {
  it('is the spec wording: clinic name and link, nothing else', () => {
    expect(intakeSmsText('Sunrise Functional Medicine', 'https://app.example.test/intake/abc'))
      .toBe('Sunrise Functional Medicine has sent you a secure link to complete your details: https://app.example.test/intake/abc')
  })

  it('names no patient, prescription, medication or pharmacy', () => {
    const text = intakeSmsText('Test Clinic', 'https://x.test/intake/t')
    expect(text).not.toMatch(/prescri|medic|pharmac|order|Rx|\bDr\.?\b/i)
  })
})
