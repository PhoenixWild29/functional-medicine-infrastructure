/**
 * @jest-environment node
 *
 * deadlinePassed compares instants, not strings: Postgres returns an
 * offset ("+00:00", or another zone's) and toISOString() returns "Z", so
 * string order is not time order.
 */

import { deadlinePassed } from '../deadline'

const NOW = Date.parse('2026-10-12T15:00:00.000Z')

it('a deadline in another offset that is still ahead has not passed', () => {
  // 10:30 at -05:00 is 15:30Z: ahead, though it sorts before "15:00" as a string.
  expect(deadlinePassed('2026-10-12T10:30:00-05:00', NOW)).toBe(false)
})

it('a deadline in another offset that is behind has passed', () => {
  // 17:30 at +05:00 is 12:30Z: behind, though it sorts after "15:00" as a string.
  expect(deadlinePassed('2026-10-12T17:30:00+05:00', NOW)).toBe(true)
})

it('"+00:00" and "Z" at the same instant: not passed until the instant is behind', () => {
  expect(deadlinePassed('2026-10-12T15:00:00+00:00', NOW)).toBe(false)
  expect(deadlinePassed('2026-10-12T14:59:59.999+00:00', NOW)).toBe(true)
})

it('a missing or unparseable deadline has not passed', () => {
  expect(deadlinePassed(null, NOW)).toBe(false)
  expect(deadlinePassed(undefined, NOW)).toBe(false)
  expect(deadlinePassed('not a date', NOW)).toBe(false)
})
