/**
 * The pipeline's "Updated Ns ago": seconds since the last fetch finished
 * (a successful or a failed one), counting up each second and back to 0
 * when the 10-second poll finishes. Pinned before the timestamp moved out
 * of an effect (eslint-plugin-react-hooks 7.1: set-state-in-effect,
 * purity); behaviour unchanged.
 */

import { act, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PipelineView } from '../_components/pipeline-view'
import type { PipelineOrder } from '@/types/pipeline'

jest.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({ auth: { getUser: async () => ({ data: { user: { email: 'ops@test' } } }) } }),
}))
jest.mock('../_components/order-detail-drawer', () => ({ OrderDetailDrawer: () => null }))

const ORDER: PipelineOrder = {
  orderId: 'd1000000-0000-4000-8000-000000000001', orderNumber: null, status: 'PHARMACY_REJECTED', clinicId: 'c-1', clinicName: 'Sunrise',
  pharmacyId: 'ph-1', pharmacyName: 'Portal Plus', pharmacyTier: 'TIER_1_API', submissionTier: 'TIER_1_API',
  rerouteCount: 0, trackingNumber: null, carrier: null, stripePaymentIntentId: null,
  createdAt: '2026-10-06T10:00:00Z', updatedAt: '2026-10-06T10:00:00Z', opsAssignee: null,
  nearestSlaDeadline: null, hasSlaBreached: false,
}

let failNext = false
beforeEach(() => {
  jest.useFakeTimers()
  failNext = false
  global.fetch = jest.fn(async () => {
    await new Promise(resolve => setTimeout(resolve, 50))  // a fetch takes time
    if (failNext) { failNext = false; return { ok: false, status: 500, json: async () => ({}) } }
    return { ok: true, status: 200, json: async () => ({ orders: [ORDER] }) }
  }) as unknown as typeof fetch
})
afterEach(() => { jest.useRealTimers() })

function renderPipeline() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(
    <QueryClientProvider client={client}>
      <PipelineView initialOrders={[ORDER]} clinicOptions={[]} pharmacyOptions={[]} />
    </QueryClientProvider>,
  )
}
const advance = (ms: number) => act(async () => { await jest.advanceTimersByTimeAsync(ms) })

it('counts up each second and returns to 0 when the poll finishes', async () => {
  renderPipeline()
  await advance(0)
  expect(screen.getByText('Updated 0s ago')).toBeInTheDocument()
  await advance(3000)
  expect(screen.getByText('Updated 3s ago')).toBeInTheDocument()
  await advance(7000)  // the 10 s poll
  await advance(100)   // its response
  expect(screen.getByText('Updated 0s ago')).toBeInTheDocument()
  await advance(2000)
  expect(screen.getByText('Updated 2s ago')).toBeInTheDocument()
})

it('a failed poll also counts as the last update', async () => {
  renderPipeline()
  await advance(0)
  await advance(5000)
  expect(screen.getByText('Updated 5s ago')).toBeInTheDocument()
  failNext = true
  await advance(5000)  // the 10 s poll fails
  await advance(100)   // its response
  expect(screen.getByText('Updated 0s ago')).toBeInTheDocument()
})
