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
import { CB_BADGE } from '@/app/(ops-dashboard)/ops/adapters/_components/adapter-health-constants'

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

// ============================================================
// CB_BADGE label-map (PR #16 / WO-72)
// ============================================================
//
// Guards the plain-English circuit-breaker vocabulary that both the
// Adapter Health card chip AND the /ops/adapters filter dropdown read
// from. If anyone accidentally reverts a label back to the technical
// enum (Closed / Open / Half-Open) or relabels a value without updating
// the demo doc, these assertions break first.

describe('CB_BADGE label map (WO-72 plain-English vocabulary)', () => {
  it('maps CLOSED → Online', () => {
    expect(CB_BADGE['CLOSED']?.label).toBe('Online')
  })

  it('maps OPEN → Offline', () => {
    expect(CB_BADGE['OPEN']?.label).toBe('Offline')
  })

  it('maps HALF_OPEN → Degraded', () => {
    expect(CB_BADGE['HALF_OPEN']?.label).toBe('Degraded')
  })

  it('CLOSED chip uses outlined styling (PR #16 — reduce three-emerald redundancy)', () => {
    // Regression guard: the CLOSED chip was deliberately softened from
    // bg-emerald-100 fill to border-emerald-300 outline so healthy
    // cards don't stack three emerald elements (dot + chip + pill).
    // This test fails if someone re-saturates it without considering
    // the visual-noise concern.
    const cls = CB_BADGE['CLOSED']?.cls ?? ''
    expect(cls).toContain('border')
    expect(cls).not.toContain('bg-emerald')
  })

  it('OPEN chip stays bold red (alarms should shout — asymmetric by design)', () => {
    const cls = CB_BADGE['OPEN']?.cls ?? ''
    expect(cls).toContain('bg-red-100')
    expect(cls).toContain('font-bold')
  })
})
