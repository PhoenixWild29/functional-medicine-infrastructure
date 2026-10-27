/**
 * @jest-environment node
 *
 * Review P1: only a session made from the reset link (amr 'recovery'),
 * within the last 15 minutes, may set a password without the current one.
 */

import { RECOVERY_MAX_AGE_SECONDS, isRecentRecovery } from '../recovery-session'

const NOW = 1_800_000_000

describe('isRecentRecovery', () => {
  it('a recovery entry used just now, or up to 15 minutes ago', () => {
    expect(isRecentRecovery([{ method: 'recovery', timestamp: NOW }], NOW)).toBe(true)
    expect(isRecentRecovery([{ method: 'recovery', timestamp: NOW - RECOVERY_MAX_AGE_SECONDS }], NOW)).toBe(true)
  })

  it('older than 15 minutes: no', () => {
    expect(isRecentRecovery([{ method: 'recovery', timestamp: NOW - RECOVERY_MAX_AGE_SECONDS - 1 }], NOW)).toBe(false)
  })

  it('any other method (password, otp, totp, magiclink): no', () => {
    for (const method of ['password', 'otp', 'totp', 'magiclink', 'mfa/totp']) {
      expect(isRecentRecovery([{ method, timestamp: NOW }], NOW)).toBe(false)
    }
  })

  it('recovery among other entries (recovery, then MFA): yes', () => {
    expect(isRecentRecovery([{ method: 'totp', timestamp: NOW }, { method: 'recovery', timestamp: NOW - 30 }], NOW)).toBe(true)
  })

  it('the RFC 8176 string form has no time to check: no', () => {
    expect(isRecentRecovery(['recovery'], NOW)).toBe(false)
  })

  it('missing, malformed or far-future values: no', () => {
    for (const amr of [undefined, null, 'recovery', {}, [null], [{ method: 'recovery' }], [{ method: 'recovery', timestamp: '1800000000' }], [{ method: 'recovery', timestamp: Number.NaN }]]) {
      expect(isRecentRecovery(amr, NOW)).toBe(false)
    }
    // A minute of clock skew is allowed; more is not.
    expect(isRecentRecovery([{ method: 'recovery', timestamp: NOW + 30 }], NOW)).toBe(true)
    expect(isRecentRecovery([{ method: 'recovery', timestamp: NOW + 600 }], NOW)).toBe(false)
  })
})
