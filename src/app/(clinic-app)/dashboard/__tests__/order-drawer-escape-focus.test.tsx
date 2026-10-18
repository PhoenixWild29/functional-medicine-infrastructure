/**
 * Click-through, 14 Oct: the order drawer could not be closed with
 * Escape, and closing it left focus nowhere. Now Escape closes it (as
 * does the close button), focus moves into the drawer when it opens, and
 * on close it returns to the row that opened it (WCAG 2.1.2, 2.4.3).
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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

const order = (id: string): DashboardOrder => ({
  orderId: id, patientName: `Patient ${id}`, medicationName: `Med ${id}`, status: 'DELIVERED', submissionTier: 'TIER_4_FAX',
  createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-02T10:00:00.000Z',
  retailCents: 100, wholesaleCents: 50, platformFeeCents: 7, clinicPayoutCents: 43,
  isOverdue48h: false, paymentGroupId: null, providerId: 'p', refills: 1, refillOfOrderId: null,
})

beforeEach(() => {
  global.fetch = jest.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })) as unknown as typeof fetch
})

function renderDashboard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  const { container } = render(<QueryClientProvider client={queryClient}><OrdersDashboard initialOrders={[order('a'), order('b')]} stripeConnectStatus="ACTIVE" clinicId="c-1" /></QueryClientProvider>)
  return (id: string) => container.querySelector(`tr[data-order-id="${id}"]`) as HTMLElement
}

it('Escape closes the drawer and focus returns to the row that opened it', async () => {
  const row = renderDashboard()
  row('b').focus()
  fireEvent.keyDown(row('b'), { key: 'Enter' })
  const dialog = await screen.findByRole('dialog')
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
  fireEvent.keyDown(document, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  await waitFor(() => expect(document.activeElement).toBe(row('b')))
})

it('the close button returns focus to the row too', async () => {
  const row = renderDashboard()
  fireEvent.click(row('a'))
  fireEvent.click(await screen.findByRole('button', { name: 'Close drawer' }))
  await waitFor(() => expect(document.activeElement).toBe(row('a')))
})
