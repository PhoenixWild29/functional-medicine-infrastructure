/**
 * @jest-environment node
 *
 * Payment Flow v1.1: the ops order detail says "Payment failed, awaiting
 * retry" while the order awaits payment and its newest history row is a
 * failed payment attempt; the Stripe payment event rows are not timeline
 * steps.
 */

import { scriptedDb, type ScriptedCall } from '@/__tests__/helpers/scripted-db'

const ORDER = '45e03578-e208-468d-a35b-ab9bc82320ae'
let db = scriptedDb(() => undefined)
let status = 'AWAITING_PAYMENT'
let history: Array<Record<string, unknown>> = []

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'ops-1', app_metadata: { app_role: 'ops_admin' } } }, error: null }) },
  }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))

import { GET } from '../route'

const call = async () => (await GET({ headers: new Headers() } as never, { params: Promise.resolve({ orderId: ORDER }) })).json()

beforeEach(() => {
  status = 'AWAITING_PAYMENT'
  history = [
    { history_id: 'h1', old_status: 'DRAFT', new_status: 'AWAITING_PAYMENT', changed_by: 'u', metadata: null, created_at: '2026-10-10T09:00:00Z' },
    { history_id: 'h2', old_status: 'AWAITING_PAYMENT', new_status: 'AWAITING_PAYMENT', changed_by: 'stripe_webhook', metadata: { event: 'stripe_payment_failed', failure_code: 'card_declined' }, created_at: '2026-10-10T10:00:00Z' },
  ]
  db = scriptedDb((c: ScriptedCall) => {
    if (c.table === 'orders') return { data: { order_id: ORDER, status, clinic_id: 'clinic-1', patient_id: 'pt-1', medication_snapshot: {}, created_at: '2026-10-10T00:00:00Z' } }
    if (c.table === 'order_status_history') return { data: history }
    return { data: [] }
  })
})

it('shows the label while the newest row is a failed payment, and keeps it out of the timeline', async () => {
  const body = await call()
  expect(body.order.paymentFailedLabel).toBe('Payment failed, awaiting retry')
  expect(body.history.map((h: { historyId: string }) => h.historyId)).toEqual(['h1'])
})

it('no label once the order is paid', async () => {
  status = 'PAID_PROCESSING'
  expect((await call()).order.paymentFailedLabel).toBeNull()
})

it('no label when no payment failed', async () => {
  history = history.slice(0, 1)
  expect((await call()).order.paymentFailedLabel).toBeNull()
})
