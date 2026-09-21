/**
 * @jest-environment node
 *
 * Batch 2, PR A — the group handlers. A database error THROWS (so the
 * route answers 500 and Stripe redelivers) instead of returning, which
 * the route read as success. And a member that was marked paid by an
 * earlier, failed delivery is routed on the retry rather than skipped.
 */

import type Stripe from 'stripe'
import { handleGroupPaymentSucceeded } from '../handle-group'
import { handleGroupChargeDisputeCreated } from '../handle-group-dispute'

const DB_ERROR = { message: 'connection reset', code: '08006' }

const casTransitionMock = jest.fn()
const branchByTierMock  = jest.fn().mockResolvedValue(undefined)
const groupFetchMock    = jest.fn()
const membersFetchMock  = jest.fn()
const groupUpdateMock   = jest.fn().mockResolvedValue({ error: null })
jest.spyOn(console, 'error').mockImplementation(() => {})
jest.spyOn(console, 'warn').mockImplementation(() => {})
jest.spyOn(console, 'info').mockImplementation(() => {})

const supabaseMock = {
  from: (table: string) => {
    if (table === 'payment_groups') {
      return {
        select: () => ({ eq: () => ({ maybeSingle: () => groupFetchMock() }) }),
        update: () => ({ eq: () => ({ eq: () => groupUpdateMock() }) }),
      }
    }
    if (table === 'orders') {
      return { select: () => ({ eq: () => ({ is: () => membersFetchMock() }) }) }
    }
    throw new Error(`Unexpected table in test: ${table}`)
  },
} as unknown as Parameters<typeof handleGroupPaymentSucceeded>[1]['supabase']

const GROUP_PI = {
  id: 'pi_group_1', amount: 30000, currency: 'usd',
  metadata: { payment_group_id: 'group-aaa', clinic_id: 'clinic-1', order_count: '2', platform: '8090ai' },
} as unknown as Stripe.PaymentIntent

const invoke = () => handleGroupPaymentSucceeded(GROUP_PI, {
  supabase: supabaseMock, casTransition: casTransitionMock, branchByTier: branchByTierMock,
})

beforeEach(() => {
  casTransitionMock.mockReset().mockResolvedValue({ wasAlreadyTransitioned: false })
  branchByTierMock.mockReset().mockResolvedValue(undefined)
  groupUpdateMock.mockReset().mockResolvedValue({ error: null })
  groupFetchMock.mockReset().mockResolvedValue({
    data: { group_id: 'group-aaa', status: 'AWAITING_PAYMENT', clinic_id: 'clinic-1', stripe_payment_intent_id: 'pi_group_1' },
    error: null,
  })
  membersFetchMock.mockReset().mockResolvedValue({
    data: [
      { order_id: 'o-1', status: 'AWAITING_PAYMENT', pharmacy_id: 'ph-1' },
      { order_id: 'o-2', status: 'AWAITING_PAYMENT', pharmacy_id: 'ph-1' },
    ],
    error: null,
  })
})

describe('group payment_intent.succeeded — DB errors throw', () => {
  it('throws when the group lookup errors', async () => {
    groupFetchMock.mockResolvedValue({ data: null, error: DB_ERROR })
    await expect(invoke()).rejects.toThrow()
    expect(casTransitionMock).not.toHaveBeenCalled()
  })

  it('throws when the member orders cannot be loaded', async () => {
    membersFetchMock.mockResolvedValue({ data: null, error: DB_ERROR })
    await expect(invoke()).rejects.toThrow()
    expect(groupUpdateMock).not.toHaveBeenCalled()
  })

  it('still returns quietly when the group genuinely does not exist', async () => {
    groupFetchMock.mockResolvedValue({ data: null, error: null })
    await expect(invoke()).resolves.toBeUndefined()
  })
})

describe('group payment_intent.succeeded — redelivery resumes a stranded member', () => {
  it('routes a member left PAID_PROCESSING by a failed earlier delivery', async () => {
    // o-1 was marked paid last time, then routing failed; o-2 never ran.
    membersFetchMock.mockResolvedValue({
      data: [
        { order_id: 'o-1', status: 'PAID_PROCESSING', pharmacy_id: 'ph-1' },
        { order_id: 'o-2', status: 'AWAITING_PAYMENT', pharmacy_id: 'ph-1' },
      ],
      error: null,
    })
    casTransitionMock.mockImplementation(async (args: { orderId: string }) =>
      ({ wasAlreadyTransitioned: args.orderId === 'o-1' }))

    await invoke()

    expect(branchByTierMock).toHaveBeenCalledWith('o-1', 'ph-1')
    expect(branchByTierMock).toHaveBeenCalledWith('o-2', 'ph-1')
    expect(branchByTierMock).toHaveBeenCalledTimes(2)
  })
})

describe('group charge.dispute.created — DB errors throw', () => {
  const dispute = {
    id: 'dp_1', payment_intent: 'pi_group_1', amount: 30000, currency: 'usd',
    reason: 'fraudulent', status: 'needs_response', metadata: { payment_group_id: 'group-aaa' },
  } as unknown as Stripe.Dispute
  const deps = () => ({
    supabase: supabaseMock as never,
    sendSlackAlert: jest.fn().mockResolvedValue(undefined),
    buildAdapterFailureAlert: (a: unknown) => a as never,
  })

  it('throws when the group lookup errors', async () => {
    groupFetchMock.mockResolvedValue({ data: null, error: DB_ERROR })
    await expect(handleGroupChargeDisputeCreated(dispute, deps())).rejects.toThrow()
  })

  it('throws when the member orders cannot be loaded', async () => {
    membersFetchMock.mockResolvedValue({ data: null, error: DB_ERROR })
    await expect(handleGroupChargeDisputeCreated(dispute, deps())).rejects.toThrow()
  })
})
