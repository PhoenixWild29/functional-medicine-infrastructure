/**
 * SLA heatmap colours are worked out against the time the SLA data
 * arrived (BLK-04): a poll result reclassifies the cards, and a re-render
 * between polls (a filter click) does not. Pinned before "now" stopped
 * being read during render (eslint-plugin-react-hooks 7.1: purity);
 * behaviour unchanged.
 */

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SlaHeatmap } from '../_components/sla-heatmap'
import type { HandoffMetrics, SlaRow } from '@/app/api/ops/sla/route'

const T0 = new Date('2026-10-24T12:00:00.000Z').getTime()
const row: SlaRow = {
  orderId: 'e1000000-0000-4000-8000-000000000001', orderNumber: 'ORD-1', orderStatus: 'SUBMITTED', clinicName: 'Sunrise',
  pharmacyName: 'Strive', pharmacyTier: 'TIER_4_FAX', slaType: 'FAX_DELIVERY',
  createdAt: new Date(T0 - 59 * 60_000).toISOString(),
  deadlineAt: new Date(T0 + 30_000).toISOString(),   // 30 s left of a 59.5 min window: Approaching
  escalated: false, escalatedAt: null, escalationTier: 0, acknowledgedAt: null, acknowledgedBy: null,
  resolvedAt: null, cascadeAttempted: false,
}
const handoff = (n: number): HandoffMetrics => ({
  totalActiveBreaches: n, breachesBySlaType: {}, adapterSuccessRateByTier: {}, submissionFailureCount: 0,
  cascadeEventCount: 0, faxDeliveryRate: null, acknowledgedUnresolved: 0,
})

let polls = 0
beforeEach(() => {
  jest.useFakeTimers({ now: T0 })
  polls = 0
  global.fetch = jest.fn(async () => {
    polls++
    await new Promise(resolve => setTimeout(resolve, 50))
    return { ok: true, status: 200, json: async () => ({ slas: [row], handoff: handoff(polls), totalCount: 1 }) }
  }) as unknown as typeof fetch
})
afterEach(() => { jest.useRealTimers() })

const advance = (ms: number) => act(async () => { await jest.advanceTimersByTimeAsync(ms) })
const badge = () => within(screen.getByRole('article', { name: 'Fax Delivery: ORD-1' })).getByText(/On Track|Approaching|Breached/)

it('reclassifies when a poll result arrives, not on a re-render between polls', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 60_000 } } })
  render(
    <QueryClientProvider client={client}>
      <SlaHeatmap initialSlas={[row]} initialHandoff={handoff(0)} />
    </QueryClientProvider>,
  )
  expect(badge()).toHaveTextContent('Approaching')

  await advance(45_000)   // the deadline passes; no poll yet
  fireEvent.click(screen.getByRole('button', { name: 'All Active' }))
  expect(badge()).toHaveTextContent('Approaching')

  await advance(15_100)   // the 60 s poll and its response
  expect(polls).toBe(1)
  expect(badge()).toHaveTextContent('Breached')
})
