/**
 * REQ-OPV-002: the pipeline's filter bar. Choosing a tier shows only
 * that tier's orders, the sidebar counts are the shown rows' counts, the
 * filters live in the URL (a reload or a shared link keeps them), and
 * "Clear all filters" brings every order back.
 *
 * Status is picked from the sidebar, so the sidebar has to keep listing
 * the other statuses once one is picked; before, the status filter was
 * also sent to the server, the counts came back for that status alone,
 * and a second status could not be added.
 */

import { act, render, screen, within, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PipelineView } from '../_components/pipeline-view'
import type { PipelineOrder } from '@/types/pipeline'
import type { IntegrationTierEnum, OrderStatusEnum } from '@/types/database.types'
import { EMPTY_PIPELINE_FILTERS, matchesPipelineFilters, parsePipelineFilters } from '@/lib/ops/pipeline-filters'

jest.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({ auth: { getUser: async () => ({ data: { user: { email: 'ops@test' } } }) } }),
}))
jest.mock('../_components/order-detail-drawer', () => ({ OrderDetailDrawer: () => null }))

function order(orderId: string, tier: IntegrationTierEnum, status: OrderStatusEnum): PipelineOrder {
  return {
    orderId, orderNumber: orderId, status, clinicId: 'c-1', clinicName: 'Sunrise',
    pharmacyId: `ph-${tier}`, pharmacyName: `Pharmacy ${tier}`, pharmacyTier: tier, submissionTier: tier,
    rerouteCount: 0, trackingNumber: null, carrier: null, stripePaymentIntentId: null,
    createdAt: '2026-10-20T10:00:00Z', updatedAt: '2026-10-20T10:00:00Z', opsAssignee: null,
    nearestSlaDeadline: null, hasSlaBreached: false,
  }
}

const ALL = [
  order('API-1', 'TIER_1_API', 'SUBMISSION_FAILED'),
  order('API-2', 'TIER_1_API', 'FAX_FAILED'),
  order('FAX-1', 'TIER_4_FAX', 'SUBMISSION_FAILED'),
  order('FAX-2', 'TIER_4_FAX', 'FAX_FAILED'),
  order('FAX-3', 'TIER_4_FAX', 'FAX_QUEUED'),
]

// The server: applies the filters in the request, as the route does.
const fetchMock = jest.fn(async (url: string) => {
  const filters = parsePipelineFilters(new URL(url, 'https://app.test').searchParams)
  return { ok: true, status: 200, json: async () => ({ orders: ALL.filter(o => matchesPipelineFilters(o, filters)) }) }
})

beforeEach(() => {
  fetchMock.mockClear()
  global.fetch = fetchMock as unknown as typeof fetch
  window.history.replaceState(null, '', '/ops/pipeline')
})

function renderPipeline(props: Partial<Parameters<typeof PipelineView>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(
    <QueryClientProvider client={client}>
      <PipelineView initialOrders={ALL} clinicOptions={[]} pharmacyOptions={[]} {...props} />
    </QueryClientProvider>,
  )
}

const shownOrders = () => Array.from(document.querySelectorAll('tr[data-order-id]')).map(r => r.getAttribute('data-order-id'))
const tierSelect  = () => screen.getByRole('combobox', { name: 'Filter by integration tier' })
const sidebarStatus = (label: string) => screen.getByRole('button', { name: new RegExp(`^${label}\\s*\\d+$`) })
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })

it('choosing a tier shows only that tier, asks the server for it, and puts it in the URL', async () => {
  renderPipeline()
  fireEvent.change(tierSelect(), { target: { value: 'TIER_4_FAX' } })
  await flush()

  expect(shownOrders().sort()).toEqual(['FAX-1', 'FAX-2', 'FAX-3'])
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes('tier=TIER_4_FAX'))).toBe(true)
  expect(new URLSearchParams(window.location.search).get('tier')).toBe('TIER_4_FAX')
  expect(screen.getByText('3 of 3 orders')).toBeInTheDocument()
})

it('the sidebar counts are the counts of the chosen tier', async () => {
  renderPipeline()
  expect(sidebarStatus('Submission Failed')).toHaveTextContent('2')
  fireEvent.change(tierSelect(), { target: { value: 'TIER_4_FAX' } })
  await flush()
  expect(sidebarStatus('Submission Failed')).toHaveTextContent('1')
  expect(sidebarStatus('Fax Queued')).toHaveTextContent('1')
})

it('a link with ?tier= opens already filtered', async () => {
  renderPipeline({ initialFilters: { ...EMPTY_PIPELINE_FILTERS, tier: 'TIER_1_API' } })
  expect(tierSelect()).toHaveValue('TIER_1_API')
  expect(shownOrders().sort()).toEqual(['API-1', 'API-2'])
  await flush()
  expect(shownOrders().sort()).toEqual(['API-1', 'API-2'])
})

it('a second status can be added from the sidebar after the first', async () => {
  renderPipeline()
  fireEvent.click(sidebarStatus('Submission Failed'))
  await flush()
  fireEvent.click(sidebarStatus('Fax Failed'))
  await flush()
  expect(shownOrders().sort()).toEqual(['API-1', 'API-2', 'FAX-1', 'FAX-2'])
  expect(new URLSearchParams(window.location.search).get('statuses')).toBe('SUBMISSION_FAILED,FAX_FAILED')
})

it('the tier shows as a chip that removes it, and "Clear all filters" restores every order', async () => {
  renderPipeline()
  fireEvent.change(tierSelect(), { target: { value: 'TIER_4_FAX' } })
  await flush()
  expect(screen.getByRole('button', { name: 'Remove T4 Fax filter' })).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Clear all filters' }))
  await flush()
  expect(shownOrders()).toHaveLength(5)
  expect(tierSelect()).toHaveValue('')
  expect(window.location.search).toBe('')
})

it('clearing keeps a ?order= deep link the filters do not own', async () => {
  window.history.replaceState(null, '', '/ops/pipeline?order=FAX-1')
  renderPipeline()
  fireEvent.change(tierSelect(), { target: { value: 'TIER_4_FAX' } })
  await flush()
  const params = new URLSearchParams(window.location.search)
  expect(params.get('order')).toBe('FAX-1')
  expect(params.get('tier')).toBe('TIER_4_FAX')
})

it('every row of a tier filter is on that tier', async () => {
  renderPipeline()
  fireEvent.change(tierSelect(), { target: { value: 'TIER_1_API' } })
  await flush()
  const grid = screen.getByRole('grid', { name: 'Order pipeline' })
  for (const row of within(grid).getAllByRole('row').slice(1)) {
    expect(row).toHaveAttribute('data-pharmacy-tier', 'TIER_1_API')
  }
})
