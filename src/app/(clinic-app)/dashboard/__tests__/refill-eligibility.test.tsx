/**
 * Click-through, 14 Oct: Refill showed on drafts, expired payment links,
 * cancelled and failed orders, and on prescriptions with no refills
 * authorized it opened a page where everything was disabled.
 *
 *   - Refill (row and drawer) only on orders that were paid or dispensed:
 *     PAID_PROCESSING and the statuses after it on the way to the patient
 *     (submitted, faxed, at the pharmacy, ready, shipped, delivered).
 *   - When the prescription has no refills left (none authorized, or all
 *     used by earlier refills), the row and the drawer say so instead of
 *     linking to /refill.
 *   - /refill offers the same orders as sources (isRefillableStatus).
 */

import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { OrdersDashboard } from '../_components/orders-dashboard'
import { OrderDrawer } from '../_components/order-drawer'
import { isRefillableStatus, refillRowState } from '@/lib/orders/refill'
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
        eq: () => ({
          is: () => ({ order: () => Promise.resolve({ data: null, error: { message: 'offline in test' } }) }),
          order: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
  }),
}))

const order = (id: string, over: Partial<DashboardOrder> = {}): DashboardOrder => ({
  orderId: id, patientName: 'Demo, Alex', medicationName: `Med ${id}`, status: 'DELIVERED', submissionTier: 'TIER_4_FAX',
  createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-02T10:00:00.000Z',
  retailCents: 100, wholesaleCents: 50, platformFeeCents: 7, clinicPayoutCents: 43,
  isOverdue48h: false, paymentGroupId: null, providerId: 'p', refills: 2, refillOfOrderId: null, ...over,
})

const PAID = ['PAID_PROCESSING', 'SUBMISSION_PENDING', 'FAX_QUEUED', 'FAX_DELIVERED', 'PHARMACY_ACKNOWLEDGED', 'PHARMACY_COMPOUNDING', 'PHARMACY_PROCESSING', 'READY_TO_SHIP', 'SHIPPED', 'DELIVERED'] as const
const NOT = ['DRAFT', 'AWAITING_PAYMENT', 'PAYMENT_EXPIRED', 'CANCELLED', 'SUBMISSION_FAILED', 'FAX_FAILED', 'PHARMACY_REJECTED', 'REROUTE_PENDING', 'ERROR_PAYMENT_FAILED', 'ERROR_COMPLIANCE_HOLD', 'REFUND_PENDING', 'REFUNDED', 'DISPUTED'] as const

it.each(PAID)('%s can be refilled', s => expect(isRefillableStatus(s)).toBe(true))
it.each(NOT)('%s cannot', s => expect(isRefillableStatus(s)).toBe(false))

describe('refillRowState', () => {
  it('no refills authorized: says so', () => {
    expect(refillRowState(order('a', { refills: 0 }), [])).toEqual({ kind: 'none_left', message: 'This prescription authorized no refills. Write a new prescription.' })
  })
  it('all used: counted from the loaded refills, void ones not counted', () => {
    const src = order('src', { refills: 1 })
    const used = order('r1', { refillOfOrderId: 'src', status: 'DELIVERED' })
    const voided = order('r2', { refillOfOrderId: 'src', status: 'CANCELLED' })
    expect(refillRowState(src, [src, voided])).toEqual({ kind: 'refill' })
    expect(refillRowState(src, [src, used, voided])).toEqual({ kind: 'none_left', message: 'All 1 authorized refill has been used. Write a new prescription.' })
  })
  it('a refill order counts against its source', () => {
    const src = order('src', { refills: 1 })
    const r1 = order('r1', { refillOfOrderId: 'src' })
    expect(refillRowState(r1, [src, r1]).kind).toBe('none_left')
  })
  it('a source that is not loaded: the link, and /refill decides', () => {
    expect(refillRowState(order('r1', { refillOfOrderId: 'gone' }), []).kind).toBe('refill')
  })
  it('not paid: hidden', () => {
    expect(refillRowState(order('d', { status: 'PAYMENT_EXPIRED' }), []).kind).toBe('hidden')
  })
})

function renderRows(orders: DashboardOrder[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  render(<QueryClientProvider client={queryClient}><OrdersDashboard initialOrders={orders} stripeConnectStatus="ACTIVE" clinicId="c-1" /></QueryClientProvider>)
}

describe('rows', () => {
  it.each(['DRAFT', 'PAYMENT_EXPIRED', 'CANCELLED', 'SUBMISSION_FAILED'] as const)('%s: no Refill', s => {
    renderRows([order('x', { status: s })])
    expect(screen.queryByTestId('row-refill-x')).toBeNull()
  })
  it('delivered with refills left: Refill links to the picker', () => {
    renderRows([order('x')])
    expect(screen.getByTestId('row-refill-x')).toHaveAttribute('href', '/refill?order=x')
  })
  it('delivered with no refills authorized: the row says so, no link', () => {
    renderRows([order('x', { refills: 0 })])
    expect(screen.queryByTestId('row-refill-x')).toBeNull()
    const note = screen.getByTestId('row-no-refills-x')
    expect(note).toHaveTextContent('No refills left')
    expect(note).toHaveAttribute('title', 'This prescription authorized no refills. Write a new prescription.')
  })
})

describe('drawer', () => {
  beforeEach(() => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })) as unknown as typeof fetch
  })
  const renderDrawer = (o: DashboardOrder, all: DashboardOrder[] = [o]) => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={queryClient}><OrderDrawer order={o} allOrders={all} onClose={() => {}} onGroupCreated={() => {}} /></QueryClientProvider>)
    return within(screen.getByRole('dialog'))
  }
  it.each(['DRAFT', 'PAYMENT_EXPIRED', 'CANCELLED', 'SUBMISSION_FAILED'] as const)('%s: no Refill', s => {
    const d = renderDrawer(order('x', { status: s }))
    expect(d.queryByTestId('drawer-refill')).toBeNull()
  })
  it('delivered with refills left: Refill this prescription', () => {
    expect(renderDrawer(order('x')).getByTestId('drawer-refill')).toBeInTheDocument()
  })
  it('no refills authorized: the drawer says so instead', () => {
    const d = renderDrawer(order('x', { refills: 0 }))
    expect(d.queryByTestId('drawer-refill')).toBeNull()
    expect(d.getByTestId('drawer-no-refills')).toHaveTextContent('This prescription authorized no refills. Write a new prescription.')
  })
})
