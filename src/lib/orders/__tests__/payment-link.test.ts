/**
 * Prod, 5 Oct: the Pending Payment card said "6 Open payment links" and
 * all 6 had expired. It counted every AWAITING_PAYMENT and PAYMENT_EXPIRED
 * order. A link is payable only while it is AWAITING_PAYMENT and inside
 * its 72 hours (the checkout token's lifetime, and the window after which
 * the payment-expiry cron expires the order). Paid, cancelled and expired
 * links are not open.
 */

import { paymentLinkState, paymentLinkCounts, PAYMENT_LINK_TTL_MS } from '../payment-link'

const NOW = Date.parse('2026-10-05T12:00:00.000Z')
const HOUR = 60 * 60 * 1000
const ago = (h: number) => new Date(NOW - h * HOUR).toISOString()

describe('paymentLinkState', () => {
  it('a link is open for 72 hours from signing', () => {
    expect(PAYMENT_LINK_TTL_MS).toBe(72 * HOUR)
    expect(paymentLinkState({ status: 'AWAITING_PAYMENT', lockedAt: ago(1), createdAt: ago(2) }, NOW)).toBe('open')
    expect(paymentLinkState({ status: 'AWAITING_PAYMENT', lockedAt: ago(71.9), createdAt: ago(80) }, NOW)).toBe('open')
  })

  it('past 72 hours it is expired, even before the cron moves it to PAYMENT_EXPIRED', () => {
    expect(paymentLinkState({ status: 'AWAITING_PAYMENT', lockedAt: ago(72.1), createdAt: ago(80) }, NOW)).toBe('expired')
  })

  it('without locked_at, the age is taken from created_at', () => {
    expect(paymentLinkState({ status: 'AWAITING_PAYMENT', lockedAt: null, createdAt: ago(100) }, NOW)).toBe('expired')
    expect(paymentLinkState({ status: 'AWAITING_PAYMENT', lockedAt: null, createdAt: ago(10) }, NOW)).toBe('open')
  })

  it('PAYMENT_EXPIRED is expired; paid, cancelled and drafts have no open link', () => {
    expect(paymentLinkState({ status: 'PAYMENT_EXPIRED', lockedAt: ago(1), createdAt: ago(1) }, NOW)).toBe('expired')
    for (const status of ['PAID_PROCESSING', 'DELIVERED', 'CANCELLED', 'REFUNDED', 'DRAFT']) {
      expect(paymentLinkState({ status, lockedAt: ago(1), createdAt: ago(1) }, NOW)).toBeNull()
    }
  })
})

describe('paymentLinkCounts', () => {
  it('prod: six expired links are 0 open and 6 expired', () => {
    const six = [
      ...Array.from({ length: 3 }, () => ({ status: 'PAYMENT_EXPIRED', lockedAt: ago(200), createdAt: ago(200) })),
      ...Array.from({ length: 3 }, () => ({ status: 'AWAITING_PAYMENT', lockedAt: ago(96), createdAt: ago(96) })),
    ]
    expect(paymentLinkCounts(six, NOW)).toEqual({ open: 0, expired: 6 })
  })

  it('counts open and expired separately and ignores the rest', () => {
    expect(paymentLinkCounts([
      { status: 'AWAITING_PAYMENT', lockedAt: ago(5), createdAt: ago(5) },
      { status: 'AWAITING_PAYMENT', lockedAt: ago(90), createdAt: ago(90) },
      { status: 'PAYMENT_EXPIRED', lockedAt: ago(90), createdAt: ago(90) },
      { status: 'DELIVERED', lockedAt: ago(5), createdAt: ago(5) },
      { status: 'CANCELLED', lockedAt: ago(5), createdAt: ago(5) },
    ], NOW)).toEqual({ open: 1, expired: 2 })
  })
})
