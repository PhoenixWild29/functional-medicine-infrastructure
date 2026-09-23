/**
 * WO-107: the practice dashboard fails loud (#156). Any query that errors
 * shows an error with Retry — never a zero, never an empty table. Retry
 * re-runs the read in place. Refunded and cancelled money is labelled.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PracticeDashboard } from '../_components/practice-dashboard'
import { breakdownCsv, practiceTotals, breakdown, type PracticeOrder } from '@/lib/practice/metrics'

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

describe('PracticeDashboard', () => {
  it('shows the numbers; refunded and cancelled are labelled, not revenue', async () => {
    render(<PracticeDashboard viewerIsProvider={false} />)
    expect(await screen.findByTestId('practice-revenue')).toHaveTextContent('$190.00')
    expect(screen.getByTestId('practice-excluded-refunded')).toHaveTextContent('Refunded — excluded from revenue (1)')
    expect(screen.getByTestId('practice-excluded-refunded')).toHaveTextContent('$130.00')
    expect(screen.getByTestId('practice-excluded-cancelled')).toHaveTextContent('$110.00')
  })

  it('each needs-attention item links to where it is fixed', async () => {
    render(<PracticeDashboard viewerIsProvider={false} />)
    const item = await screen.findByTestId('attention-reprice-d1')
    expect(item.querySelector('a')).toHaveAttribute('href', '/new-prescription/search?editOrder=d1')
  })

  it('the whole read failing: an error with Retry, no zeros; Retry re-reads', async () => {
    responses = [{ status: 500, body: { error: 'boom' } }]
    render(<PracticeDashboard viewerIsProvider={false} />)
    const error = await screen.findByTestId('practice-error')
    expect(screen.queryByTestId('practice-revenue')).not.toBeInTheDocument()
    expect(screen.queryByTestId('practice-table')).not.toBeInTheDocument()
    fireEvent.click(error.querySelector('button')!)
    expect(await screen.findByTestId('practice-revenue')).toHaveTextContent('$190.00')
  })

  it('the numbers failing: an error with Retry in their place, never $0.00', async () => {
    responses = [{ status: 200, body: { ...okBody(), numbers: { ok: false, error: 'Orders could not be read.' } } }]
    render(<PracticeDashboard viewerIsProvider={false} />)
    expect(await screen.findByTestId('practice-numbers-error')).toHaveTextContent('Orders could not be read.')
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument()
    expect(screen.queryByTestId('practice-table')).not.toBeInTheDocument()
  })

  it('the queue failing: an error with Retry, never "Nothing needs attention"', async () => {
    responses = [{ status: 200, body: { ...okBody(), attention: { ok: false, error: 'The needs-attention queue could not be loaded.' } } }]
    render(<PracticeDashboard viewerIsProvider={false} />)
    expect(await screen.findByTestId('practice-attention-error')).toBeInTheDocument()
    expect(screen.queryByTestId('practice-attention-empty')).not.toBeInTheDocument()
  })

  it('some queue checks failing: named, and the list is marked incomplete', async () => {
    const body = okBody()
    body.attention.data.errors = [{ check: 'Refunds', error: 'connection reset' }] as never
    responses = [{ status: 200, body }]
    render(<PracticeDashboard viewerIsProvider={false} />)
    expect(await screen.findByTestId('practice-attention-partial-error')).toHaveTextContent('Refunds: connection reset')
  })

  it('Export CSV writes the table as shown', async () => {
    const created: Blob[] = []
    URL.createObjectURL = jest.fn((b: Blob) => { created.push(b); return 'blob:x' })
    HTMLAnchorElement.prototype.click = jest.fn()
    render(<PracticeDashboard viewerIsProvider={false} />)
    fireEvent.click(await screen.findByTestId('practice-export'))
    await waitFor(() => expect(created).toHaveLength(1))
    const text = await new Promise<string>(resolve => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.readAsText(created[0]!)
    })
    expect(text).toBe(breakdownCsv(breakdown(ORDERS, 'provider'), 'provider'))
  })
})
