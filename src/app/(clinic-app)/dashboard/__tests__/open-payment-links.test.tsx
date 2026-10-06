/**
 * Prod, 5 Oct: the Pending Payment card read "6 Open payment links" and
 * every one of the 6 had expired. Only a link still payable — not
 * expired, not paid, not cancelled — is open. Expired ones are shown as a
 * small "N expired" line under the card, and the Pending Payment tab's
 * count uses the same rule, so the number and the badge agree.
 */

import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { OrdersDashboard } from '../_components/orders-dashboard'
import { RevenueSummary } from '../_components/revenue-summary'
import type { DashboardOrder } from '../page'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
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

const HOUR = 60 * 60 * 1000
const ago = (h: number) => new Date(Date.now() - h * HOUR).toISOString()

function order(over: Partial<DashboardOrder>): DashboardOrder {
  return {
    orderId: 'order-1', patientName: 'Demo, Alex', medicationName: 'Semaglutide',
    status: 'AWAITING_PAYMENT', submissionTier: 'TIER_4_FAX',
    createdAt: ago(1), updatedAt: ago(1),
    retailCents: 23100, wholesaleCents: 9500, platformFeeCents: 2040, clinicPayoutCents: 11560,
    isOverdue48h: false, paymentGroupId: null, providerId: 'prov-1',
    ...over,
  }
}

function cards(pending: number, expired: number) {
  return render(
    <RevenueSummary
      totalOrdersMtd={12}
      totalRevenueCents={250000}
      pendingPaymentCount={pending}
      expiredPaymentCount={expired}
      completedMtd={7}
      priorYearOrdersMtd={8}
      priorYearRevenueCents={180000}
    />,
  )
}

describe('the Pending Payment card', () => {
  it('six expired links: no open links, and "6 expired" under it', () => {
    cards(0, 6)
    const card = screen.getByTestId('kpi-card-pending-payment')
    expect(card).toHaveTextContent('—')
    expect(card).toHaveTextContent('Open payment links')
    expect(screen.getByTestId('kpi-pending-payment-expired')).toHaveTextContent('6 expired')
  })

  it('no expired line when none have expired', () => {
    cards(2, 0)
    expect(screen.getByTestId('kpi-card-pending-payment')).toHaveTextContent('2')
    expect(screen.queryByTestId('kpi-pending-payment-expired')).toBeNull()
  })
})

describe('the Pending Payment tab count', () => {
  it('counts only open links, while the tab still lists the expired ones', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    render(
      <QueryClientProvider client={queryClient}>
        <OrdersDashboard
          initialOrders={[
            order({ orderId: 'o-open', medicationName: 'Open Med', lockedAt: ago(2) }),
            order({ orderId: 'o-stale', medicationName: 'Stale Med', lockedAt: ago(96), createdAt: ago(96) }),
            order({ orderId: 'o-expired', medicationName: 'Expired Med', status: 'PAYMENT_EXPIRED', lockedAt: ago(200), createdAt: ago(200) }),
          ]}
          stripeConnectStatus="ACTIVE"
          clinicId="c0000000-0000-4000-8000-000000000001"
          initialTab="awaiting_payment"
        />
      </QueryClientProvider>,
    )
    const pendingTab = screen.getByRole('tab', { name: /Pending Payment/ })
    expect(pendingTab).toHaveTextContent(/^Pending Payment1$/)
    const table = screen.getByRole('table')
    for (const name of ['Open Med', 'Stale Med', 'Expired Med']) expect(within(table).getByText(name)).toBeInTheDocument()
  })
})
