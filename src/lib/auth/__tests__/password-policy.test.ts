/**
 * @jest-environment node
 *
 * B11 (technical-safeguards-evidence-2026-10-25.md): the policy for a
 * password a person sets on the reset page or in Change password.
 */

import {
  COMMON_PASSWORDS,
  COMMON_PASSWORD_MESSAGE,
  EMAIL_PASSWORD_MESSAGE,
  REPEATED_PASSWORD_MESSAGE,
  newPasswordProblem,
} from '../password-policy'

const EMAIL = 'dr.chen-clinic@sunrise-clinic.com'

describe('newPasswordProblem', () => {
  it('accepts a long, uncommon password', () => {
    expect(newPasswordProblem('violet harbor 42 lantern', EMAIL)).toBeNull()
  })

  it('at least 12 characters, at most 72 bytes', () => {
    expect(newPasswordProblem('short1!', EMAIL)).toBe('Use at least 12 characters.')
    expect(newPasswordProblem('x'.repeat(73), EMAIL)).toBe('Use at most 72 characters.')
  })

  it('refuses the commonest passwords, whatever the case', () => {
    expect(newPasswordProblem('Password1234', EMAIL)).toBe(COMMON_PASSWORD_MESSAGE)
    expect(newPasswordProblem('QWERTY123456', EMAIL)).toBe(COMMON_PASSWORD_MESSAGE)
    for (const p of COMMON_PASSWORDS) expect(p.length).toBeGreaterThanOrEqual(12)
  })

  it('refuses one repeated character', () => {
    expect(newPasswordProblem('zzzzzzzzzzzzzz', EMAIL)).toBe(REPEATED_PASSWORD_MESSAGE)
  })

  it('refuses the email address or the part before the @', () => {
    expect(newPasswordProblem(EMAIL, EMAIL)).toBe(EMAIL_PASSWORD_MESSAGE)
    expect(newPasswordProblem(EMAIL.toUpperCase(), EMAIL)).toBe(EMAIL_PASSWORD_MESSAGE)
    expect(newPasswordProblem('dr.chen-clinic', EMAIL)).toBe(EMAIL_PASSWORD_MESSAGE)
    expect(newPasswordProblem('dr.chen-clinic', null)).toBeNull()
  })
})
