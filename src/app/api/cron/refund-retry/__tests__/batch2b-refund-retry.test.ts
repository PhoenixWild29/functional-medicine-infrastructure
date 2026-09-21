/**
 * @jest-environment node
 *
 * Batch 2, PR B: REFUND_PENDING is acted on.
 *
 * The state machine says REFUND_PENDING → REFUNDED happens "via the
 * payment_intent.refunded webhook". That handler was never built, and
 * nothing else in the codebase writes REFUNDED — so a refund that failed
 * was never retried, and even one that succeeded left the order pending
 * forever.
 *
 * This cron retries a pending refund, with the same idempotency key every
 * time, so a retry of a refund Stripe already made returns that refund
 * instead of making a second. It retries only inside Stripe's 24-hour
 * idempotency window; past it, an automatic retry could double-refund, so
 * the order is left for ops (see stuck-refunds) instead.
 *
 * Stripe is mocked: refunds.create is a jest.fn().
 */

import type { NextRequest } from 'next/server'
import { GET } from '../route'

const HOUR = 60 * 60 * 1000

const refundsCreateMock = jest.fn()
const casTransitionMock = jest.fn()
let pending: Record<string, unknown>[] = []
let pendingSince: Record<string, string | null> = {}
let historyError = false

jest.mock('@/lib/stripe/client', () => ({
  createStripeClient: () => ({
    refunds: { create: (params: unknown, opts: unknown) => refundsCreateMock(params, opts) },
  }),
}))
jest.mock('@/lib/orders/cas-transition', () => ({
  casTransition: (args: unknown) => casTransitionMock(args),
}))

/** A chain that remembers its eq() filters, so the answer can depend on them. */
function chain(answer: (filters: Record<string, unknown>) => unknown): Record<string, unknown> {
  const filters: Record<string, unknown> = {}
  const c: Record<string, unknown> = {}
  for (const k of ['select', 'is', 'in', 'order', 'limit', 'neq']) c[k] = () => c
  c['eq'] = (col: string, val: unknown) => { filters[col] = val; return c }
  c['maybeSingle'] = async () => answer(filters)
  c['then'] = (resolve: (r: unknown) => unknown) => Promise.resolve(answer(filters)).then(resolve)
  return c
}

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table === 'orders') {
        return { select: () => chain(() => ({ data: pending, error: null })) }
      }
      if (table === 'order_status_history') {
        return {
          select: () => chain(f => historyError
            ? { data: null, error: { message: 'connection reset' } }
            : { data: pendingSince[f['order_id'] as string] ? { created_at: pendingSince[f['order_id'] as string] } : null, error: null }),
        }
      }
      if (table === 'payment_groups') {
        return { select: () => chain(() => ({ data: null, error: null })) }
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
jest.spyOn(console, 'info').mockImplementation(() => {})
jest.spyOn(console, 'warn').mockImplementation(() => {})

const SOLO = { order_id: 'o-1', status: 'REFUND_PENDING', stripe_payment_intent_id: 'pi_1', payment_group_id: null, retail_price_snapshot: 190 }

beforeEach(() => {
  refundsCreateMock.mockReset().mockResolvedValue({ id: 're_1', status: 'succeeded' })
  casTransitionMock.mockReset().mockResolvedValue({ success: true, wasAlreadyTransitioned: false })
  pending = [SOLO]
  pendingSince = { 'o-1': new Date(Date.now() - 2 * HOUR).toISOString() }
  historyError = false
  errorSpy.mockClear()
})

describe('refund retry', () => {
  it('retries a pending refund with a stable idempotency key, and completes it to REFUNDED', async () => {
    await run()

    expect(refundsCreateMock).toHaveBeenCalledWith(
      { payment_intent: 'pi_1' },
      expect.objectContaining({ idempotencyKey: expect.stringContaining('o-1') }),
    )
    expect(casTransitionMock).toHaveBeenCalledWith(expect.objectContaining({
      orderId: 'o-1', expectedStatus: 'REFUND_PENDING', newStatus: 'REFUNDED',
    }))
  })

  it('a retry that fails leaves the refund pending and logs [refund-retry]', async () => {
    refundsCreateMock.mockRejectedValue(new Error('insufficient platform balance'))

    await run()

    expect(casTransitionMock).not.toHaveBeenCalled()
    expect(errorSpy.mock.calls.some(c => String(c[0]).includes('[refund-retry]'))).toBe(true)
  })

  it('does not retry automatically past the idempotency window — that is for ops', async () => {
    pendingSince = { 'o-1': new Date(Date.now() - 25 * HOUR).toISOString() }

    await run()

    expect(refundsCreateMock).not.toHaveBeenCalled()
  })

  it('does not retry when it cannot tell how long the refund has been pending', async () => {
    historyError = true

    await run()

    expect(refundsCreateMock).not.toHaveBeenCalled()
    expect(errorSpy.mock.calls.some(c => String(c[0]).includes('[refund-retry]'))).toBe(true)
  })

  it('a refund Stripe reports as still pending is left pending, not marked REFUNDED', async () => {
    refundsCreateMock.mockResolvedValue({ id: 're_1', status: 'pending' })

    await run()

    expect(casTransitionMock).not.toHaveBeenCalled()
  })
})
