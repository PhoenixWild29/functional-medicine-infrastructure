/**
 * phone_e164: the one form a phone is matched in (a STOP reply's From,
 * the duplicate-patient check). The same rule as the migration's backfill:
 * a "+" number of 8 to 15 digits, a 10-digit US number, or an 11-digit US
 * number starting with 1. Anything else is null, never a guess.
 */

import { toE164 } from '../phone'

describe('toE164', () => {
  it.each([
    ['+15125550123', '+15125550123'],
    ['(512) 555-0123', '+15125550123'],
    ['512.555.0123', '+15125550123'],
    ['1-512-555-0123', '+15125550123'],
    ['+44 20 7946 0958', '+442079460958'],
    ['  +1 (212) 555-0111 ', '+12125550111'],
  ])('%s → %s', (raw, e164) => {
    expect(toE164(raw)).toBe(e164)
  })

  it.each([
    [null], [undefined], [''], ['555-0123'], ['0123456789'], ['112345678901'], ['+0123456789'], ['call me'],
  ])('%s → null', raw => {
    expect(toE164(raw as string | null | undefined)).toBeNull()
  })
})
