/**
 * Patient Intake PR 2: drafts held for a patient who has not finished
 * intake, on the Dashboard.
 *
 *   - The row says "Awaiting patient details" and offers Resend link.
 *   - It cannot be ticked for signing and is not counted in Sign all: it
 *     would be refused (batch-sign holds it until intake is complete).
 */

import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { OrdersDashboard } from '../_components/orders-dashboard'
import type { DashboardOrder } from '../page'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/dashboard',
}))
jest.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ is: () => ({ order: () => new Promise(() => {}) }) }) }) }),
  }),
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

function renderDashboard(orders: DashboardOrder[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <OrdersDashboard initialOrders={orders} stripeConnectStatus="ACTIVE" clinicId={CLINIC} initialTab="drafts" viewer={{ isProvider: true, providerId: ME }} />
    </QueryClientProvider>,
  )
}

const PENDING = { patientId: 'p-new', patientName: 'New patient (mobile ending 0123)', patientIntakePending: true }

it('a held draft says Awaiting patient details and offers Resend link', () => {
  renderDashboard([order(1, PENDING)])
  const row = screen.getByRole('row', { name: /New patient \(mobile ending 0123\)/ })
  expect(within(row).getByText('Awaiting patient details')).toBeInTheDocument()
  expect(within(row).getByRole('button', { name: 'Resend link' })).toBeInTheDocument()
})

it('a held draft cannot be ticked and is not counted in Sign all', () => {
  renderDashboard([order(1, PENDING), order(2)])
  expect(screen.queryByTestId(`select-draft-${oid(1)}`)).not.toBeInTheDocument()
  expect(screen.getByTestId(`select-draft-${oid(2)}`)).toBeInTheDocument()
  expect(screen.getByTestId('sign-all-drafts')).toHaveTextContent('Sign all (1)')
})

it('a complete patient\'s draft has no intake badge or resend', () => {
  renderDashboard([order(2)])
  expect(screen.queryByText('Awaiting patient details')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Resend link' })).not.toBeInTheDocument()
})

// ── Intake decisions (Oct 10): a possible duplicate is flagged on the row ──
it('a row whose patient may be a duplicate says so, with Dismiss', () => {
  renderDashboard([order(3, { patientName: 'Smith, Jane', patientId: 'p-jane', possibleDuplicate: { patientId: 'p-other', name: 'Jane Smyth' } })])
  const row = screen.getByRole('row', { name: /Smith, Jane/ })
  expect(within(row).getByText('Possible duplicate of Jane Smyth')).toBeInTheDocument()
  expect(within(row).getByRole('button', { name: 'Dismiss possible duplicate of Jane Smyth' })).toBeInTheDocument()
})
