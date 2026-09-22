/**
 * @jest-environment node
 *
 * Batch 2 follow-up: refunds unwind the Connect charge, and a refund
 * Stripe reports as pending has its id recorded.
 *
 * Every PaymentIntent here is a Connect DESTINATION charge: the clinic's
 * share is transferred to its account at capture and the platform keeps
 * an application fee. A refund of { payment_intent } alone returns the
 * patient's money from the PLATFORM's balance and leaves the clinic's
 * transfer and the platform fee in place. Every refund now sends
 * reverse_transfer: true and refund_application_fee: true, and Stripe
 * prorates both on a partial refund — we never compute them.
 *
 * Stripe is mocked: refunds.create is a jest.fn().
 */

import { POST } from '../route'

const refundsCreateMock = jest.fn()
const casTransitionMock = jest.fn()
const orderFetchMock    = jest.fn()
const groupFetchMock    = jest.fn()
const membersFetchMock  = jest.fn()
const historyInsertMock = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockResolvedValue({
    auth: { getSession: async () => ({ data: { session: { user: { email: 'ops@test', user_metadata: { app_role: 'ops_admin' } } } } }) },
  }),
}))
jest.mock('@/lib/stripe/client', () => ({
  createStripeClient: () => ({ refunds: { create: (p: unknown, o: unknown) => refundsCreateMock(p, o) } }),
}))
jest.mock('@/lib/orders/cas-transition', () => ({ casTransition: (a: unknown) => casTransitionMock(a) }))
jest.mock('@/lib/orders/status-history', () => ({ insertStatusHistory: jest.fn().mockResolvedValue(true) }))

function chain(single: () => unknown, list?: () => unknown): Record<string, unknown> {
  const c: Record<string, unknown> = {}
  for (const k of ['select', 'eq', 'is', 'in', 'neq', 'order', 'limit', 'contains']) c[k] = () => c
  c['maybeSingle'] = async () => single()
  c['then'] = (resolve: (r: unknown) => unknown) => Promise.resolve((list ?? single)()).then(resolve)
  return c
}

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table === 'orders')         return { select: () => chain(() => orderFetchMock(), () => membersFetchMock()) }
      if (table === 'payment_groups') return { select: () => chain(() => groupFetchMock()) }
      if (table === 'order_status_history') {
        return {
          insert: async (row: unknown) => { historyInsertMock(row); return { error: null } },
          select: () => chain(() => ({ data: null, error: null })),
        }
      }
      throw new Error(`Unexpected table in test: ${table}`)
    },
  }),
}))

const post = (orderId: string) => POST(
  { json: async () => ({ action: 'cancel_refund' }) } as unknown as import('next/server').NextRequest,
  { params: Promise.resolve({ orderId }) },
)

jest.spyOn(console, 'error').mockImplementation(() => {})
jest.spyOn(console, 'info').mockImplementation(() => {})

const SOLO = {
  order_id: 'o-solo', status: 'PAID_PROCESSING', stripe_payment_intent_id: 'pi_solo',
  payment_group_id: null, reroute_count: 0, pharmacy_id: 'ph-1', ops_assignee: null, retail_price_snapshot: 190,
}
const member = (id: string, status: string, retail: number) => ({
  order_id: id, status, stripe_payment_intent_id: null, payment_group_id: 'g-1',
  reroute_count: 0, pharmacy_id: 'ph-1', ops_assignee: null, retail_price_snapshot: retail,
})

beforeEach(() => {
  refundsCreateMock.mockReset().mockResolvedValue({ id: 're_1', status: 'succeeded' })
  casTransitionMock.mockReset().mockResolvedValue({ success: true, wasAlreadyTransitioned: false })
  orderFetchMock.mockReset()
  groupFetchMock.mockReset().mockResolvedValue({ data: null, error: null })
  membersFetchMock.mockReset().mockResolvedValue({ data: [], error: null })
  historyInsertMock.mockReset()
})

describe('refunds unwind the Connect destination charge', () => {
  it('a single-order refund reverses the transfer and refunds the application fee', async () => {
    orderFetchMock.mockResolvedValue({ data: SOLO, error: null })

    await post('o-solo')

    expect(refundsCreateMock).toHaveBeenCalledWith(
      { payment_intent: 'pi_solo', reverse_transfer: true, refund_application_fee: true },
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    )
  })

  it('a bundle member\'s partial refund does too — Stripe prorates both', async () => {
    const a = member('o-a', 'PAID_PROCESSING', 200)
    const b = member('o-b', 'PAID_PROCESSING', 250)
    orderFetchMock.mockResolvedValue({ data: a, error: null })
    groupFetchMock.mockResolvedValue({ data: { group_id: 'g-1', status: 'PAID', stripe_payment_intent_id: 'pi_group', total_cents: 50000 }, error: null })
    membersFetchMock.mockResolvedValue({ data: [a, b], error: null })

    await post('o-a')

    // amount is the member's retail; the transfer reversal and fee
    // refund are left to Stripe's proration — not computed here.
    expect(refundsCreateMock).toHaveBeenCalledWith(
      { payment_intent: 'pi_group', amount: 20000, reverse_transfer: true, refund_application_fee: true },
      expect.anything(),
    )
  })
})

describe('a refund Stripe reports as pending', () => {
  it('records the refund id, so a retry can ask about THAT refund', async () => {
    orderFetchMock.mockResolvedValue({ data: SOLO, error: null })
    refundsCreateMock.mockResolvedValue({ id: 're_pending_1', status: 'pending' })

    const res = await post('o-solo')

    expect(res.status).toBe(200)
    expect(historyInsertMock).toHaveBeenCalledWith(expect.objectContaining({
      order_id: 'o-solo',
      old_status: 'REFUND_PENDING',
      new_status: 'REFUND_PENDING',
      metadata: expect.objectContaining({ refund_id: 're_pending_1' }),
    }))
  })
})
