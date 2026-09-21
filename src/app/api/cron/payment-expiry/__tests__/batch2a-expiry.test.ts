/**
 * @jest-environment node
 *
 * Batch 2, PR A: payment expiry must never expire an order whose payment
 * succeeded.
 *
 * The cron moved every AWAITING_PAYMENT order past 72h to PAYMENT_EXPIRED
 * FIRST, and only then tried to cancel its PaymentIntent. When the
 * payment webhook had failed, the patient had paid but the order still
 * read AWAITING_PAYMENT — so the cron expired a paid order, and the
 * cancel then failed with payment_intent_unexpected_state, logged after
 * the damage was done.
 *
 * Now it confirms the order and its payment group are unpaid before
 * expiring. If it cannot confirm — a Stripe or database error — it skips
 * that order, logs [payment-expiry], and leaves it for the next run.
 *
 * Stripe is mocked: nothing here can retrieve or cancel a real payment.
 */

import type { NextRequest } from 'next/server'
import { GET } from '../route'

const DB_ERROR = { message: 'connection reset', code: '08006' }

let candidates: Record<string, unknown>[] = []
const groupFetchMock = jest.fn()
const orderUpdateMock = jest.fn()
const piRetrieveMock = jest.fn()
const piCancelMock = jest.fn()

jest.mock('@/lib/stripe/client', () => ({
  createStripeClient: () => ({
    paymentIntents: {
      retrieve: (id: string) => piRetrieveMock(id),
      cancel:   (id: string) => piCancelMock(id),
    },
  }),
}))

jest.mock('@/lib/orders/status-history', () => ({ insertStatusHistory: jest.fn().mockResolvedValue(true) }))
jest.mock('@/lib/sla/resolver', () => ({ resolveSlasForTransition: jest.fn().mockResolvedValue(undefined) }))

function listChain(result: () => unknown): Record<string, unknown> {
  const c: Record<string, unknown> = {}
  for (const k of ['select', 'eq', 'is', 'lt', 'in', 'order', 'limit']) c[k] = () => c
  c['maybeSingle'] = async () => result()
  c['then'] = (resolve: (r: unknown) => unknown) => Promise.resolve(result()).then(resolve)
  return c
}

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table === 'orders') {
        return {
          select: () => listChain(() => ({ data: candidates, error: null })),
          update: (values: unknown) => ({
            eq: (_c: string, orderId: string) => ({
              eq: () => ({ select: async () => orderUpdateMock(orderId, values) }),
            }),
          }),
        }
      }
      if (table === 'payment_groups') {
        return { select: () => listChain(() => groupFetchMock()) }
      }
      throw new Error(`Unexpected table in test: ${table}`)
    },
  }),
}))

function run() {
  process.env['CRON_SECRET'] = 'cron-secret'
  return GET({ headers: { get: () => 'Bearer cron-secret' } } as unknown as NextRequest)
}

const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
jest.spyOn(console, 'warn').mockImplementation(() => {})
jest.spyOn(console, 'info').mockImplementation(() => {})

beforeEach(() => {
  candidates = []
  groupFetchMock.mockReset().mockResolvedValue({ data: null, error: null })
  orderUpdateMock.mockReset().mockImplementation(async (orderId: string) => ({ data: [{ order_id: orderId }], error: null }))
  piRetrieveMock.mockReset().mockResolvedValue({ id: 'pi_1', status: 'requires_payment_method' })
  piCancelMock.mockReset().mockResolvedValue({ id: 'pi_1', status: 'canceled' })
  errorSpy.mockClear()
})

const expiredOrders = () => orderUpdateMock.mock.calls.map(c => c[0] as string)
const loggedPaymentExpiry = () => errorSpy.mock.calls.some(c => String(c[0]).includes('[payment-expiry]'))

describe('payment expiry — never expires a paid order', () => {
  it('skips a solo order whose payment succeeded but whose webhook failed', async () => {
    candidates = [{ order_id: 'o-paid', stripe_payment_intent_id: 'pi_1', payment_group_id: null }]
    piRetrieveMock.mockResolvedValue({ id: 'pi_1', status: 'succeeded' })

    await run()

    expect(expiredOrders()).not.toContain('o-paid')
    expect(piCancelMock).not.toHaveBeenCalled()
    expect(loggedPaymentExpiry()).toBe(true)
  })

  it('skips a bundle member whose payment group is already PAID', async () => {
    candidates = [{ order_id: 'o-member', stripe_payment_intent_id: null, payment_group_id: 'group-1' }]
    groupFetchMock.mockResolvedValue({ data: { status: 'PAID', stripe_payment_intent_id: 'pi_group' }, error: null })

    await run()

    expect(expiredOrders()).not.toContain('o-member')
  })

  it('skips a bundle member whose group payment succeeded in Stripe', async () => {
    candidates = [{ order_id: 'o-member', stripe_payment_intent_id: null, payment_group_id: 'group-1' }]
    groupFetchMock.mockResolvedValue({ data: { status: 'AWAITING_PAYMENT', stripe_payment_intent_id: 'pi_group' }, error: null })
    piRetrieveMock.mockResolvedValue({ id: 'pi_group', status: 'succeeded' })

    await run()

    expect(expiredOrders()).not.toContain('o-member')
  })
})

describe('payment expiry — cannot confirm unpaid, so leaves it for next run', () => {
  it('skips and logs when Stripe cannot be asked', async () => {
    candidates = [{ order_id: 'o-1', stripe_payment_intent_id: 'pi_1', payment_group_id: null }]
    piRetrieveMock.mockRejectedValue(new Error('stripe unavailable'))

    await run()

    expect(expiredOrders()).not.toContain('o-1')
    expect(loggedPaymentExpiry()).toBe(true)
  })

  it('skips and logs when the payment group cannot be read', async () => {
    candidates = [{ order_id: 'o-member', stripe_payment_intent_id: null, payment_group_id: 'group-1' }]
    groupFetchMock.mockResolvedValue({ data: null, error: DB_ERROR })

    await run()

    expect(expiredOrders()).not.toContain('o-member')
    expect(loggedPaymentExpiry()).toBe(true)
  })

  it('does not expire an order whose PaymentIntent could not be cancelled', async () => {
    // The patient paid between the check and the cancel: Stripe refuses
    // to cancel a succeeded PI. The order must not be expired.
    candidates = [{ order_id: 'o-1', stripe_payment_intent_id: 'pi_1', payment_group_id: null }]
    piCancelMock.mockRejectedValue(Object.assign(new Error('cannot cancel'), { code: 'payment_intent_unexpected_state' }))

    await run()

    expect(expiredOrders()).not.toContain('o-1')
  })
})

describe('payment expiry — still expires what is genuinely unpaid', () => {
  it('expires an unpaid solo order and cancels its PaymentIntent', async () => {
    candidates = [{ order_id: 'o-unpaid', stripe_payment_intent_id: 'pi_1', payment_group_id: null }]

    const res = await run()

    expect(piCancelMock).toHaveBeenCalledWith('pi_1')
    expect(expiredOrders()).toEqual(['o-unpaid'])
    expect((await res.json() as { expired: number }).expired).toBe(1)
  })

  it('expires an order that never reached checkout (no PaymentIntent at all)', async () => {
    candidates = [{ order_id: 'o-nopi', stripe_payment_intent_id: null, payment_group_id: null }]

    await run()

    expect(piRetrieveMock).not.toHaveBeenCalled()
    expect(expiredOrders()).toEqual(['o-nopi'])
  })
})
