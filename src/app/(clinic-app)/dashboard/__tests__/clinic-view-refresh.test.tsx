/**
 * "All clinic orders" only half-refreshed (found on prod, 2026-09-25).
 *
 * As Dr. Chen, the toggle re-rendered the page server-side: the stat
 * cards went 13 → 21, but the table and the tab counts stayed at 13
 * until a full reload. They came from a client query cached under a key
 * that did not include the view, seeded once, and polled without the
 * clinic-view header. The table and tab counts must follow the toggle in
 * both directions, without a reload, and the poll must ask for the view
 * on screen.
 */

import { render, screen, within, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { OrdersDashboard } from '../_components/orders-dashboard'
import type { DashboardOrder } from '../page'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}))
const mockCreateBrowserClient = jest.fn((..._args: unknown[]) => ({
  from: () => ({ select: () => ({ eq: () => ({ is: () => ({ order: () => new Promise(() => {}) }) }) }) }),
}))
jest.mock('@/lib/supabase/client', () => ({
  createBrowserClient: (...args: unknown[]) => mockCreateBrowserClient(...args),
}))

const CLINIC = 'c0000000-0000-4000-8000-000000000001'
const ME = 'prov-chen'
const oid = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function order(n: number, over: Partial<DashboardOrder> = {}): DashboardOrder {
  return {
    orderId: oid(n), patientName: 'Demo, Alex', medicationName: `Med ${n}`,
    status: 'DRAFT', submissionTier: 'TIER_2_PORTAL',
    createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-02T10:00:00.000Z',
    retailCents: 20000, wholesaleCents: 10000, platformFeeCents: 1500, clinicPayoutCents: 8500,
    isOverdue48h: false, paymentGroupId: null, providerId: ME,
    ...over,
  }
}

const MINE = Array.from({ length: 13 }, (_, i) => order(i + 1))
const CLINIC_WIDE = [...MINE, ...Array.from({ length: 8 }, (_, i) => order(100 + i, { providerId: 'prov-patel', medicationName: `Colleague ${i}` }))]

const allTabCount = () => within(screen.getByRole('tab', { name: /^All/ })).getByText(/^\d+$/).textContent

function view(orders: DashboardOrder[], mode: 'mine' | 'clinic') {
  return (
    <OrdersDashboard
      initialOrders={orders}
      stripeConnectStatus="ACTIVE"
      clinicId={CLINIC}
      initialTab="all"
      viewer={{ isProvider: true, providerId: ME }}
      providerViewMode={mode}
    />
  )
}

beforeEach(() => jest.clearAllMocks())

describe('the table and tab counts follow the view toggle', () => {
  it('My patients → All clinic orders → My patients, without a reload', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { rerender } = render(<QueryClientProvider client={client}>{view(MINE, 'mine')}</QueryClientProvider>)
    expect(allTabCount()).toBe('13')
    expect(screen.queryByText('Colleague 0')).not.toBeInTheDocument()

    // The toggle's server re-render hands down the clinic-wide orders.
    rerender(<QueryClientProvider client={client}>{view(CLINIC_WIDE, 'clinic')}</QueryClientProvider>)
    await waitFor(() => expect(allTabCount()).toBe('21'))
    expect(screen.getByText('Colleague 0')).toBeInTheDocument()

    // And back.
    rerender(<QueryClientProvider client={client}>{view(MINE, 'mine')}</QueryClientProvider>)
    await waitFor(() => expect(allTabCount()).toBe('13'))
    expect(screen.queryByText('Colleague 0')).not.toBeInTheDocument()
  })

  it('the 30-second poll asks for the view on screen', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}>{view(CLINIC_WIDE, 'clinic')}</QueryClientProvider>)
    expect(mockCreateBrowserClient).toHaveBeenCalledWith({ extraHeaders: { 'x-provider-view-mode': 'clinic' } })
  })
})
