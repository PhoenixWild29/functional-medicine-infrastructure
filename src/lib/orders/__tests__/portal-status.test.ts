/**
 * @jest-environment node
 *
 * Decision 10, poll fix A (docs/decisions/before-real-patients-2026-10-25.md):
 * the portal status poll mapped portal text to PHARMACY_READY, which is
 * not a status, and asked for moves the state machine refuses (for
 * example PHARMACY_ACKNOWLEDGED to SHIPPED), so Tier 2 orders never
 * advanced past PHARMACY_PROCESSING. The text now maps to a real status,
 * reached through legal steps only, forward only.
 */

import { VALID_TRANSITIONS, type OrderStatus } from '@/lib/orders/state-machine'
import { portalStatusTarget, portalSteps } from '../portal-status'

const ORDER_STATUSES = Object.keys(VALID_TRANSITIONS)

describe('portalStatusTarget: portal text to a real status', () => {
  it.each([
    ['Order Received', 'PHARMACY_ACKNOWLEDGED'],
    ['Processing', 'PHARMACY_PROCESSING'],
    ['In compounding', 'PHARMACY_COMPOUNDING'],
    ['Ready for pickup', 'READY_TO_SHIP'],
    ['READY', 'READY_TO_SHIP'],
    ['Shipped', 'SHIPPED'],
    ['Out for delivery', 'SHIPPED'],
    ['Delivered', 'SHIPPED'],
    ['Rejected', 'PHARMACY_REJECTED'],
    ['Cancelled by pharmacy', 'PHARMACY_REJECTED'],
  ])('%s -> %s', (text, status) => {
    expect(portalStatusTarget(text)).toBe(status)
  })

  it('unknown text maps to nothing', () => {
    expect(portalStatusTarget('On hold, call us')).toBeNull()
    expect(portalStatusTarget('')).toBeNull()
  })

  it('every target is a real order status (no PHARMACY_READY)', () => {
    for (const text of ['received', 'processing', 'compounding', 'ready', 'shipped', 'delivered', 'rejected', 'cancelled']) {
      const t = portalStatusTarget(`order ${text}`)
      if (t) expect(ORDER_STATUSES).toContain(t)
    }
  })
})

describe('portalSteps: legal steps only, forward only', () => {
  const legal = (from: OrderStatus, steps: OrderStatus[]) => {
    let at = from
    for (const s of steps) {
      expect(VALID_TRANSITIONS[at].has(s)).toBe(true)
      at = s
    }
  }

  it.each<[OrderStatus, OrderStatus, OrderStatus[]]>([
    ['PHARMACY_ACKNOWLEDGED', 'SHIPPED', ['PHARMACY_PROCESSING', 'READY_TO_SHIP', 'SHIPPED']],
    ['PHARMACY_ACKNOWLEDGED', 'READY_TO_SHIP', ['PHARMACY_PROCESSING', 'READY_TO_SHIP']],
    ['PHARMACY_ACKNOWLEDGED', 'PHARMACY_COMPOUNDING', ['PHARMACY_COMPOUNDING']],
    ['PHARMACY_COMPOUNDING', 'SHIPPED', ['READY_TO_SHIP', 'SHIPPED']],
    ['PHARMACY_PROCESSING', 'READY_TO_SHIP', ['READY_TO_SHIP']],
    ['READY_TO_SHIP', 'SHIPPED', ['SHIPPED']],
    ['PHARMACY_PROCESSING', 'PHARMACY_REJECTED', ['PHARMACY_REJECTED']],
  ])('%s to %s', (from, to, steps) => {
    expect(portalSteps(from, to)).toEqual(steps)
    legal(from, steps)
  })

  it.each<[OrderStatus, OrderStatus]>([
    ['PHARMACY_ACKNOWLEDGED', 'PHARMACY_ACKNOWLEDGED'],
    ['READY_TO_SHIP', 'PHARMACY_PROCESSING'],
    ['PHARMACY_COMPOUNDING', 'PHARMACY_PROCESSING'],
    ['SHIPPED', 'SHIPPED'],
    ['READY_TO_SHIP', 'PHARMACY_REJECTED'],
    ['SUBMISSION_PENDING', 'SHIPPED'],
    ['REROUTE_PENDING', 'PHARMACY_PROCESSING'],
    ['CANCELLED', 'SHIPPED'],
  ])('%s to %s: no move (same, backwards, not legal, or not a pharmacy status)', (from, to) => {
    expect(portalSteps(from, to)).toEqual([])
  })
})
