/**
 * @jest-environment jsdom
 *
 * B-2026-10-26-08: when the dashboard shows only the newest orders (the
 * first render and the 30-second poll share one bound, lib/dashboard/
 * order-window), it says so and links to the older ones; with a ?before=
 * cursor it says which orders it shows and links back to the most recent.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { OrdersDashboard } from '../_components/orders-dashboard'
import type { DashboardOrder } from '../page'
import type { OrderWindow } from '@/lib/dashboard/order-window'

let mockSearch = new URLSearchParams()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => mockSearch,
  usePathname: () => '/dashboard',
}))

const order = (id: string): DashboardOrder => ({
  orderId: `d1000000-0000-0000-0000-00000000000${id}`, patientName: `Demo, ${id}`, medicationName: `Med ${id}`, status: 'DELIVERED',
  submissionTier: 'TIER_4_FAX', createdAt: '2026-10-20T08:00:00Z', updatedAt: '2026-10-20T08:00:00Z',
  retailCents: 100, wholesaleCents: 50, platformFeeCents: 0, clinicPayoutCents: 50, isOverdue48h: false, paymentGroupId: null, providerId: 'p',
})

function renderWith(orderWindow: OrderWindow | undefined) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, refetchInterval: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <OrdersDashboard initialOrders={[order('1'), order('2')]} stripeConnectStatus="ACTIVE" clinicId="c0000000-0000-4000-8000-000000000001" {...(orderWindow ? { orderWindow } : {})} />
    </QueryClientProvider>,
  )
}

beforeEach(() => { mockSearch = new URLSearchParams() })

it('not cut: no note', () => {
  renderWith({ limit: 1000, truncated: false, before: null, olderBefore: null })
  expect(screen.queryByTestId('orders-window-note')).toBeNull()
})

it('cut: "Showing the most recent 1,000 orders" and a link to the older ones, keeping the view and tab', () => {
  mockSearch = new URLSearchParams('view=clinic&tab=shipped')
  renderWith({ limit: 1000, truncated: true, before: null, olderBefore: '2026-10-01T08:00:00.123456+00:00' })
  const note = screen.getByTestId('orders-window-note')
  expect(note).toHaveTextContent('Showing the most recent 1,000 orders.')
  const link = screen.getByRole('link', { name: 'Show older orders' })
  const u = new URL(link.getAttribute('href')!, 'https://app.test')
  expect(u.pathname).toBe('/dashboard')
  expect(u.searchParams.get('before')).toBe('2026-10-01T08:00:00.123456+00:00')
  expect(u.searchParams.get('view')).toBe('clinic')
  expect(u.searchParams.get('tab')).toBe('shipped')
})

it('with a cursor: which orders are shown, the next older page when cut, and the way back', () => {
  mockSearch = new URLSearchParams('before=2026-10-01T08:00:00Z')
  renderWith({ limit: 1000, truncated: true, before: '2026-10-01T08:00:00Z', olderBefore: '2026-09-01T08:00:00Z' })
  const note = screen.getByTestId('orders-window-note')
  expect(note).toHaveTextContent(/Showing 1,000 orders last updated before /)
  expect(screen.getByRole('link', { name: 'Show older orders' }).getAttribute('href')).toContain('before=2026-09-01T08%3A00%3A00Z')
  const back = screen.getByRole('link', { name: 'Back to the most recent orders' })
  expect(new URL(back.getAttribute('href')!, 'https://app.test').searchParams.has('before')).toBe(false)
})

it('with a cursor and nothing older: no "Show older orders", but the way back', () => {
  mockSearch = new URLSearchParams('before=2026-10-01T08:00:00Z')
  renderWith({ limit: 1000, truncated: false, before: '2026-10-01T08:00:00Z', olderBefore: null })
  expect(screen.getByTestId('orders-window-note')).toHaveTextContent(/orders last updated before /)
  expect(screen.queryByRole('link', { name: 'Show older orders' })).toBeNull()
  expect(screen.getByRole('link', { name: 'Back to the most recent orders' })).toBeInTheDocument()
})

it('the page and the poll use the same window (one bound, one helper)', () => {
  const root = join(__dirname, '../../../../..')
  const page = readFileSync(join(root, 'src/app/(clinic-app)/dashboard/page.tsx'), 'utf8')
  const poll = readFileSync(join(root, 'src/app/api/dashboard/orders/route.ts'), 'utf8')
  for (const src of [page, poll]) {
    expect(src).toMatch(/from '@\/lib\/dashboard\/order-window'/)
    expect(src).toMatch(/DASHBOARD_ORDER_LIMIT|windowOrders/)
  }
  expect(poll).not.toMatch(/POLL_ORDER_LIMIT\s*=\s*\d/)
})
