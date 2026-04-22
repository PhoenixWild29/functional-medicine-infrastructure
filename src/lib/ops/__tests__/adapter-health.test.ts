/**
 * @jest-environment node
 *
 * Tests for computeAdapterStatus. The 'idle' branch is new in the
 * demo-readiness PR #3 (cowork review finding B1) — it was the optics
 * fix to stop a fresh seed environment from rendering every pharmacy as
 * "Critical" on the Ops tour. Regression guards for the existing
 * green/yellow/red branches live here alongside.
 */

import { computeAdapterStatus } from '../adapter-health'

const RECENT = new Date().toISOString()
const HOURS_AGO_2 = new Date(Date.now() - 2 * 60 * 60_000).toISOString()
const MIN_AGO_30 = new Date(Date.now() - 30 * 60_000).toISOString()

describe('computeAdapterStatus', () => {
  describe('idle branch (PR #3 / cowork B1)', () => {
    it('returns idle when totalCount === 0 regardless of other inputs', () => {
      expect(computeAdapterStatus(100, 'CLOSED', null, 0)).toBe('idle')
      expect(computeAdapterStatus(100, null, null, 0)).toBe('idle')
      // Even with an OPEN circuit breaker, zero traffic means nothing has
      // actually failed; render idle.
      expect(computeAdapterStatus(0, 'OPEN', null, 0)).toBe('idle')
    })

    it('does NOT return idle when totalCount > 0', () => {
      expect(computeAdapterStatus(100, 'CLOSED', RECENT, 1)).not.toBe('idle')
    })
  })

  describe('red branch (regression guards)', () => {
    it('returns red when CB is OPEN', () => {
      expect(computeAdapterStatus(100, 'OPEN', RECENT, 5)).toBe('red')
    })

    it('returns red when success rate < 80%', () => {
      expect(computeAdapterStatus(70, 'CLOSED', RECENT, 10)).toBe('red')
    })

    it('returns red when last success was over 60 min ago', () => {
      expect(computeAdapterStatus(100, 'CLOSED', HOURS_AGO_2, 5)).toBe('red')
    })
  })

  describe('yellow branch (regression guards)', () => {
    it('returns yellow for HALF_OPEN CB even at 100% success', () => {
      expect(computeAdapterStatus(100, 'HALF_OPEN', RECENT, 5)).toBe('yellow')
    })

    it('returns yellow for success rate 80-95', () => {
      expect(computeAdapterStatus(90, 'CLOSED', RECENT, 10)).toBe('yellow')
    })

    it('returns yellow when last success 15-60 min ago', () => {
      expect(computeAdapterStatus(100, 'CLOSED', MIN_AGO_30, 5)).toBe('yellow')
    })
  })

  describe('green branch (regression guards)', () => {
    it('returns green for healthy pharmacy', () => {
      expect(computeAdapterStatus(100, 'CLOSED', RECENT, 5)).toBe('green')
    })

    it('returns green at the edge (95%)', () => {
      expect(computeAdapterStatus(95, 'CLOSED', RECENT, 10)).toBe('green')
    })
  })
})
