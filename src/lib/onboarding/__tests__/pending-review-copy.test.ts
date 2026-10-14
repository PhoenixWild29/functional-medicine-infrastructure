/**
 * @jest-environment node
 *
 * Pending review on screen: a refused save or sign shows the banner's
 * words as they are, not wrapped in "Order 1 failed: ...".
 */

import { refusalText, PENDING_REVIEW_CODE, PENDING_REVIEW_MESSAGE } from '../pending-review-copy'

it('a pending-review refusal is shown as is', () => {
  expect(refusalText({ error: PENDING_REVIEW_MESSAGE, code: PENDING_REVIEW_CODE }, 'Order 1 (Semaglutide) failed: ')).toBe(PENDING_REVIEW_MESSAGE)
})

it('any other refusal keeps its context', () => {
  expect(refusalText({ error: 'Pharmacy not licensed' }, 'Order 1 (Semaglutide) failed: ')).toBe('Order 1 (Semaglutide) failed: Pharmacy not licensed')
  expect(refusalText({}, 'Order 1 failed: ')).toBe('Order 1 failed: Unknown error')
})

it('the words have no em dash and promise no email or text', () => {
  expect(PENDING_REVIEW_MESSAGE).not.toMatch(/—/)
  expect(PENDING_REVIEW_MESSAGE).not.toMatch(/email|text/i)
})
