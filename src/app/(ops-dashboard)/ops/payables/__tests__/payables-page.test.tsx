/**
 * @jest-environment jsdom
 *
 * /ops/payables (ops_admin; auth by middleware and the ops layout):
 * what each pharmacy is owed (wholesale + shipping, less reversals),
 * per-pharmacy totals and per-order lines, mark paid with a reference and
 * date, mark scheduled, and a CSV remittance link per pharmacy and range.
 * Checked with axe. The loader groups and totals the lines.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { configureAxe } from 'jest-axe'
import { scriptedDb } from '@/__tests__/helpers/scripted-db'

const refresh = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh }),
  usePathname: () => '/ops/payables',
}))

import { PayablesBoard } from '../_components/payables-board'
import { loadPayables, type PayablesView } from '@/lib/payments/payables'
import { OpsNav } from '../../_components/ops-nav'

const PH1 = 'f0000000-0000-4000-8000-000000000001'
const PH2 = 'f0000000-0000-4000-8000-000000000002'
const P1 = '10000000-0000-4000-8000-000000000001'
const P2 = '10000000-0000-4000-8000-000000000002'
const P3 = '10000000-0000-4000-8000-000000000003'

const row = (payable_id: string, pharmacy_id: string, status: string, amount: number, reversed = 0, num = 'ORD-1') => ({
  payable_id, pharmacy_id, order_id: `a${payable_id.slice(1)}`, payment_group_id: null, status,
  wholesale_cents: amount - 900, shipping_cents: 900, amount_cents: amount, reversed_cents: reversed,
  paid_on: status === 'paid' ? '2026-10-09' : null, paid_reference: status === 'paid' ? 'ACH-1' : null,
  created_at: '2026-10-02T10:00:00Z', orders: { order_number: num }, pharmacies: { name: pharmacy_id === PH1 ? 'Strive Pharmacy' : 'Empower' },
})

const axe = configureAxe({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })

describe('loadPayables', () => {
  it('groups lines by pharmacy and totals what is owed, scheduled and paid, net of reversals', async () => {
    const db = scriptedDb(c => (c.table === 'pharmacy_payables' ? { data: [
      row(P1, PH1, 'owed', 10900, 0, 'ORD-1001'),
      row(P2, PH1, 'scheduled', 5900, 1000, 'ORD-1002'),
      row(P3, PH2, 'paid', 20900, 0, 'ORD-1003'),
    ] } : undefined))
    const view = await loadPayables(db.client)
    const strive = view.pharmacies.find(p => p.pharmacyId === PH1)!
    expect(strive).toEqual(expect.objectContaining({ name: 'Strive Pharmacy', owedCents: 10900, scheduledCents: 4900, paidCents: 0 }))
    expect(strive.lines.map(l => l.orderNumber)).toEqual(['ORD-1001', 'ORD-1002'])
    expect(view.pharmacies.find(p => p.pharmacyId === PH2)!.paidCents).toBe(20900)
  })

  it('a read error throws (the page shows an error, never empty totals)', async () => {
    const db = scriptedDb(() => ({ error: { message: 'down' } }))
    await expect(loadPayables(db.client)).rejects.toThrow()
  })
})

describe('PayablesBoard', () => {
  const view: PayablesView = {
    pharmacies: [{
      pharmacyId: PH1, name: 'Strive Pharmacy', owedCents: 10900, scheduledCents: 0, paidCents: 0,
      lines: [{ payableId: P1, orderId: 'a1', orderNumber: 'ORD-1001', paymentGroupId: null, status: 'owed', wholesaleCents: 10000, shippingCents: 900, reversedCents: 0, netCents: 10900, paidOn: null, paidReference: null, createdAt: '2026-10-02T10:00:00Z' }],
    }],
  }
  let fetchMock: jest.Mock
  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ updated: 1 }) })
    global.fetch = fetchMock as never
    refresh.mockClear()
  })
  afterEach(() => cleanup())

  it('shows per-pharmacy totals and per-order lines, with no axe violations', async () => {
    const { container } = render(<main><PayablesBoard view={view} /></main>)
    const section = screen.getByRole('region', { name: 'Strive Pharmacy' })
    expect(within(section).getByText('$109.00', { selector: '[data-total="owed"]' })).toBeTruthy()
    expect(within(section).getByText('ORD-1001')).toBeTruthy()
    expect((await axe(container)).violations).toEqual([])
  })

  it('marks the selected lines paid with the reference and date', async () => {
    render(<PayablesBoard view={view} />)
    fireEvent.click(screen.getByLabelText('Select ORD-1001'))
    fireEvent.change(screen.getByLabelText('Payment reference'), { target: { value: 'ACH-20261009-01' } })
    fireEvent.change(screen.getByLabelText('Paid on'), { target: { value: '2026-10-09' } })
    fireEvent.click(screen.getByRole('button', { name: 'Mark paid' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/ops/payables/mark')
    expect(JSON.parse(init.body)).toEqual({ payableIds: [P1], action: 'mark_paid', reference: 'ACH-20261009-01', paidOn: '2026-10-09' })
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it('Mark paid needs a selection and a reference', () => {
    render(<PayablesBoard view={view} />)
    expect((screen.getByRole('button', { name: 'Mark paid' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('links the remittance CSV for the pharmacy and date range', () => {
    render(<PayablesBoard view={view} />)
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-01' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-31' } })
    const link = screen.getByRole('link', { name: 'Download remittance CSV' })
    expect(link.getAttribute('href')).toBe(`/api/ops/payables/remittance?pharmacyId=${PH1}&from=2026-10-01&to=2026-10-31&basis=paid`)
  })
})

it('the ops nav has a Payables tab', () => {
  render(<OpsNav />)
  expect(screen.getByRole('link', { name: 'Payables' }).getAttribute('href')).toBe('/ops/payables')
  cleanup()
})
