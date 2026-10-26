/**
 * @jest-environment node
 *
 * B's review T2: a signed order goes only to the pharmacy it was signed
 * for, unless ops reroute it. The reroute that changes the pharmacy
 * records, in its status-history row (service-written, append-only), a
 * proof keyed by RX_BINDING_SECRET over the order, its signature, the new
 * pharmacy and the reroute count. The send guard accepts the new pharmacy
 * only with that proof. Without the key in production the reroute is
 * refused before anything changes.
 */

import { POST } from '../route'
import { rerouteBinding } from '@/lib/orders/signature-binding'

const ORDER = '0a000000-0000-4000-8000-000000000001'
const NEW_PHARMACY = '0b000000-0000-4000-8000-000000000002'
const SIGNATURE = `v3:${'a'.repeat(64)}:${'b'.repeat(64)}`

let orderRow: Record<string, unknown> = {}
const casMock = jest.fn()
const getUserMock = jest.fn()
jest.spyOn(console, 'error').mockImplementation(() => {})
jest.spyOn(console, 'info').mockImplementation(() => {})

jest.mock('next/server', () => ({ ...jest.requireActual('next/server'), after: () => undefined }))
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockImplementation(async () => ({ auth: { getUser: () => getUserMock() } })),
}))
jest.mock('@/lib/adapters/routing-engine', () => ({ routeOrder: jest.fn(), submitQueuedFax: jest.fn() }))
jest.mock('@/lib/stripe/client', () => ({ createStripeClient: () => ({}) }))
jest.mock('@/lib/orders/cas-transition', () => ({ casTransition: (a: unknown) => casMock(a) }))
jest.mock('@/lib/orders/status-history', () => ({ insertStatusHistory: jest.fn().mockResolvedValue(true) }))

function chain(single: () => unknown): Record<string, unknown> {
  const c: Record<string, unknown> = {}
  for (const k of ['select', 'eq', 'is', 'in', 'neq', 'order', 'limit']) c[k] = () => c
  c['maybeSingle'] = async () => single()
  c['single'] = async () => single()
  return c
}
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table === 'orders') return { select: () => chain(() => ({ data: orderRow, error: null })) }
      throw new Error(`Unexpected table in test: ${table}`)
    },
  }),
}))

const env = process.env as Record<string, string | undefined>
const reroute = (pharmacyId?: string) => POST(
  { json: async () => ({ action: 'reroute', ...(pharmacyId !== undefined ? { pharmacyId } : {}) }) } as never,
  { params: Promise.resolve({ orderId: ORDER }) },
)

beforeEach(() => {
  env['RX_BINDING_SECRET'] = 'test-binding-secret-0123456789abcdef'
  delete env['VERCEL_ENV']
  orderRow = {
    order_id: ORDER, status: 'FAX_FAILED', pharmacy_id: 'pharm-1', reroute_count: 0, stripe_payment_intent_id: 'pi_1',
    payment_group_id: null, retail_price_snapshot: 100, ops_assignee: null, provider_signature_hash_snapshot: SIGNATURE,
  }
  casMock.mockReset().mockResolvedValue({ success: true, wasAlreadyTransitioned: false, orderId: ORDER })
  getUserMock.mockReset().mockResolvedValue({ data: { user: { id: 'u-ops', email: 'ops@test', app_metadata: { app_role: 'ops_admin' } } }, error: null })
})
afterAll(() => { delete env['RX_BINDING_SECRET'] })

it('a reroute to a new pharmacy records the keyed proof in its history metadata', async () => {
  const res = await reroute(NEW_PHARMACY)
  expect(res.status).toBe(200)
  const args = casMock.mock.calls[0]![0] as { patch: Record<string, unknown>; metadata: Record<string, unknown>; newStatus: string }
  expect(args.newStatus).toBe('REROUTE_PENDING')
  expect(args.patch).toEqual({ reroute_count: 1, pharmacy_id: NEW_PHARMACY })
  expect(args.metadata).toMatchObject({
    reason: 'ops_reroute', reroute_count: 1, new_pharmacy_id: NEW_PHARMACY,
    reroute_binding: rerouteBinding(ORDER, SIGNATURE, NEW_PHARMACY, 1),
  })
})

it('a reroute that keeps the pharmacy records no proof', async () => {
  await reroute()
  const args = casMock.mock.calls[0]![0] as { metadata: Record<string, unknown> }
  expect(args.metadata['reroute_binding']).toBeUndefined()
})

it('without the binding key in production a pharmacy change is refused before anything changes', async () => {
  delete env['RX_BINDING_SECRET']
  env['VERCEL_ENV'] = 'production'
  const res = await reroute(NEW_PHARMACY)
  expect(res.status).toBe(503)
  expect(casMock).not.toHaveBeenCalled()
})
