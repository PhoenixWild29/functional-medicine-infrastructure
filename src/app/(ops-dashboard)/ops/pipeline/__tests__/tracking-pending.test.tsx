/**
 * Decision 10, tracking A: SHIPPED stays allowed without tracking (a
 * pharmacy webhook may not send it), so ops see "Tracking pending" on a
 * shipped order that has none: in the pipeline row and in the order drawer.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { OrderDetailDrawer } from '../_components/order-detail-drawer'
import { trackingPending } from '@/lib/orders/tracking-pending'
import { OPS_ACCESS_REASONS } from '@/lib/audit/ops-access-reason'
import type { PipelineOrder } from '@/types/pipeline'

it('trackingPending: shipped with no tracking number only', () => {
  expect(trackingPending('SHIPPED', null)).toBe(true)
  expect(trackingPending('SHIPPED', '  ')).toBe(true)
  expect(trackingPending('SHIPPED', '1Z999')).toBe(false)
  expect(trackingPending('READY_TO_SHIP', null)).toBe(false)
  expect(trackingPending('DELIVERED', null)).toBe(false)
})

const ORDER = 'd1000000-0000-4000-8000-000000000001'
const order: PipelineOrder = {
  orderId: ORDER, orderNumber: null, status: 'SHIPPED', clinicId: 'c-1', clinicName: 'Sunrise',
  pharmacyId: 'ph-1', pharmacyName: 'Portal Plus', pharmacyTier: 'TIER_2_PORTAL', submissionTier: 'TIER_2_PORTAL',
  rerouteCount: 0, trackingNumber: null, carrier: null, stripePaymentIntentId: null,
  createdAt: '2026-10-06T10:00:00Z', updatedAt: '2026-10-06T10:00:00Z', opsAssignee: null,
  nearestSlaDeadline: null, hasSlaBreached: false,
}

it('the drawer says "Tracking pending" for a shipped order with no tracking', async () => {
  global.fetch = jest.fn(async () => ({
    ok: true, status: 200,
    json: async () => ({ order: { orderId: ORDER, status: 'SHIPPED', clinicName: 'Sunrise', rerouteCount: 0, trackingNumber: null, carrier: null, createdAt: '2026-10-06T10:00:00Z', updatedAt: '2026-10-06T10:00:00Z' }, history: [], submissions: [], slas: [] }),
  })) as unknown as typeof fetch
  render(<OrderDetailDrawer order={order} onClose={() => undefined} onAction={async () => undefined} currentUserEmail={null} />)
  fireEvent.click(screen.getByLabelText(OPS_ACCESS_REASONS[0]!.label))
  fireEvent.click(screen.getByRole('button', { name: 'Open order' }))
  await waitFor(() => expect(screen.getByText('Tracking pending')).toBeInTheDocument())
})
