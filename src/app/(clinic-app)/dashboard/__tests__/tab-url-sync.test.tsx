/**
 * Prod, 5 Oct, as dr.chen: the KPI cards link to /dashboard?tab=…, but
 * clicking one changed the URL and left the orders tab on "All" with every
 * row showing. Loading /dashboard?tab=awaiting_payment directly did too.
 *
 * The selected tab was useState(initialTab): read once, from the server's
 * props. A card click is a client navigation to the same route — Next
 * keeps the component, so the state never saw the new ?tab=.
 *
 * Now the tab follows ?tab= on first load and on every client navigation,
 * clicking a tab writes ?tab= with router.replace (not push, so Back does
 * not walk through tabs), other params are kept, and an unknown value
 * falls back to All.
 */

import { render, screen, fireEvent, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { OrdersDashboard } from '../_components/orders-dashboard'
import type { DashboardOrder } from '../page'

const mockReplace = jest.fn()
const mockPush = jest.fn()
let mockSearch = new URLSearchParams()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, refresh: jest.fn() }),
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

const CLINIC = 'c0000000-0000-4000-8000-000000000001'
const HOUR = 60 * 60 * 1000

function order(over: Partial<DashboardOrder> = {}): DashboardOrder {
  return {
    orderId: 'order-1', patientName: 'Demo, Alex', medicationName: 'Semaglutide',
    status: 'DELIVERED', submissionTier: 'TIER_4_FAX',
    createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-02T10:00:00.000Z',
    retailCents: 23100, wholesaleCents: 9500, platformFeeCents: 2040, clinicPayoutCents: 11560,
    isOverdue48h: false, paymentGroupId: null, providerId: 'prov-1',
    ...over,
  }
}

const ORDERS = [
  order({ orderId: 'o-paid', medicationName: 'Delivered Med', status: 'DELIVERED' }),
  order({ orderId: 'o-open', medicationName: 'Open Link Med', status: 'AWAITING_PAYMENT', lockedAt: new Date(Date.now() - 2 * HOUR).toISOString() }),
  order({ orderId: 'o-shipped', medicationName: 'Shipped Med', status: 'SHIPPED' }),
]

function tree(initialTab: Parameters<typeof OrdersDashboard>[0]['initialTab'] = null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return (
    <QueryClientProvider client={queryClient}>
      <OrdersDashboard initialOrders={ORDERS} stripeConnectStatus="ACTIVE" clinicId={CLINIC} initialTab={initialTab} />
    </QueryClientProvider>
  )
}

const tab = (name: RegExp) => screen.getByRole('tab', { name })
const rows = () => screen.getByRole('table')

beforeEach(() => {
  jest.clearAllMocks()
  mockSearch = new URLSearchParams()
})

describe('the tab follows ?tab=', () => {
  it('on first load, from the URL itself (not only the server prop)', () => {
    mockSearch = new URLSearchParams('tab=awaiting_payment')
    render(tree(null))
    expect(tab(/Pending Payment/)).toHaveAttribute('aria-selected', 'true')
    expect(within(rows()).getByText('Open Link Med')).toBeInTheDocument()
    expect(within(rows()).queryByText('Delivered Med')).toBeNull()
    expect(within(rows()).queryByText('Shipped Med')).toBeNull()
  })

  it('on a client navigation to the same route (a KPI card click)', () => {
    const view = render(tree(null))
    expect(tab(/^All/)).toHaveAttribute('aria-selected', 'true')

    mockSearch = new URLSearchParams('tab=shipped')
    view.rerender(tree(null))
    expect(tab(/Shipped/)).toHaveAttribute('aria-selected', 'true')
    expect(within(rows()).getByText('Shipped Med')).toBeInTheDocument()
    expect(within(rows()).queryByText('Delivered Med')).not.toBeNull() // DELIVERED is in Shipped
    expect(within(rows()).queryByText('Open Link Med')).toBeNull()

    mockSearch = new URLSearchParams('tab=all')
    view.rerender(tree(null))
    expect(tab(/^All/)).toHaveAttribute('aria-selected', 'true')
    expect(within(rows()).getByText('Open Link Med')).toBeInTheDocument()
  })

  it('an unknown value falls back to All', () => {
    mockSearch = new URLSearchParams('tab=bogus')
    render(tree(null))
    expect(tab(/^All/)).toHaveAttribute('aria-selected', 'true')
  })
})

describe('clicking a tab writes ?tab=', () => {
  it('with replace, not push', () => {
    render(tree(null))
    fireEvent.click(tab(/Pending Payment/))
    expect(tab(/Pending Payment/)).toHaveAttribute('aria-selected', 'true')
    expect(mockReplace).toHaveBeenCalledWith('/dashboard?tab=awaiting_payment', { scroll: false })
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('keeps the other params (the provider clinic view)', () => {
    mockSearch = new URLSearchParams('view=clinic')
    render(tree(null))
    fireEvent.click(tab(/Shipped/))
    expect(mockReplace).toHaveBeenCalledWith('/dashboard?view=clinic&tab=shipped', { scroll: false })
  })
})
