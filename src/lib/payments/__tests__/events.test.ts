/**
 * @jest-environment node
 *
 * Payment Flow v1.1: the Stripe payment event rows on order_status_history
 * and the "Payment failed, awaiting retry" label.
 */

import { isPaymentEventRow, paymentFailedLabel, PAYMENT_FAILED_LABEL } from '../events'

const row = (created_at: string, event?: string) => ({ created_at, metadata: event ? { event } : null })

describe('isPaymentEventRow', () => {
  it.each(['stripe_payment_failed', 'stripe_refund_synced', 'stripe_dispute_status'])('%s is a payment event row (timelines skip it)', e => {
    expect(isPaymentEventRow({ event: e })).toBe(true)
  })
  it.each([[{ event: 'draft_edited' }], [null], [{}]])('%p is not', m => {
    expect(isPaymentEventRow(m)).toBe(false)
  })
})

describe('paymentFailedLabel', () => {
  it('is the exact label', () => {
    expect(PAYMENT_FAILED_LABEL).toBe('Payment failed, awaiting retry')
  })

  it('shows while the order awaits payment and the newest row is a failure', () => {
    expect(paymentFailedLabel('AWAITING_PAYMENT', [
      row('2026-10-10T10:00:00Z'),
      row('2026-10-10T11:00:00Z', 'stripe_payment_failed'),
    ])).toBe(PAYMENT_FAILED_LABEL)
  })

  it('reads the newest row whatever the order the rows came in', () => {
    expect(paymentFailedLabel('AWAITING_PAYMENT', [
      row('2026-10-10T11:00:00Z', 'stripe_payment_failed'),
      row('2026-10-10T10:00:00Z'),
    ])).toBe(PAYMENT_FAILED_LABEL)
  })

  it('a later row (e.g. a new link) clears it', () => {
    expect(paymentFailedLabel('AWAITING_PAYMENT', [
      row('2026-10-10T11:00:00Z', 'stripe_payment_failed'),
      row('2026-10-10T12:00:00Z'),
    ])).toBeNull()
  })

  it('a retry that succeeded (the order is paid) clears it', () => {
    expect(paymentFailedLabel('PAID_PROCESSING', [row('2026-10-10T11:00:00Z', 'stripe_payment_failed')])).toBeNull()
  })

  it('no history: no label', () => {
    expect(paymentFailedLabel('AWAITING_PAYMENT', [])).toBeNull()
  })
})
