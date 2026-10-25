/**
 * Patient protocol choice, PR 2: the dashboard's Proposed tab.
 *
 * A proposed order is a DRAFT tagged to a proposal that is prepared, sent
 * or chosen: it shows under Proposed ("Awaiting patient choice") and not
 * under Drafts, so it is never signed from the Drafts list. A DRAFT whose
 * proposal was cancelled is not proposed (its lines are CANCELLED anyway).
 */

import { isProposedOrder, isTabId, ordersForView, TABS } from '../_lib/tabs'

const order = (orderId: string, status: string, proposal: { status: string } | null = null) =>
  ({ orderId, status, createdAt: '2026-10-24T10:00:00Z', proposal }) as never

const ROWS = [
  order('plain-draft', 'DRAFT'),
  order('proposed-sent', 'DRAFT', { status: 'sent' }),
  order('proposed-prepared', 'DRAFT', { status: 'draft' }),
  order('proposed-chosen', 'DRAFT', { status: 'chosen' }),
  order('old-cancelled-plan', 'DRAFT', { status: 'cancelled' }),
  order('paid', 'PAID_PROCESSING'),
]
const ids = (rows: Array<{ orderId: string }>) => rows.map(r => r.orderId)

it('Proposed is a tab after Drafts, addressable by ?tab=proposed', () => {
  const at = TABS.findIndex(t => t.id === 'proposed')
  expect(TABS[at]).toMatchObject({ label: 'Proposed' })
  expect(TABS[at - 1]!.id).toBe('drafts')
  expect(isTabId('proposed')).toBe(true)
})

it('Proposed holds the proposed drafts; Drafts no longer does', () => {
  expect(ids(ordersForView(ROWS, 'proposed', null))).toEqual(['proposed-sent', 'proposed-prepared', 'proposed-chosen'])
  expect(ids(ordersForView(ROWS, 'drafts', null))).toEqual(['plain-draft', 'old-cancelled-plan'])
  expect(ids(ordersForView(ROWS, 'all', null))).toHaveLength(ROWS.length)
})

it('isProposedOrder: a DRAFT with an open proposal only', () => {
  expect(ROWS.map(r => isProposedOrder(r))).toEqual([false, true, true, true, false, false])
})
