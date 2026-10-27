/**
 * B13: the ops order drawer asks why before it opens a patient's order.
 * Nothing is fetched until a reason is chosen; the reason goes with the
 * request (x-ops-access-reason), where it is logged with the access.
 * Another order asks again. axe clean.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { configureAxe } from 'jest-axe'
import { OrderDetailDrawer } from '../_components/order-detail-drawer'
import { OPS_ACCESS_REASONS } from '@/lib/audit/ops-access-reason'
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

it('asks for a reason first, and fetches nothing until one is chosen', () => {
  render(drawer(order(ORDER)))
  expect(screen.getByRole('group', { name: 'Why are you opening this order?' })).toBeInTheDocument()
  for (const r of OPS_ACCESS_REASONS) expect(screen.getByLabelText(r.label)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Open order' })).toBeDisabled()
  expect(fetchMock).not.toHaveBeenCalled()
})

it('sends the chosen reason with the request', async () => {
  render(drawer(order(ORDER)))
  fireEvent.click(screen.getByLabelText(OPS_ACCESS_REASONS[0]!.label))
  fireEvent.click(screen.getByRole('button', { name: 'Open order' }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  expect(fetchMock).toHaveBeenCalledWith(`/api/ops/orders/${ORDER}/detail`, {
    headers: { 'x-ops-access-reason': OPS_ACCESS_REASONS[0]!.code },
  })
  expect(screen.queryByRole('group', { name: 'Why are you opening this order?' })).toBeNull()
})

it('says the emergency reason is reviewed within 24 hours', () => {
  render(drawer(order(ORDER)))
  fireEvent.click(screen.getByLabelText(OPS_ACCESS_REASONS.find(r => r.code === 'emergency')!.label))
  expect(screen.getByText(/reviewed within 24 hours/)).toBeInTheDocument()
})

it('another order asks again', async () => {
  const { rerender } = render(drawer(order(ORDER)))
  fireEvent.click(screen.getByLabelText(OPS_ACCESS_REASONS[0]!.label))
  fireEvent.click(screen.getByRole('button', { name: 'Open order' }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  rerender(drawer(order(OTHER)))
  expect(screen.getByRole('group', { name: 'Why are you opening this order?' })).toBeInTheDocument()
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

it('the prompt is axe clean', async () => {
  const { container } = render(drawer(order(ORDER)))
  const axe = configureAxe({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } })
  expect((await axe(container)).violations.map(v => v.id)).toEqual([])
})
