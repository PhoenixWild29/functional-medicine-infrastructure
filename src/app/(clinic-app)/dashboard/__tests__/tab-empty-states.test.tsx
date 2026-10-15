/**
 * Click-through, 14 Oct: the Submitting tab said "No orders match your
 * filters" with a "Clear filters" button when no filter was set. A tab is
 * not a filter: an empty tab says what it holds ("No orders are being
 * submitted") with no button. Only a real filter (the month-to-date
 * period a KPI card applies) gets "No orders match your filters" and
 * "Clear filters", which removes that filter and keeps the tab.
 */

import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { OrdersDashboard } from '../_components/orders-dashboard'
import type { DashboardOrder } from '../page'

const mockReplace = jest.fn()
let mockSearch = new URLSearchParams()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: mockReplace, refresh: jest.fn() }),
  useSearchParams: () => mockSearch,
  usePathname: () => '/dashboard',
}))
jest.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ is: () => ({ order: () => Promise.resolve({ data: null, error: { message: 'offline in test' } }) }) }) }) }),
  }),
}))

const LAST_YEAR = '2025-01-15T12:00:00.000Z'
const ONE: DashboardOrder = {
  orderId: 'o-1', patientName: 'Demo, Alex', medicationName: 'Med', status: 'DELIVERED', submissionTier: 'TIER_4_FAX',
  createdAt: LAST_YEAR, updatedAt: LAST_YEAR, retailCents: 100, wholesaleCents: 50, platformFeeCents: 7, clinicPayoutCents: 43,
  isOverdue48h: false, paymentGroupId: null, providerId: 'p',
}

function renderAt(query: string) {
  mockSearch = new URLSearchParams(query)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  render(<QueryClientProvider client={queryClient}><OrdersDashboard initialOrders={[ONE]} stripeConnectStatus="ACTIVE" clinicId="c-1" /></QueryClientProvider>)
}

beforeEach(() => mockReplace.mockClear())

it.each([
  ['submitting', 'No orders are being submitted'],
  ['drafts', 'No draft orders'],
  ['awaiting_payment', 'No orders are waiting for payment'],
  ['processing', 'No orders are being processed'],
  ['errors', 'No orders need attention'],
])('an empty %s tab with no filter: "%s", no Clear filters', (tab, text) => {
  renderAt(`tab=${tab}`)
  expect(screen.getByText(text)).toBeInTheDocument()
  expect(screen.queryByText('No orders match your filters')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull()
})

it('with the month-to-date filter and nothing left: "No orders match your filters" and Clear filters, which keeps the tab', () => {
  renderAt('tab=shipped&period=mtd')
  expect(screen.getByText('No orders match your filters')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
  expect(mockReplace).toHaveBeenCalledWith('/dashboard?tab=shipped', { scroll: false })
})
