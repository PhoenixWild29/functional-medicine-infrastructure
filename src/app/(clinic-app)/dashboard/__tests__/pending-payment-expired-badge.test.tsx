/**
 * Click-through, 14 Oct: the Pending Payment tab showed no count but held
 * six rows, all expired links. The tab keeps its open-link count (the
 * card's number) and shows the expired ones as a separate "N expired"
 * badge, so every row in the tab is counted, as on the other tabs.
 */

import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { OrdersDashboard } from '../_components/orders-dashboard'
import type { DashboardOrder } from '../page'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams('tab=awaiting_payment'),
  usePathname: () => '/dashboard',
}))
jest.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ is: () => ({ order: () => Promise.resolve({ data: null, error: { message: 'offline in test' } }) }) }) }) }),
  }),
}))

const HOUR = 60 * 60 * 1000
const ago = (h: number) => new Date(Date.now() - h * HOUR).toISOString()
const order = (id: string, over: Partial<DashboardOrder>): DashboardOrder => ({
  orderId: id, patientName: 'Demo, Alex', medicationName: `Med ${id}`, status: 'PAYMENT_EXPIRED', submissionTier: 'TIER_4_FAX',
  createdAt: ago(200), updatedAt: ago(200), lockedAt: ago(200),
  retailCents: 100, wholesaleCents: 50, platformFeeCents: 7, clinicPayoutCents: 43,
  isOverdue48h: true, paymentGroupId: null, providerId: 'p', ...over,
})

function renderWith(orders: DashboardOrder[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  render(<QueryClientProvider client={queryClient}><OrdersDashboard initialOrders={orders} stripeConnectStatus="ACTIVE" clinicId="c-1" /></QueryClientProvider>)
  return screen.getByRole('tab', { name: /Pending Payment/ })
}

it('six expired links: the tab says "6 expired"', () => {
  const tab = renderWith(Array.from({ length: 6 }, (_, i) => order(`x${i}`, {})))
  expect(tab).toHaveTextContent('6 expired')
  expect(screen.getAllByRole('row')).toHaveLength(7) // header + six
})

it('open and expired: the open count, then the expired count', () => {
  const tab = renderWith([
    order('open', { status: 'AWAITING_PAYMENT', lockedAt: ago(1), createdAt: ago(1) }),
    order('e1', {}), order('e2', {}),
  ])
  expect(tab).toHaveTextContent(/^Pending Payment12 expired$/)
})

it('no expired badge when none have expired', () => {
  const tab = renderWith([order('open', { status: 'AWAITING_PAYMENT', lockedAt: ago(1), createdAt: ago(1) })])
  expect(tab).toHaveTextContent(/^Pending Payment1$/)
})
