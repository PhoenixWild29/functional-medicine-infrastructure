/**
 * @jest-environment node
 *
 * Timelines skip refund bookkeeping rows — and ONLY those. The first
 * version of this filter skipped every same-status row, which hid the
 * draft-edit audit (DRAFT → DRAFT, "changed dose · Sarah Chen"); the
 * order-drawer timeline test caught it. Pinned both ways here.
 */

import { isRefundEventRow } from '../events'

describe('isRefundEventRow', () => {
  it('matches the two refund bookkeeping events', () => {
    expect(isRefundEventRow({ event: 'stripe_refund_pending', refund_id: 're_1' })).toBe(true)
    expect(isRefundEventRow({ event: 'late_payment_refunded', payment_group_id: 'g-1' })).toBe(true)
  })

  it('does not match a draft-edit audit row, or any other row', () => {
    expect(isRefundEventRow({ action: 'draft_edited', changes: { dose: ['10', '20'] } })).toBe(false)
    expect(isRefundEventRow({ reason: 'ops_cancel_refund' })).toBe(false)
    expect(isRefundEventRow(null)).toBe(false)
    expect(isRefundEventRow(undefined)).toBe(false)
  })
})
