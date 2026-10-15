/**
 * Click-through, 14 Oct: "Total Orders 1, Month to date" opened All with
 * 18 rows, and "Completed, Delivered this month" opened Shipped with six
 * September orders. A card's number must be the number of rows it opens.
 *
 * The cards now open their tab with the same period applied
 * (?period=mtd, orders created this month, UTC, as the cards count them):
 *   - Total Orders  → /dashboard?tab=all&period=mtd
 *   - Revenue       → /dashboard?tab=all&period=mtd
 *   - Shipped       → /dashboard?tab=shipped&period=mtd (was "Completed,
 *     Delivered this month", which counted DELIVERED only while the tab
 *     lists SHIPPED and DELIVERED)
 *   - Pending Payment keeps opening its tab with every date: its card
 *     counts open links of any age.
 * One filter (ordersForView) drives both the card numbers (dashboardKpis)
 * and the rows, and the period shows as a chip that can be cleared.
 */

import { render, screen, within, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { OrdersDashboard } from '../_components/orders-dashboard'
import { RevenueSummary } from '../_components/revenue-summary'
import { ordersForView, dashboardKpis, monthToDateStart } from '../_lib/tabs'
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
    from: () => ({
      select: () => ({
        eq: () => ({ is: () => ({ order: () => Promise.resolve({ data: null, error: { message: 'offline in test' } }) }) }),
      }),
    }),
  }),
}))

const NOW = new Date()
const THIS_MONTH = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), 1, 12)).toISOString()
const LAST_MONTH = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() - 1, 10, 12)).toISOString()

function order(id: string, status: DashboardOrder['status'], createdAt: string): DashboardOrder {
  return {
    orderId: id, patientName: `Patient ${id}`, medicationName: `Med ${id}`,
    status, submissionTier: 'TIER_4_FAX', createdAt, updatedAt: createdAt,
    retailCents: 10000, wholesaleCents: 5000, platformFeeCents: 750, clinicPayoutCents: 4250,
    isOverdue48h: false, paymentGroupId: null, providerId: 'prov-1',
  }
}

// One order this month; six shipped or delivered last month; more history.
const ORDERS: DashboardOrder[] = [
  order('oct-1', 'PAID_PROCESSING', THIS_MONTH),
  ...['SHIPPED', 'DELIVERED', 'DELIVERED', 'SHIPPED', 'DELIVERED', 'DELIVERED'].map((s, i) => order(`sep-ship-${i}`, s as DashboardOrder['status'], LAST_MONTH)),
  ...Array.from({ length: 11 }, (_, i) => order(`sep-${i}`, 'PAID_PROCESSING', LAST_MONTH)),
]

describe('the numbers and the rows come from one filter', () => {
  it('Total Orders (month to date) equals the rows of All for this month', () => {
    const k = dashboardKpis(ORDERS, NOW.getTime())
    expect(k.totalOrdersMtd).toBe(1)
    expect(ordersForView(ORDERS, 'all', 'mtd', NOW.getTime())).toHaveLength(1)
  })

  it('Shipped (month to date) equals the rows of Shipped for this month: none of September\'s', () => {
    const withOct = [...ORDERS, order('oct-ship', 'SHIPPED', THIS_MONTH), order('oct-deliv', 'DELIVERED', THIS_MONTH)]
    const k = dashboardKpis(withOct, NOW.getTime())
    const rows = ordersForView(withOct, 'shipped', 'mtd', NOW.getTime())
    expect(k.shippedMtd).toBe(2)
    expect(rows.map(o => o.orderId).sort()).toEqual(['oct-deliv', 'oct-ship'])
  })

  it('the month starts at 00:00 UTC on the 1st, as the server counts it', () => {
    expect(monthToDateStart(Date.UTC(2026, 9, 14, 3))).toBe('2026-10-01T00:00:00.000Z')
  })
})

describe('the cards link to their tab with the same period', () => {
  function cards() {
    return render(
      <RevenueSummary totalOrdersMtd={1} totalRevenueCents={10000} pendingPaymentCount={0} expiredPaymentCount={6}
        shippedMtd={0} priorYearOrdersMtd={0} priorYearRevenueCents={0} />,
    )
  }
  it.each([
    ['total-orders', '/dashboard?tab=all&period=mtd'],
    ['revenue', '/dashboard?tab=all&period=mtd'],
    ['shipped', '/dashboard?tab=shipped&period=mtd'],
    ['pending-payment', '/dashboard?tab=awaiting_payment'],
  ])('%s → %s', (id, href) => {
    cards()
    expect(screen.getByTestId(`kpi-card-${id}`)).toHaveAttribute('href', href)
  })

  it('the shipped card says what it counts', () => {
    cards()
    const card = screen.getByTestId('kpi-card-shipped')
    expect(card).toHaveTextContent('Shipped')
    expect(card).toHaveTextContent('Month to date')
    expect(card).not.toHaveTextContent('Delivered this month')
  })
})

describe('the orders list with ?period=mtd', () => {
  function renderDashboard() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    return render(
      <QueryClientProvider client={queryClient}>
        <OrdersDashboard initialOrders={ORDERS} stripeConnectStatus="ACTIVE" clinicId="c0000000-0000-4000-8000-000000000001" />
      </QueryClientProvider>,
    )
  }
  beforeEach(() => { mockReplace.mockClear() })

  it('All shows only this month\'s orders, and its count says so', () => {
    mockSearch = new URLSearchParams('tab=all&period=mtd')
    renderDashboard()
    const table = screen.getByRole('table')
    expect(within(table).getByText('Med oct-1')).toBeInTheDocument()
    expect(within(table).queryByText('Med sep-0')).toBeNull()
    expect(screen.getByRole('tab', { name: /^All/ })).toHaveTextContent(/^All1$/)
  })

  it('shows the period as a filter that can be cleared, keeping the tab', () => {
    mockSearch = new URLSearchParams('tab=shipped&period=mtd')
    renderDashboard()
    expect(screen.getByText('Showing orders created this month')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show all dates' }))
    expect(mockReplace).toHaveBeenCalledWith('/dashboard?tab=shipped', { scroll: false })
  })

  it('without ?period every date is shown, as before', () => {
    mockSearch = new URLSearchParams('tab=all')
    renderDashboard()
    expect(screen.getByRole('tab', { name: /^All/ })).toHaveTextContent(/^All18$/)
    expect(screen.queryByText('Showing orders created this month')).toBeNull()
  })
})
