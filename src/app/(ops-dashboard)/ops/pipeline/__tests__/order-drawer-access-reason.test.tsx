/**
 * The ops order drawer opens an order directly (2026-10-30): no "why"
 * prompt. It fetches the detail at once with no access reason; the API
 * logs the open as an order view (detail/__tests__/phi-access-log).
 * Another order fetches its own detail. An optional "Emergency access"
 * control reloads the order with the emergency reason (the API logs it and
 * alerts Slack, detail/__tests__/emergency-access); it is never asked.
 * axe clean.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { configureAxe } from 'jest-axe'
import { OrderDetailDrawer } from '../_components/order-detail-drawer'
import type { PipelineOrder } from '@/types/pipeline'

const ORDER = 'd1000000-0000-4000-8000-000000000001'
const OTHER = 'd1000000-0000-4000-8000-000000000002'

function order(orderId: string): PipelineOrder {
  return {
    orderId, orderNumber: null, status: 'PHARMACY_REJECTED', clinicId: 'c-1', clinicName: 'Sunrise',
    pharmacyId: 'ph-1', pharmacyName: 'Portal Plus', pharmacyTier: 'TIER_1_API', submissionTier: 'TIER_1_API',
    rerouteCount: 0, trackingNumber: null, carrier: null, stripePaymentIntentId: null,
    createdAt: '2026-10-06T10:00:00Z', updatedAt: '2026-10-06T10:00:00Z', opsAssignee: null,
    nearestSlaDeadline: null, hasSlaBreached: false,
  }
}

const fetchMock = jest.fn(async () => ({
  ok: true, status: 200,
  json: async () => ({ order: { orderId: ORDER, status: 'PHARMACY_REJECTED', clinicName: 'Sunrise', rerouteCount: 0, createdAt: '2026-10-06T10:00:00Z', updatedAt: '2026-10-06T10:00:00Z' }, history: [], submissions: [], slas: [] }),
}))

beforeEach(() => {
  fetchMock.mockClear()
  global.fetch = fetchMock as unknown as typeof fetch
})

const drawer = (o: PipelineOrder) => (
  <OrderDetailDrawer order={o} onClose={() => undefined} onAction={async () => undefined} currentUserEmail={null} />
)

it('asks nothing, and fetches the order at once with no reason header', async () => {
  render(drawer(order(ORDER)))
  expect(screen.queryByText('Why are you opening this order?')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Open order' })).toBeNull()
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  expect(fetchMock).toHaveBeenCalledWith(`/api/ops/orders/${ORDER}/detail`)
  await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull())
})

it('another order fetches its own detail', async () => {
  const { rerender } = render(drawer(order(ORDER)))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  rerender(drawer(order(OTHER)))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  expect(fetchMock).toHaveBeenLastCalledWith(`/api/ops/orders/${OTHER}/detail`)
})

it('Emergency access: reloads the order with the emergency reason, then says it is recorded', async () => {
  render(drawer(order(ORDER)))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  fireEvent.click(screen.getByRole('button', { name: 'Emergency access' }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  expect(fetchMock).toHaveBeenLastCalledWith(`/api/ops/orders/${ORDER}/detail`, { headers: { 'x-ops-access-reason': 'emergency' } })
  expect(await screen.findByRole('status')).toHaveTextContent(/Emergency access recorded\. It is reviewed within 24 hours/)
  expect(screen.queryByRole('button', { name: 'Emergency access' })).toBeNull()
})

it('Emergency access not recorded (503): says so, and the control stays', async () => {
  render(drawer(order(ORDER)))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  fetchMock.mockImplementationOnce((async () => ({
    ok: false, status: 503,
    json: async () => ({ error: 'This emergency access could not be recorded in the audit log, so the order was not opened. Try again.' }),
  })) as never)
  fireEvent.click(screen.getByRole('button', { name: 'Emergency access' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(/could not be recorded/)
  expect(screen.getByRole('button', { name: 'Emergency access' })).toBeEnabled()
})

it('another order starts without emergency access', async () => {
  const { rerender } = render(drawer(order(ORDER)))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  fireEvent.click(screen.getByRole('button', { name: 'Emergency access' }))
  await screen.findByRole('status')
  rerender(drawer(order(OTHER)))
  expect(screen.getByRole('button', { name: 'Emergency access' })).toBeInTheDocument()
  await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith(`/api/ops/orders/${OTHER}/detail`))
})

it('the drawer is axe clean', async () => {
  const { container } = render(drawer(order(ORDER)))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  const axe = configureAxe({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } })
  expect((await axe(container)).violations.map(v => v.id)).toEqual([])
})
