/**
 * @jest-environment node
 *
 * Batch 2 follow-up — the refund-retry cron.
 *
 *   - A retry sends reverse_transfer and refund_application_fee, like
 *     every refund on a Connect destination charge.
 *   - A refund Stripe reported as PENDING was recorded by id. The cron
 *     retrieves that refund by id instead of creating one: a second
 *     create under the same key only replays the old response, and under
 *     a new key could refund twice. It is surfaced as stuck only if it is
 *     still unresolved after the window.
 *
 * Stripe is mocked: refunds.create and refunds.retrieve are jest.fn()s.
 */

import type { NextRequest } from 'next/server'
import { GET } from '../route'

const HOUR = 60 * 60 * 1000

const refundsCreateMock   = jest.fn()
const refundsRetrieveMock = jest.fn()
const casTransitionMock   = jest.fn()
let pendingSince = new Date(Date.now() - 2 * HOUR).toISOString()
let recordedRefundId: string | null = null

jest.mock('@/lib/stripe/client', () => ({
  createStripeClient: () => ({
    refunds: {
      create:   (p: unknown, o: unknown) => refundsCreateMock(p, o),
      retrieve: (id: string) => refundsRetrieveMock(id),
    },
  }),
}))
jest.mock('@/lib/orders/cas-transition', () => ({ casTransition: (a: unknown) => casTransitionMock(a) }))

/**
 * History answers two questions: when the order went REFUND_PENDING (the
 * transition row, old_status ≠ REFUND_PENDING) and which refund Stripe is
 * still processing (an event row, old_status = new_status = REFUND_PENDING).
 */
function historyChain(): Record<string, unknown> {
  const f: Record<string, unknown> = {}
  const c: Record<string, unknown> = {}
  for (const k of ['select', 'is', 'in', 'order', 'limit', 'contains']) c[k] = () => c
  c['eq']  = (col: string, v: unknown) => { f[`eq:${col}`] = v; return c }
  c['neq'] = (col: string, v: unknown) => { f[`neq:${col}`] = v; return c }
  const answer = () => {
    if (f['eq:old_status'] === 'REFUND_PENDING') {
      return { data: recordedRefundId ? { created_at: pendingSince, metadata: { refund_id: recordedRefundId } } : null, error: null }
    }
    return { data: { created_at: pendingSince, metadata: { refund_pi: 'pi_1', refund_amount_cents: null } }, error: null }
  }
  c['maybeSingle'] = async () => answer()
  c['then'] = (resolve: (r: unknown) => unknown) => Promise.resolve(answer()).then(resolve)
  return c
}

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table === 'orders') {
        const c: Record<string, unknown> = {}
        for (const k of ['select', 'eq', 'is', 'limit']) c[k] = () => c
        c['then'] = (resolve: (r: unknown) => unknown) => Promise.resolve({
          data: [{ order_id: 'o-1', status: 'REFUND_PENDING', stripe_payment_intent_id: 'pi_1', payment_group_id: null, retail_price_snapshot: 190 }],
          error: null,
        }).then(resolve)
        return c
      }
      if (table === 'order_status_history') {
        return { select: () => historyChain(), insert: async () => ({ error: null }) }
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
jest.spyOn(console, 'info').mockImplementation(() => {})

beforeEach(() => {
  refundsCreateMock.mockReset().mockResolvedValue({ id: 're_new', status: 'succeeded' })
  refundsRetrieveMock.mockReset()
  casTransitionMock.mockReset().mockResolvedValue({ success: true, wasAlreadyTransitioned: false })
  pendingSince = new Date(Date.now() - 2 * HOUR).toISOString()
  recordedRefundId = null
})

describe('refund retry — Connect flags', () => {
  it('a retry reverses the transfer and refunds the application fee', async () => {
    await run()

    expect(refundsCreateMock).toHaveBeenCalledWith(
      { payment_intent: 'pi_1', reverse_transfer: true, refund_application_fee: true },
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    )
  })
})

describe('refund retry — a refund Stripe reported as pending', () => {
  it('is retrieved by id, not created again, and completes to REFUNDED when it succeeded', async () => {
    recordedRefundId = 're_pending_1'
    refundsRetrieveMock.mockResolvedValue({ id: 're_pending_1', status: 'succeeded' })

    await run()

    expect(refundsRetrieveMock).toHaveBeenCalledWith('re_pending_1')
    expect(refundsCreateMock).not.toHaveBeenCalled()
    expect(casTransitionMock).toHaveBeenCalledWith(expect.objectContaining({ newStatus: 'REFUNDED' }))
  })

  it('still pending inside the window: waits, creates nothing', async () => {
    recordedRefundId = 're_pending_1'
    refundsRetrieveMock.mockResolvedValue({ id: 're_pending_1', status: 'pending' })

    await run()

    expect(refundsCreateMock).not.toHaveBeenCalled()
    expect(casTransitionMock).not.toHaveBeenCalled()
  })

  it('still unresolved after the window: left for ops, creates nothing', async () => {
    recordedRefundId = 're_pending_1'
    pendingSince = new Date(Date.now() - 25 * HOUR).toISOString()
    refundsRetrieveMock.mockResolvedValue({ id: 're_pending_1', status: 'pending' })

    const res = await run()

    expect(refundsCreateMock).not.toHaveBeenCalled()
    expect((await res.json() as { leftForOps: number }).leftForOps).toBe(1)
  })

  it('a pending refund that resolved after the window still completes', async () => {
    recordedRefundId = 're_pending_1'
    pendingSince = new Date(Date.now() - 25 * HOUR).toISOString()
    refundsRetrieveMock.mockResolvedValue({ id: 're_pending_1', status: 'succeeded' })

    await run()

    expect(casTransitionMock).toHaveBeenCalledWith(expect.objectContaining({ newStatus: 'REFUNDED' }))
  })
})
