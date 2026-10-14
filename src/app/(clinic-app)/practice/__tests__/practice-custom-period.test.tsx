/**
 * Click-through, 14 Oct: choosing Practice > Custom hid the cards until
 * both dates were set, and there was no way back. Now Custom opens the
 * date fields beside the periods, the current period's cards stay on
 * screen while dates are chosen, and Cancel closes the fields and keeps
 * (or returns to) the period chosen before. Both dates set: the custom
 * period loads.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PracticeDashboard } from '../_components/practice-dashboard'
import { practiceTotals, breakdown, type PracticeOrder } from '@/lib/practice/metrics'

jest.mock('next/link', () => ({ __esModule: true, default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }))

const ORDERS: PracticeOrder[] = [
  { orderId: 'a', status: 'DELIVERED', createdAt: '2026-09-10T00:00:00Z', retailCents: 19000, wholesaleCents: 9500, shippingFeeCents: 2200, paymentGroupId: null, providerId: 'p1', providerName: 'Sarah Chen', pharmacyId: 'ph', pharmacyName: 'Strive', medicationName: 'Semaglutide' },
  { orderId: 'b', status: 'REFUNDED',  createdAt: '2026-09-10T00:00:00Z', retailCents: 13000, wholesaleCents: 6500, shippingFeeCents: 0,    paymentGroupId: null, providerId: 'p1', providerName: 'Sarah Chen', pharmacyId: 'ph', pharmacyName: 'Strive', medicationName: 'BPC-157' },
  { orderId: 'c', status: 'CANCELLED', createdAt: '2026-09-10T00:00:00Z', retailCents: 11000, wholesaleCents: 5000, shippingFeeCents: 0,    paymentGroupId: null, providerId: 'p1', providerName: 'Sarah Chen', pharmacyId: 'ph', pharmacyName: 'Strive', medicationName: 'NAD+' },
]

function okBody() {
  return {
    period: { key: '30d', from: '', to: '' },
    numbers: { ok: true, data: {
      totals: practiceTotals(ORDERS, [], { absorbShipping: false }),
      breakdowns: { provider: breakdown(ORDERS, 'provider'), pharmacy: breakdown(ORDERS, 'pharmacy'), medication: breakdown(ORDERS, 'medication') },
    } },
    attention: { ok: true, data: { items: [
      { kind: 'reprice', orderId: 'd1', title: 'Pharmacy price changed since the draft was saved', detail: 'Semaglutide — Alex Demo: $95.00 → $110.00', href: '/new-prescription/search?editOrder=d1', hrefLabel: 'Edit the line to confirm the price', since: null },
    ], errors: [] } },
  }
}

let responses: Array<{ status: number; body: unknown }> = []
beforeEach(() => {
  responses = []
  global.fetch = jest.fn(async () => {
    const next = responses.shift() ?? { status: 200, body: okBody() }
    return { ok: next.status < 400, status: next.status, json: async () => next.body } as unknown as Response
  }) as unknown as typeof fetch
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { jest.restoreAllMocks() })

describe('Practice > Custom period', () => {
  const calls = () => (global.fetch as jest.Mock).mock.calls.map(c => String(c[0]))

  it('choosing Custom keeps the cards visible and offers Cancel', async () => {
    render(<PracticeDashboard viewerIsProvider={false} />)
    expect(await screen.findByTestId('practice-revenue')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('period-custom'))
    expect(screen.getByLabelText('From')).toBeInTheDocument()
    expect(screen.getByLabelText('To')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(screen.getByTestId('practice-revenue')).toBeInTheDocument()
    expect(screen.queryByText('Loading…')).toBeNull()
    expect(calls()).toEqual(['/api/practice?period=30d'])
  })

  it('Cancel closes the date fields and keeps the period chosen before', async () => {
    render(<PracticeDashboard viewerIsProvider={false} />)
    await screen.findByTestId('practice-revenue')
    fireEvent.click(screen.getByTestId('period-custom'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('From')).toBeNull()
    expect(screen.getByTestId('period-30d')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('period-custom')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('practice-revenue')).toBeInTheDocument()
    expect(calls()).toEqual(['/api/practice?period=30d'])
  })

  it('both dates set: the custom period loads; Cancel then returns to the period before', async () => {
    render(<PracticeDashboard viewerIsProvider={false} />)
    await screen.findByTestId('practice-revenue')
    fireEvent.click(screen.getByTestId('period-custom'))
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-09-01' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-09-30' } })
    await waitFor(() => expect(calls()).toContain('/api/practice?period=custom&from=2026-09-01&to=2026-09-30'))
    expect(await screen.findByTestId('practice-revenue')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByTestId('period-30d')).toHaveAttribute('aria-pressed', 'true')
    await screen.findByTestId('practice-revenue')
  })
})
