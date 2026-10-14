/**
 * Click-through, 14 Oct: seeded orders all showed as "d1000000…" (the
 * first 8 characters of the UUID), so rows could not be told apart. The
 * list shows a short number from both ends of the ID ("d100…0001"), with
 * the full ID in the tooltip. Display only: the ID itself is unchanged.
 */

import { render, screen, within } from '@testing-library/react'
import { orderDisplayNumber } from '../order-number'
import { OrdersTable } from '@/app/(clinic-app)/dashboard/_components/orders-table'
import type { DashboardOrder } from '@/app/(clinic-app)/dashboard/page'

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }))

const SEEDED = ['d1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-00000000000a']

describe('orderDisplayNumber', () => {
  it('seeded IDs that share a prefix get different numbers', () => {
    const shown = SEEDED.map(orderDisplayNumber)
    expect(new Set(shown).size).toBe(SEEDED.length)
    expect(shown[0]).toBe('d100…0001')
  })
  it('a random UUID: its first 4 and last 4 characters', () => {
    expect(orderDisplayNumber('3f2a9c1e-7b44-4d8e-9a10-55e0c1d2b7aa')).toBe('3f2a…b7aa')
  })
  it('anything else is shown as it is', () => {
    expect(orderDisplayNumber('order-1')).toBe('order-1')
  })
})

it('the orders table shows the short numbers, distinct per row, with the full ID as the tooltip', () => {
  const orders: DashboardOrder[] = SEEDED.map(id => ({
    orderId: id, patientName: 'Demo, Alex', medicationName: 'Med', status: 'DELIVERED', submissionTier: 'TIER_4_FAX',
    createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', retailCents: 1, wholesaleCents: 1, platformFeeCents: 0, clinicPayoutCents: 0,
    isOverdue48h: false, paymentGroupId: null, providerId: 'p',
  }))
  render(<OrdersTable orders={orders} isLoading={false} isError={false} onRowClick={() => {}} onRetry={() => {}} />)
  for (const id of SEEDED) {
    const cell = within(screen.getByRole('table')).getByText(orderDisplayNumber(id))
    expect(cell).toHaveAttribute('title', id)
  }
  expect(screen.queryByText('d1000000…')).toBeNull()
})
