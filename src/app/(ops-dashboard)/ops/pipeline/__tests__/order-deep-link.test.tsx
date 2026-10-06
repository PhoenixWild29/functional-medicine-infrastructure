/**
 * A Slack alert's "Open in ops" link is /ops/pipeline?order=<id>. Slack
 * carries no patient details or pharmacy text, so ops read them here: the
 * pipeline opens with that order's drawer. Before, alerts linked to
 * /dashboard/orders/<id>, a route that does not exist (and an ops user
 * cannot open the clinic dashboard).
 */

import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PipelineView } from '../_components/pipeline-view'
import type { PipelineOrder } from '@/types/pipeline'

jest.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({ auth: { getUser: async () => ({ data: { user: { email: 'ops@test' } } }) } }),
}))
jest.mock('../_components/order-detail-drawer', () => ({
  OrderDetailDrawer: ({ order }: { order: { orderId: string } | null }) =>
    order ? <div data-testid="drawer">{order.orderId}</div> : null,
}))

const ORDER = 'd1000000-0000-4000-8000-000000000001'
function order(orderId: string): PipelineOrder {
  return {
    orderId, orderNumber: null, status: 'PHARMACY_REJECTED', clinicId: 'c-1', clinicName: 'Sunrise',
    pharmacyId: 'ph-1', pharmacyName: 'Portal Plus', pharmacyTier: 'TIER_1_API', submissionTier: 'TIER_1_API',
    rerouteCount: 0, trackingNumber: null, carrier: null, stripePaymentIntentId: null,
    createdAt: '2026-10-06T10:00:00Z', updatedAt: '2026-10-06T10:00:00Z', opsAssignee: null,
    nearestSlaDeadline: null, hasSlaBreached: false,
  }
}

beforeAll(() => {
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ orders: [order(ORDER), order('other')] }) })) as unknown as typeof fetch
})

function renderPipeline(initialOrderId: string | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(
    <QueryClientProvider client={client}>
      <PipelineView initialOrders={[order(ORDER), order('other')]} clinicOptions={[]} pharmacyOptions={[]} initialOrderId={initialOrderId} />
    </QueryClientProvider>,
  )
}

it('?order=<id> opens that order', () => {
  renderPipeline(ORDER)
  expect(screen.getByTestId('drawer')).toHaveTextContent(ORDER)
})

it('without it, no drawer opens', () => {
  renderPipeline(null)
  expect(screen.queryByTestId('drawer')).toBeNull()
})
