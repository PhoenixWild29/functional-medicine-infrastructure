/**
 * @jest-environment node
 *
 * Phase C Stage 3 — group-PI handling in the Stripe webhook.
 *
 * Solo-PI handling is covered E2E (existing checkout spec). This file
 * pins the new branches that only fire for group PaymentIntents:
 *
 *   - group lookup by payment_group_id
 *   - per-order CAS transitions (idempotent across redeliveries)
 *   - group status → PAID only after all members transition
 *   - PI cross-check defends against group/PI mismatch
 *   - empty group → CANCELLED (defense-in-depth)
 *   - already-PAID group → no-op (idempotent)
 *   - already-PAID via per-order alreadyTransitioned → still marks group PAID
 *   - per-order failure → group NOT marked PAID (for redelivery retry)
 *   - missing pharmacy_id → logs, no branchByTier, group still PAID
 */

import type Stripe from 'stripe'
import { handleGroupPaymentSucceeded } from '../handle-group'

// ── Mocks ──────────────────────────────────────────────────────────

const casTransitionMock = jest.fn()
const groupFetchMock    = jest.fn()
const groupUpdateMock   = jest.fn().mockResolvedValue({ error: null })
const membersFetchMock  = jest.fn()
const branchByTierMock  = jest.fn().mockResolvedValue(undefined)
const errorSpy          = jest.spyOn(console, 'error').mockImplementation(() => {})
const warnSpy           = jest.spyOn(console, 'warn').mockImplementation(() => {})
const infoSpy           = jest.spyOn(console, 'info').mockImplementation(() => {})

const supabaseMock = {
  from: (table: string) => {
    if (table === 'payment_groups') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => groupFetchMock(),
          }),
        }),
        update: () => ({
          eq: () => ({
            eq: () => groupUpdateMock(),
          }),
        }),
      }
    }
    if (table === 'orders') {
      return {
        select: () => ({
          eq: () => ({
            is: () => membersFetchMock(),
          }),
        }),
      }
    }
    throw new Error(`Unexpected table in test: ${table}`)
  },
} as unknown as Parameters<typeof handleGroupPaymentSucceeded>[1]['supabase']

function makeGroupPi(overrides: Partial<Stripe.PaymentIntent> = {}): Stripe.PaymentIntent {
  return {
    id: 'pi_test_group_1',
    amount: 30000,
    currency: 'usd',
    metadata: {
      payment_group_id: 'group-aaa',
      clinic_id: 'clinic-1',
      order_count: '2',
      platform: '8090ai',
    },
    ...overrides,
  } as unknown as Stripe.PaymentIntent
}

function invoke(pi: Stripe.PaymentIntent) {
  return handleGroupPaymentSucceeded(pi, {
    supabase: supabaseMock,
    casTransition: casTransitionMock,
    branchByTier: branchByTierMock,
  })
}

// ── Setup ──────────────────────────────────────────────────────────

beforeEach(() => {
  casTransitionMock.mockReset()
  groupFetchMock.mockReset()
  groupUpdateMock.mockReset().mockResolvedValue({ error: null })
  membersFetchMock.mockReset()
  branchByTierMock.mockReset().mockResolvedValue(undefined)
  errorSpy.mockClear()
  warnSpy.mockClear()
  infoSpy.mockClear()

  groupFetchMock.mockResolvedValue({
    data: {
      group_id: 'group-aaa',
      status: 'AWAITING_PAYMENT',
      clinic_id: 'clinic-1',
      stripe_payment_intent_id: 'pi_test_group_1',
    },
    error: null,
  })
  membersFetchMock.mockResolvedValue({
    data: [
      { order_id: 'o-1', status: 'AWAITING_PAYMENT', pharmacy_id: 'pharm-1' },
      { order_id: 'o-2', status: 'AWAITING_PAYMENT', pharmacy_id: 'pharm-1' },
    ],
    error: null,
  })
  casTransitionMock.mockResolvedValue({ wasAlreadyTransitioned: false })
})

afterAll(() => {
  errorSpy.mockRestore()
  warnSpy.mockRestore()
  infoSpy.mockRestore()
})

// ── Tests ──────────────────────────────────────────────────────────

describe('Phase C Stage 3 — handleGroupPaymentSucceeded', () => {
  it('transitions all member orders + branches per tier + marks group PAID on the happy path', async () => {
    await invoke(makeGroupPi())

    expect(casTransitionMock).toHaveBeenCalledTimes(2)
    expect(casTransitionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'o-1',
        expectedStatus: 'AWAITING_PAYMENT',
        newStatus: 'PAID_PROCESSING',
        actor: 'stripe_webhook_group',
        metadata: expect.objectContaining({
          payment_group_id: 'group-aaa',
          stripe_payment_intent_id: 'pi_test_group_1',
        }),
      }),
    )
    expect(branchByTierMock).toHaveBeenCalledTimes(2)
    expect(branchByTierMock).toHaveBeenCalledWith('o-1', 'pharm-1')
    expect(groupUpdateMock).toHaveBeenCalledTimes(1)
  })

  it('is idempotent: returns early when the group is already PAID', async () => {
    groupFetchMock.mockResolvedValue({
      data: { group_id: 'group-aaa', status: 'PAID', clinic_id: 'clinic-1', stripe_payment_intent_id: 'pi_test_group_1' },
      error: null,
    })

    await invoke(makeGroupPi())

    expect(casTransitionMock).not.toHaveBeenCalled()
    expect(branchByTierMock).not.toHaveBeenCalled()
    expect(groupUpdateMock).not.toHaveBeenCalled()
    expect(infoSpy).toHaveBeenCalledWith(expect.stringMatching(/already terminal/))
  })

  it('is idempotent: all-orders-already-transitioned redelivery still marks group PAID', async () => {
    casTransitionMock.mockResolvedValue({ wasAlreadyTransitioned: true })

    await invoke(makeGroupPi())

    expect(casTransitionMock).toHaveBeenCalledTimes(2)
    // branchByTier NOT called for orders that were already transitioned
    expect(branchByTierMock).not.toHaveBeenCalled()
    expect(groupUpdateMock).toHaveBeenCalledTimes(1)
  })

  it('returns early without updates when the group is not found', async () => {
    groupFetchMock.mockResolvedValue({ data: null, error: null })

    await invoke(makeGroupPi())

    expect(casTransitionMock).not.toHaveBeenCalled()
    expect(membersFetchMock).not.toHaveBeenCalled()
    expect(groupUpdateMock).not.toHaveBeenCalled()
    // Second arg is groupErr?.message — undefined in this test since data is null
    expect(errorSpy.mock.calls.some(c => /group not found/.test(String(c[0])))).toBe(true)
  })

  it('rejects when the event PI does not match the group.stripe_payment_intent_id', async () => {
    groupFetchMock.mockResolvedValue({
      data: { group_id: 'group-aaa', status: 'AWAITING_PAYMENT', clinic_id: 'clinic-1', stripe_payment_intent_id: 'pi_a_DIFFERENT_id' },
      error: null,
    })

    await invoke(makeGroupPi())

    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/group\/PI mismatch/))
    expect(casTransitionMock).not.toHaveBeenCalled()
    expect(groupUpdateMock).not.toHaveBeenCalled()
  })

  it('marks empty groups CANCELLED (defense-in-depth — should not happen post-creation)', async () => {
    membersFetchMock.mockResolvedValue({ data: [], error: null })

    await invoke(makeGroupPi())

    expect(casTransitionMock).not.toHaveBeenCalled()
    expect(groupUpdateMock).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/no member orders/))
  })

  it('leaves group AWAITING_PAYMENT when a per-order CAS throws (for redelivery retry)', async () => {
    casTransitionMock
      .mockResolvedValueOnce({ wasAlreadyTransitioned: false })
      .mockRejectedValueOnce(new Error('simulated DB blip'))

    await invoke(makeGroupPi())

    expect(casTransitionMock).toHaveBeenCalledTimes(2)
    expect(groupUpdateMock).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/left in AWAITING_PAYMENT due to 1 per-order failure/),
    )
  })

  it('logs but does not call branchByTier when a member order has no pharmacy_id', async () => {
    membersFetchMock.mockResolvedValue({
      data: [
        { order_id: 'o-1', status: 'AWAITING_PAYMENT', pharmacy_id: null },
        { order_id: 'o-2', status: 'AWAITING_PAYMENT', pharmacy_id: 'pharm-1' },
      ],
      error: null,
    })

    await invoke(makeGroupPi())

    expect(casTransitionMock).toHaveBeenCalledTimes(2)
    // branchByTier called once — for the order with pharmacy_id, not the null one
    expect(branchByTierMock).toHaveBeenCalledTimes(1)
    expect(branchByTierMock).toHaveBeenCalledWith('o-2', 'pharm-1')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/missing pharmacy_id/))
    // Group still marks PAID — missing pharmacy_id is a data bug, not a
    // payment-flow failure (CAS itself succeeded)
    expect(groupUpdateMock).toHaveBeenCalledTimes(1)
  })
})
