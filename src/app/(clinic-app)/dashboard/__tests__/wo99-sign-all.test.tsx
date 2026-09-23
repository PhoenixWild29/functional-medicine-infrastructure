/**
 * WO-99: Drafts tab — "Sign all (N)" and per-row checkboxes.
 *
 * N counts only drafts where the signed-in provider IS the signer. A draft
 * under another provider goes through Sign as me (WO-100) first: it is not
 * counted, cannot be ticked, and is never signed under their name.
 */

import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { OrdersDashboard } from '../_components/orders-dashboard'
import type { DashboardOrder } from '../page'

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), refresh: jest.fn() }),
}))
jest.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ is: () => ({ order: () => new Promise(() => {}) }) }) }) }),
  }),
}))

const CLINIC = 'c0000000-0000-4000-8000-000000000001'
const ME = 'prov-chen'
const THEM = 'prov-patel'
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

function renderDashboard(orders: DashboardOrder[], viewer = { isProvider: true, providerId: ME as string | null }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <OrdersDashboard initialOrders={orders} stripeConnectStatus="ACTIVE" clinicId={CLINIC} initialTab="drafts" viewer={viewer} />
    </QueryClientProvider>,
  )
}

beforeEach(() => jest.clearAllMocks())

describe('Drafts tab — Sign all', () => {
  it("counts only the provider's own drafts and opens the batch page with them pre-selected", () => {
    renderDashboard([order(1), order(2), order(3, { providerId: THEM }), order(4, { status: 'AWAITING_PAYMENT' })])
    const button = screen.getByTestId('sign-all-drafts')
    expect(button).toHaveTextContent('Sign all (2)')
    fireEvent.click(button)
    expect(mockPush).toHaveBeenCalledWith(`/new-prescription/sign?orders=${oid(1)},${oid(2)}`)
  })

  it("another provider's draft has no checkbox", () => {
    renderDashboard([order(1), order(3, { providerId: THEM })])
    expect(screen.getByTestId(`select-draft-${oid(1)}`)).toBeInTheDocument()
    expect(screen.queryByTestId(`select-draft-${oid(3)}`)).not.toBeInTheDocument()
  })

  it('ticking rows offers Sign selected (k) with exactly those drafts', () => {
    renderDashboard([order(1), order(2), order(5)])
    expect(screen.queryByTestId('sign-selected-drafts')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId(`select-draft-${oid(2)}`))
    fireEvent.click(screen.getByTestId(`select-draft-${oid(5)}`))
    const selected = screen.getByTestId('sign-selected-drafts')
    expect(selected).toHaveTextContent('Sign selected (2)')
    fireEvent.click(selected)
    expect(mockPush).toHaveBeenCalledWith(`/new-prescription/sign?orders=${oid(2)},${oid(5)}`)
  })

  it('ticking a checkbox does not open the order drawer', () => {
    renderDashboard([order(1)])
    fireEvent.click(screen.getByTestId(`select-draft-${oid(1)}`))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('a non-provider (MA / clinic admin) gets no Sign all and no checkboxes', () => {
    renderDashboard([order(1), order(2)], { isProvider: false, providerId: null })
    expect(screen.queryByTestId('sign-all-drafts')).not.toBeInTheDocument()
    expect(screen.queryByTestId(`select-draft-${oid(1)}`)).not.toBeInTheDocument()
  })
})
