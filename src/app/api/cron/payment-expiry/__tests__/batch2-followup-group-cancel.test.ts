/**
 * @jest-environment node
 *
 * Batch 2 follow-up: an expired bundle cannot be paid.
 *
 * Payment expiry cancelled a solo order's PaymentIntent before expiring
 * it, but never a group's: the bundle's shared PaymentIntent stayed
 * payable after every member had expired, and a late payment was then
 * marked PAID against expired orders. The group's payment is now
 * cancelled the same way — before any member is expired — and the group
 * is marked EXPIRED.
 *
 * Stripe is mocked.
 */

import type { NextRequest } from 'next/server'
import { GET } from '../route'

let candidates: Record<string, unknown>[] = []
const orderUpdateMock  = jest.fn()
const groupUpdateMock  = jest.fn()
const piRetrieveMock   = jest.fn()
const piCancelMock     = jest.fn()
const calls: string[] = []

jest.mock('@/lib/stripe/client', () => ({
  createStripeClient: () => ({
    paymentIntents: {
      retrieve: (id: string) => piRetrieveMock(id),
      cancel:   (id: string) => { calls.push(`cancel:${id}`); return piCancelMock(id) },
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
              eq: () => ({ select: async () => { calls.push(`expire:${orderId}`); return orderUpdateMock(orderId, values) } }),
            }),
          }),
        }
      }
      if (table === 'payment_groups') {
        return {
          select: () => listChain(() => ({ data: { status: 'AWAITING_PAYMENT', stripe_payment_intent_id: 'pi_group' }, error: null })),
          update: (values: unknown) => ({ eq: () => ({ eq: async () => groupUpdateMock(values) }) }),
        }
      }
      throw new Error(`Unexpected table in test: ${table}`)
    },
  }),
}))

const run = () => {
  process.env['CRON_SECRET'] = 'cron-secret'
  return GET({ headers: { get: () => 'Bearer cron-secret' } } as unknown as NextRequest)
}

jest.spyOn(console, 'error').mockImplementation(() => {})
jest.spyOn(console, 'warn').mockImplementation(() => {})
jest.spyOn(console, 'info').mockImplementation(() => {})

beforeEach(() => {
  calls.length = 0
  candidates = [
    { order_id: 'o-a', stripe_payment_intent_id: null, payment_group_id: 'g-1' },
    { order_id: 'o-b', stripe_payment_intent_id: null, payment_group_id: 'g-1' },
  ]
  orderUpdateMock.mockReset().mockImplementation(async (orderId: string) => ({ data: [{ order_id: orderId }], error: null }))
  groupUpdateMock.mockReset().mockResolvedValue({ error: null })
  piRetrieveMock.mockReset().mockResolvedValue({ id: 'pi_group', status: 'requires_payment_method' })
  piCancelMock.mockReset().mockResolvedValue({ id: 'pi_group', status: 'canceled' })
})

describe('payment expiry — a bundle', () => {
  it('cancels the group\'s payment before expiring any member, once', async () => {
    await run()

    expect(calls.filter(c => c === 'cancel:pi_group')).toHaveLength(1)
    expect(calls.indexOf('cancel:pi_group')).toBeLessThan(calls.indexOf('expire:o-a'))
    expect(calls).toContain('expire:o-b')
  })

  it('marks the group EXPIRED once its payment is cancelled', async () => {
    await run()

    expect(groupUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'EXPIRED' }))
  })

  it('expires no member when the group\'s payment cannot be cancelled', async () => {
    piCancelMock.mockRejectedValue(Object.assign(new Error('stripe unavailable'), { code: 'api_error' }))

    await run()

    expect(calls.filter(c => c.startsWith('expire:'))).toHaveLength(0)
  })
})
