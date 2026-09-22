/**
 * @jest-environment node
 *
 * Batch 2 follow-up: a late payment on an expired bundle is refunded and
 * flagged — never marked PAID.
 *
 * If payment_intent.succeeded arrives for a group whose members have all
 * expired, marking it PAID would take the patient's money against orders
 * that will never be filled. Instead the handler refunds it in full, with
 * the Connect flags, records why on each member's history, marks the
 * group EXPIRED, and the ops panel shows it. A refund that fails is
 * recorded and THROWN, so Stripe redelivers and the refund is retried.
 *
 * Stripe is mocked.
 */

import type Stripe from 'stripe'
import { handleGroupPaymentSucceeded } from '../handle-group'

const casTransitionMock = jest.fn()
const branchByTierMock  = jest.fn().mockResolvedValue(undefined)
const groupFetchMock    = jest.fn()
const membersFetchMock  = jest.fn()
const groupUpdateMock   = jest.fn()
const historyInsertMock = jest.fn()
const refundsCreateMock = jest.fn()
jest.spyOn(console, 'error').mockImplementation(() => {})
jest.spyOn(console, 'warn').mockImplementation(() => {})
jest.spyOn(console, 'info').mockImplementation(() => {})

const supabaseMock = {
  from: (table: string) => {
    if (table === 'payment_groups') {
      return {
        select: () => ({ eq: () => ({ maybeSingle: () => groupFetchMock() }) }),
        update: (values: unknown) => ({ eq: () => ({ eq: async () => groupUpdateMock(values) }) }),
      }
    }
    if (table === 'orders') {
      return { select: () => ({ eq: () => ({ is: () => membersFetchMock() }) }) }
    }
    if (table === 'order_status_history') {
      return { insert: async (rows: unknown) => { historyInsertMock(rows); return { error: null } } }
    }
    throw new Error(`Unexpected table in test: ${table}`)
  },
} as never

const stripeMock = { refunds: { create: (p: unknown, o: unknown) => refundsCreateMock(p, o) } } as never

const PI = {
  id: 'pi_group', amount: 45000, currency: 'usd',
  metadata: { payment_group_id: 'g-1', clinic_id: 'clinic-1', order_count: '2', platform: '8090ai' },
} as unknown as Stripe.PaymentIntent

const invoke = () => handleGroupPaymentSucceeded(PI, {
  supabase: supabaseMock, casTransition: casTransitionMock, branchByTier: branchByTierMock, stripe: stripeMock,
} as never)

const statusUpdates = () => groupUpdateMock.mock.calls.map(c => (c[0] as { status?: string }).status)

beforeEach(() => {
  casTransitionMock.mockReset().mockResolvedValue({ wasAlreadyTransitioned: false })
  branchByTierMock.mockReset().mockResolvedValue(undefined)
  groupUpdateMock.mockReset().mockResolvedValue({ error: null })
  historyInsertMock.mockReset()
  refundsCreateMock.mockReset().mockResolvedValue({ id: 're_late', status: 'succeeded' })
  groupFetchMock.mockReset().mockResolvedValue({
    data: { group_id: 'g-1', status: 'AWAITING_PAYMENT', clinic_id: 'clinic-1', stripe_payment_intent_id: 'pi_group' },
    error: null,
  })
  membersFetchMock.mockReset().mockResolvedValue({
    data: [
      { order_id: 'o-a', status: 'PAYMENT_EXPIRED', pharmacy_id: 'ph-1' },
      { order_id: 'o-b', status: 'PAYMENT_EXPIRED', pharmacy_id: 'ph-1' },
    ],
    error: null,
  })
})

describe('a late payment on an expired bundle', () => {
  it('is refunded in full with the Connect flags, not marked PAID', async () => {
    await invoke()

    expect(refundsCreateMock).toHaveBeenCalledWith(
      { payment_intent: 'pi_group', reverse_transfer: true, refund_application_fee: true },
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    )
    expect(statusUpdates()).not.toContain('PAID')
    expect(statusUpdates()).toContain('EXPIRED')
    expect(casTransitionMock).not.toHaveBeenCalled()
  })

  it('records why on each member, for the ops panel', async () => {
    await invoke()

    const rows = historyInsertMock.mock.calls.flatMap(c => (Array.isArray(c[0]) ? c[0] : [c[0]])) as Record<string, unknown>[]
    expect(rows.map(r => r['order_id']).sort()).toEqual(['o-a', 'o-b'])
    for (const r of rows) {
      expect(r['metadata']).toEqual(expect.objectContaining({ event: 'late_payment_refunded', refund_id: 're_late', payment_group_id: 'g-1' }))
    }
  })

  it('also applies when payment expiry has already marked the group EXPIRED', async () => {
    groupFetchMock.mockResolvedValue({
      data: { group_id: 'g-1', status: 'EXPIRED', clinic_id: 'clinic-1', stripe_payment_intent_id: 'pi_group' },
      error: null,
    })

    await invoke()

    expect(refundsCreateMock).toHaveBeenCalled()
  })

  it('a refund that fails is recorded and thrown, so Stripe redelivers', async () => {
    refundsCreateMock.mockRejectedValue(new Error('insufficient platform balance'))

    await expect(invoke()).rejects.toThrow()
    const rows = historyInsertMock.mock.calls.flatMap(c => (Array.isArray(c[0]) ? c[0] : [c[0]])) as Record<string, unknown>[]
    expect(rows.some(r => (r['metadata'] as Record<string, unknown>)['refund_ok'] === false)).toBe(true)
  })
})

describe('a normal group payment is unaffected', () => {
  it('marks PAID and refunds nothing', async () => {
    membersFetchMock.mockResolvedValue({
      data: [
        { order_id: 'o-a', status: 'AWAITING_PAYMENT', pharmacy_id: 'ph-1' },
        { order_id: 'o-b', status: 'AWAITING_PAYMENT', pharmacy_id: 'ph-1' },
      ],
      error: null,
    })

    await invoke()

    expect(refundsCreateMock).not.toHaveBeenCalled()
    expect(statusUpdates()).toContain('PAID')
  })
})
