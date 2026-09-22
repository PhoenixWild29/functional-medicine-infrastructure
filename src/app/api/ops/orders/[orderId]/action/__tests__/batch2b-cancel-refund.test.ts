/**
 * @jest-environment node
 *
 * Batch 2, PR B: ops "Cancel + Refund".
 *
 *   - A refund that fails returns failure. It used to be logged as
 *     "non-fatal" and answered { ok: true, status: 'REFUND_PENDING' }, so
 *     ops were told a refund had been initiated when none had.
 *   - Cancelling a paid BUNDLE member refunds that member. Group payments
 *     put the PaymentIntent on payment_groups, never on the member order,
 *     so the old check ("has a payment_intent_id") read a paid member as
 *     unpaid and hard-cancelled it with no refund at all.
 *   - Shipping is refunded only with the LAST paid member of the group.
 *   - A transition that no-ops is reported, never answered as success.
 *
 * Stripe is mocked: refunds.create is a jest.fn(). Nothing here can move
 * real money. The single-order refund's parameters are mirrored exactly —
 * { payment_intent } and nothing else; a member refund adds only the
 * amount a partial refund requires.
 */

import { POST } from '../route'

const refundsCreateMock = jest.fn()
const casTransitionMock = jest.fn()
const orderFetchMock    = jest.fn()
const groupFetchMock    = jest.fn()
const membersFetchMock  = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockResolvedValue({
    auth: { getSession: async () => ({ data: { session: { user: { email: 'ops@test', user_metadata: { app_role: 'ops_admin' } } } } }) },
  }),
}))

jest.mock('@/lib/stripe/client', () => ({
  createStripeClient: () => ({
    refunds: { create: (params: unknown, opts: unknown) => refundsCreateMock(params, opts) },
  }),
}))

jest.mock('@/lib/orders/cas-transition', () => ({
  casTransition: (args: unknown) => casTransitionMock(args),
}))
jest.mock('@/lib/orders/status-history', () => ({ insertStatusHistory: jest.fn().mockResolvedValue(true) }))

function chain(single: () => unknown, list?: () => unknown): Record<string, unknown> {
  const c: Record<string, unknown> = {}
  for (const k of ['select', 'eq', 'is', 'in', 'neq', 'order', 'limit']) c[k] = () => c
  c['maybeSingle'] = async () => single()
  c['single'] = async () => single()
  c['then'] = (resolve: (r: unknown) => unknown) => Promise.resolve((list ?? single)()).then(resolve)
  return c
}

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table === 'orders')         return { select: () => chain(() => orderFetchMock(), () => membersFetchMock()) }
      if (table === 'payment_groups') return { select: () => chain(() => groupFetchMock()) }
      throw new Error(`Unexpected table in test: ${table}`)
    },
  }),
}))

function post(orderId: string) {
  return POST(
    { json: async () => ({ action: 'cancel_refund' }) } as unknown as import('next/server').NextRequest,
    { params: Promise.resolve({ orderId }) },
  )
}

/** CAS that succeeds, and records what it moved. */
const moves = () => casTransitionMock.mock.calls.map(c => `${(c[0] as { expectedStatus: string }).expectedStatus}->${(c[0] as { newStatus: string }).newStatus}`)

jest.spyOn(console, 'error').mockImplementation(() => {})
jest.spyOn(console, 'info').mockImplementation(() => {})
jest.spyOn(console, 'warn').mockImplementation(() => {})

beforeEach(() => {
  refundsCreateMock.mockReset().mockResolvedValue({ id: 're_1', status: 'succeeded' })
  casTransitionMock.mockReset().mockResolvedValue({ success: true, wasAlreadyTransitioned: false })
  orderFetchMock.mockReset()
  groupFetchMock.mockReset().mockResolvedValue({ data: null, error: null })
  membersFetchMock.mockReset().mockResolvedValue({ data: [], error: null })
})

const SOLO_PAID = {
  order_id: 'o-solo', status: 'PAID_PROCESSING', stripe_payment_intent_id: 'pi_solo',
  payment_group_id: null, reroute_count: 0, pharmacy_id: 'ph-1', ops_assignee: null,
  retail_price_snapshot: 190,
}

describe('cancel + refund — a single order', () => {
  it('a refund that fails surfaces as failure, never ok: true', async () => {
    orderFetchMock.mockResolvedValue({ data: SOLO_PAID, error: null })
    refundsCreateMock.mockRejectedValue(new Error('Your card was declined for refund'))

    const res = await post('o-solo')
    const body = await res.json() as { ok?: boolean; error?: string }

    expect(res.status).toBeGreaterThanOrEqual(500)
    expect(body.ok).not.toBe(true)
    expect(body.error).toMatch(/refund/i)
  })

  it('mirrors the existing refund parameters exactly, and completes to REFUNDED', async () => {
    orderFetchMock.mockResolvedValue({ data: SOLO_PAID, error: null })

    const res = await post('o-solo')

    expect(res.status).toBe(200)
    // CHANGED (batch-2 follow-up, decision 1): every refund on a Connect
    // destination charge also sends reverse_transfer and
    // refund_application_fee. The idempotency key is a request option,
    // not a refund parameter.
    expect(refundsCreateMock).toHaveBeenCalledWith(
      { payment_intent: 'pi_solo', reverse_transfer: true, refund_application_fee: true },
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    )
    expect(moves()).toEqual(['PAID_PROCESSING->REFUND_PENDING', 'REFUND_PENDING->REFUNDED'])
  })
})

describe('cancel + refund — a paid bundle member', () => {
  const GROUP = { group_id: 'g-1', status: 'PAID', stripe_payment_intent_id: 'pi_group', total_cents: 50000 }
  const member = (id: string, status: string, retail: number) => ({
    order_id: id, status, stripe_payment_intent_id: null, payment_group_id: 'g-1',
    reroute_count: 0, pharmacy_id: 'ph-1', ops_assignee: null, retail_price_snapshot: retail,
  })

  it('cancelling one of two paid members refunds that member only', async () => {
    // Retail $200 + $250 = $450; the group charged $500, so $50 shipping.
    const a = member('o-a', 'PAID_PROCESSING', 200)
    const b = member('o-b', 'PAID_PROCESSING', 250)
    orderFetchMock.mockResolvedValue({ data: a, error: null })
    groupFetchMock.mockResolvedValue({ data: GROUP, error: null })
    membersFetchMock.mockResolvedValue({ data: [a, b], error: null })

    const res = await post('o-a')

    expect(res.status).toBe(200)
    expect(refundsCreateMock).toHaveBeenCalledWith(
      { payment_intent: 'pi_group', amount: 20000, reverse_transfer: true, refund_application_fee: true },
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    )
  })

  it('cancelling the last paid member also refunds the shipping', async () => {
    const a = member('o-a', 'REFUNDED', 200)
    const b = member('o-b', 'PAID_PROCESSING', 250)
    orderFetchMock.mockResolvedValue({ data: b, error: null })
    groupFetchMock.mockResolvedValue({ data: GROUP, error: null })
    membersFetchMock.mockResolvedValue({ data: [a, b], error: null })

    const res = await post('o-b')

    expect(res.status).toBe(200)
    // $250 for the member + $50 shipping ($500 charged − $450 retail).
    expect(refundsCreateMock).toHaveBeenCalledWith(
      { payment_intent: 'pi_group', amount: 30000, reverse_transfer: true, refund_application_fee: true },
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    )
  })

  it('a clinic that absorbed shipping refunds no shipping, even for the last member', async () => {
    const a = member('o-a', 'CANCELLED', 200)
    const b = member('o-b', 'PAID_PROCESSING', 250)
    orderFetchMock.mockResolvedValue({ data: b, error: null })
    // Absorbed: the patient was charged retail only.
    groupFetchMock.mockResolvedValue({ data: { ...GROUP, total_cents: 45000 }, error: null })
    membersFetchMock.mockResolvedValue({ data: [a, b], error: null })

    await post('o-b')

    expect(refundsCreateMock).toHaveBeenCalledWith(
      { payment_intent: 'pi_group', amount: 25000, reverse_transfer: true, refund_application_fee: true },
      expect.anything(),
    )
  })

  it('refuses rather than guessing when the group cannot be read', async () => {
    orderFetchMock.mockResolvedValue({ data: member('o-a', 'PAID_PROCESSING', 200), error: null })
    groupFetchMock.mockResolvedValue({ data: null, error: { message: 'connection reset' } })

    const res = await post('o-a')
    const body = await res.json() as { ok?: boolean }

    expect(res.status).toBeGreaterThanOrEqual(500)
    expect(body.ok).not.toBe(true)
    expect(refundsCreateMock).not.toHaveBeenCalled()
  })
})

describe('cancel + refund — a transition that no-ops is reported', () => {
  it('paid order: the order moved first, so nothing is refunded and it says so', async () => {
    orderFetchMock.mockResolvedValue({ data: SOLO_PAID, error: null })
    casTransitionMock.mockResolvedValue({ success: true, wasAlreadyTransitioned: true })

    const res = await post('o-solo')
    const body = await res.json() as { ok?: boolean; error?: string }

    expect(res.status).toBe(409)
    expect(body.ok).not.toBe(true)
    expect(refundsCreateMock).not.toHaveBeenCalled()
  })

  it('unpaid order: a cancel that no-ops is not reported as cancelled', async () => {
    orderFetchMock.mockResolvedValue({
      data: { ...SOLO_PAID, status: 'AWAITING_PAYMENT', stripe_payment_intent_id: null },
      error: null,
    })
    casTransitionMock.mockResolvedValue({ success: true, wasAlreadyTransitioned: true })

    const res = await post('o-solo')
    const body = await res.json() as { ok?: boolean }

    expect(res.status).toBe(409)
    expect(body.ok).not.toBe(true)
  })
})
