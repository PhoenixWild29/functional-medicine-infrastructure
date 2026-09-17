/**
 * WO-106: the dashboard's three actions, the view label, and KPI cards
 * that take you where they point.
 *
 * Lauren Perkins, 2026-09-11 (01:34:34): "there should be like new
 * prescription, new protocol, and then there probably needs to be a
 * button for refill". (01:33:41): "Most people Sam I don't think are
 * going to know canban."
 *
 * Anila Coniku-Nicklos, 2026-09-11 (01:32:09): "I was going to click
 * under the total orders … It takes you right there."
 */

import { render, screen, fireEvent, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { OrdersDashboard } from '../_components/orders-dashboard'
import { RevenueSummary } from '../_components/revenue-summary'
import type { DashboardOrder } from '../page'

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), refresh: jest.fn() }),
}))
jest.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }),
      }),
    }),
  }),
}))

const CLINIC = 'c0000000-0000-4000-8000-000000000001'

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

function renderDashboard(orders: DashboardOrder[] = [order()], initialTab: Parameters<typeof OrdersDashboard>[0]['initialTab'] = null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <OrdersDashboard
        initialOrders={orders}
        stripeConnectStatus="ACTIVE"
        clinicId={CLINIC}
        initialTab={initialTab}
      />
    </QueryClientProvider>,
  )
}

beforeEach(() => jest.clearAllMocks())

describe('the three actions', () => {
  it('shows New Prescription, New Protocol and Refill', () => {
    renderDashboard()
    expect(screen.getByRole('button', { name: '+ New Prescription' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ New Protocol' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refill' })).toBeInTheDocument()
  })

  it('New Protocol opens the flow with the Protocols panel, Refill opens the picker', () => {
    renderDashboard()
    fireEvent.click(screen.getByRole('button', { name: '+ New Protocol' }))
    expect(mockPush).toHaveBeenCalledWith('/new-prescription?panel=protocols')
    fireEvent.click(screen.getByRole('button', { name: 'Refill' }))
    expect(mockPush).toHaveBeenCalledWith('/refill')
  })

  it('all three are behind the Stripe gate — a clinic that cannot take payment cannot prescribe', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    render(
      <QueryClientProvider client={queryClient}>
        <OrdersDashboard initialOrders={[order()]} stripeConnectStatus="PENDING" clinicId={CLINIC} />
      </QueryClientProvider>,
    )
    expect(screen.getByRole('button', { name: '+ New Prescription' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '+ New Protocol' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Refill' })).toBeDisabled()
  })
})

describe('the view label', () => {
  it('reads Table / Cards — "canban is like a technology term"', () => {
    renderDashboard()
    expect(screen.getByRole('button', { name: 'Table' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cards' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /kanban/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/kanban/i)).not.toBeInTheDocument()
  })
})

describe('a row refills without opening the drawer', () => {
  it('links to the picker with that order pre-selected', () => {
    renderDashboard()
    const link = screen.getByTestId('row-refill-order-1')
    expect(link).toHaveAttribute('href', '/refill?order=order-1')
  })

  it('a draft has nothing to refill — it has not been filled', () => {
    renderDashboard([order({ orderId: 'draft-1', status: 'DRAFT' })])
    expect(screen.queryByTestId('row-refill-draft-1')).not.toBeInTheDocument()
  })
})

describe('the tab is addressable, so a KPI card can point at it', () => {
  it('opens on the tab the URL names', () => {
    renderDashboard([order({ status: 'AWAITING_PAYMENT' })], 'awaiting_payment')
    expect(screen.getByRole('tab', { name: /Pending Payment/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('defaults to All without one', () => {
    renderDashboard()
    expect(screen.getByRole('tab', { name: /^All/ })).toHaveAttribute('aria-selected', 'true')
  })
})

describe('the KPI cards go where they point', () => {
  const cards = () => render(
    <RevenueSummary
      totalOrdersMtd={12}
      totalRevenueCents={250000}
      pendingPaymentCount={3}
      completedMtd={7}
      priorYearOrdersMtd={8}
      priorYearRevenueCents={180000}
    />,
  )

  it('every card is a link to its tab, reachable by keyboard', () => {
    cards()
    expect(screen.getByTestId('kpi-card-total-orders')).toHaveAttribute('href', '/dashboard?tab=all')
    expect(screen.getByTestId('kpi-card-revenue')).toHaveAttribute('href', '/dashboard?tab=all')
    expect(screen.getByTestId('kpi-card-pending-payment')).toHaveAttribute('href', '/dashboard?tab=awaiting_payment')
    expect(screen.getByTestId('kpi-card-completed')).toHaveAttribute('href', '/dashboard?tab=shipped')
    // An <a href> is focusable and Enter-activated by the browser; a div
    // with an onClick is neither, which is why these are links.
    for (const id of ['total-orders', 'revenue', 'pending-payment', 'completed']) {
      expect(screen.getByTestId(`kpi-card-${id}`).tagName).toBe('A')
    }
  })

  it('names what it counts for a screen reader', () => {
    cards()
    expect(screen.getByTestId('kpi-card-pending-payment'))
      .toHaveAccessibleName('Pending Payment: 3. Show these orders.')
  })

  it('still shows the numbers', () => {
    cards()
    // The card rounds to whole dollars, as it did before WO-106.
    expect(within(screen.getByTestId('kpi-card-revenue')).getByText('$2,500')).toBeInTheDocument()
    expect(within(screen.getByTestId('kpi-card-pending-payment')).getByText('3')).toBeInTheDocument()
  })
})
