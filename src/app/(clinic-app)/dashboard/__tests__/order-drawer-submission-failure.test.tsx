/**
 * When sending an order to the pharmacy failed (SUBMISSION_FAILED,
 * FAX_FAILED, PHARMACY_REJECTED), the clinic order drawer says why in
 * plain words and what happens next, from
 * GET /api/orders/[orderId]/failure-reason. Other states do not ask.
 * axe clean.
 */

import { render, screen, waitFor } from '@testing-library/react'
import { configureAxe } from 'jest-axe'
import { OrderDrawer } from '../_components/order-drawer'
import type { DashboardOrder } from '../page'

jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }) }))
jest.mock('@/lib/notifications', () => ({ notify: { success: jest.fn(), error: jest.fn() } }))
jest.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({ then: (resolve: (result: { data: unknown[] }) => void) => resolve({ data: [] }) }),
        }),
      }),
    }),
  }),
}))

const order: DashboardOrder = {
  orderId:           '45e03578-e208-468d-a35b-ab9bc82320ae',
  patientName:       'Demo, Alex',
  medicationName:    'Semaglutide Injectable 5 mg/mL',
  status:            'SUBMISSION_FAILED',
  submissionTier:    'TIER_1_API',
  createdAt:         '2026-10-10T08:00:00.000Z',
  updatedAt:         '2026-10-10T08:00:00.000Z',
  retailCents:       23100,
  wholesaleCents:    9500,
  platformFeeCents:  2040,
  clinicPayoutCents: 11560,
  isOverdue48h:      false,
  paymentGroupId:    null,
}

const FAILURE = { code: 'REJECTED', plainReason: 'the pharmacy declined the order', pharmacyName: 'Strive Pharmacy', at: '2026-10-24T10:01:00Z' }
let fetchMock: jest.Mock

beforeEach(() => {
  fetchMock = jest.fn((url: string) => Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve(String(url).endsWith('/failure-reason') ? { failure: FAILURE } : {}),
  }))
  global.fetch = fetchMock as unknown as typeof fetch
})

const failureCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/failure-reason'))

it.each(['SUBMISSION_FAILED', 'FAX_FAILED', 'PHARMACY_REJECTED'] as const)('%s: says why, in plain words, and what happens next', async status => {
  render(<OrderDrawer order={{ ...order, status }} onClose={() => {}} onGroupCreated={() => {}} />)
  const notice = await screen.findByTestId('submission-failure')
  expect(notice).toHaveTextContent('Sending to Strive Pharmacy failed: the pharmacy declined the order. CompoundIQ ops has been alerted and will re-route or retry.')
  expect(notice).toHaveAttribute('role', 'status')
  expect(failureCalls()[0]![0]).toBe(`/api/orders/${order.orderId}/failure-reason`)
})

it('never shows the raw code', async () => {
  render(<OrderDrawer order={order} onClose={() => {}} onGroupCreated={() => {}} />)
  const notice = await screen.findByTestId('submission-failure')
  expect(notice.textContent).not.toContain('REJECTED')
})

it('the route failing still tells the clinic what happens next', async () => {
  fetchMock.mockImplementation((url: string) => Promise.resolve(
    String(url).endsWith('/failure-reason') ? { ok: false, status: 500, json: () => Promise.resolve({ error: 'x' }) } : { ok: true, status: 200, json: () => Promise.resolve({}) },
  ))
  render(<OrderDrawer order={order} onClose={() => {}} onGroupCreated={() => {}} />)
  expect(await screen.findByTestId('submission-failure')).toHaveTextContent('Sending to the pharmacy failed. CompoundIQ ops has been alerted and will re-route or retry.')
})

it('other states do not ask and show nothing', async () => {
  render(<OrderDrawer order={{ ...order, status: 'SHIPPED' }} onClose={() => {}} onGroupCreated={() => {}} />)
  await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument())
  expect(failureCalls()).toHaveLength(0)
  expect(screen.queryByTestId('submission-failure')).not.toBeInTheDocument()
})

it('axe clean with the failure line', async () => {
  const { container } = render(<main><OrderDrawer order={order} onClose={() => {}} onGroupCreated={() => {}} /></main>)
  await screen.findByTestId('submission-failure')
  const axe = configureAxe({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } })
  expect((await axe(container)).violations.map(v => v.id)).toEqual([])
})
