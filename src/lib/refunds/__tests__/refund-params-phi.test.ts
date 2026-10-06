/**
 * @jest-environment node
 *
 * C7 (no PHI to Stripe): every refund we create (ops cancel, refund-retry
 * cron, late group payment in the webhook) is built by connectRefundParams.
 * It carries only the PaymentIntent, the amount and the Connect unwind
 * flags. No reason text, no metadata.
 */

import { connectRefundParams } from '../refund'

describe('connectRefundParams (C7)', () => {
  it('full refund sends only the PaymentIntent and the Connect unwind flags', () => {
    expect(Object.keys(connectRefundParams('pi_1', null)).sort())
      .toEqual(['payment_intent', 'refund_application_fee', 'reverse_transfer'])
  })

  it('partial refund adds only the amount', () => {
    expect(Object.keys(connectRefundParams('pi_1', 500)).sort())
      .toEqual(['amount', 'payment_intent', 'refund_application_fee', 'reverse_transfer'])
  })
})
