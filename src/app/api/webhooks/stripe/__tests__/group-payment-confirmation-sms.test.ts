/**
 * @jest-environment node
 *
 * Bundle payment-confirmation text (C7 follow-up): one text per paid
 * bundle, not one per member order, and never a second one.
 *
 * Exactly-once comes from the per-order CAS: the text is tied to one
 * member (the lowest order_id), and only the delivery whose CAS moved that
 * member AWAITING_PAYMENT -> PAID_PROCESSING sends it. A redelivery, a
 * resumed partial failure or a duplicate finds it already transitioned.
 * sendSms's own sms_log dedup (order_id + template) is the second layer.
 *
 * A failed text never fails the handler.
 */

import type Stripe from 'stripe'
import { handleGroupPaymentSucceeded } from '../handle-group'

const casTransitionMock = jest.fn()
const groupFetchMock    = jest.fn()
const groupUpdateMock   = jest.fn()
const membersFetchMock  = jest.fn()
const branchByTierMock  = jest.fn()
const notifyMock        = jest.fn()
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

const PI = {
  id: 'pi_group_1',
  metadata: { payment_group_id: 'group-aaa', clinic_id: 'clinic-1', platform: '8090ai' },
} as unknown as Stripe.PaymentIntent

function invoke() {
  return handleGroupPaymentSucceeded(PI, {
    supabase:                supabaseMock,
    casTransition:           casTransitionMock,
    branchByTier:            branchByTierMock,
    notifyPaymentConfirmed:  notifyMock,
  })
}

beforeEach(() => {
  casTransitionMock.mockReset().mockResolvedValue({ wasAlreadyTransitioned: false })
  groupUpdateMock.mockReset().mockResolvedValue({ error: null })
  branchByTierMock.mockReset().mockResolvedValue(undefined)
  notifyMock.mockReset()
  groupFetchMock.mockReset().mockResolvedValue({
    data: { group_id: 'group-aaa', status: 'AWAITING_PAYMENT', clinic_id: 'clinic-1', stripe_payment_intent_id: 'pi_group_1' },
    error: null,
  })
  // Deliberately not sorted: the text is tied to the lowest order_id.
  membersFetchMock.mockReset().mockResolvedValue({
    data: [
      { order_id: 'o-2', status: 'AWAITING_PAYMENT', pharmacy_id: 'pharm-1' },
      { order_id: 'o-1', status: 'AWAITING_PAYMENT', pharmacy_id: 'pharm-1' },
      { order_id: 'o-3', status: 'AWAITING_PAYMENT', pharmacy_id: 'pharm-2' },
    ],
    error: null,
  })
})

describe('bundle payment-confirmation text', () => {
  it('sends exactly one text for a paid bundle of three orders', async () => {
    await invoke()
    expect(notifyMock).toHaveBeenCalledTimes(1)
    expect(notifyMock).toHaveBeenCalledWith('o-1')
  })

  it('sends nothing on a redelivery where every member is already paid', async () => {
    casTransitionMock.mockResolvedValue({ wasAlreadyTransitioned: true })
    await invoke()
    expect(notifyMock).not.toHaveBeenCalled()
  })

  it('sends nothing when the group is already PAID (duplicate event)', async () => {
    groupFetchMock.mockResolvedValue({
      data: { group_id: 'group-aaa', status: 'PAID', clinic_id: 'clinic-1', stripe_payment_intent_id: 'pi_group_1' },
      error: null,
    })
    await invoke()
    expect(notifyMock).not.toHaveBeenCalled()
  })

  it('sends exactly one text across a partial failure and its retry', async () => {
    // Delivery 1: o-1 (the anchor) fails, o-2 and o-3 transition. Throws so Stripe retries.
    casTransitionMock.mockImplementation(async ({ orderId }: { orderId: string }) => {
      if (orderId === 'o-1') throw new Error('db blip')
      return { wasAlreadyTransitioned: false }
    })
    await expect(invoke()).rejects.toThrow()

    // Delivery 2: o-1 transitions now; o-2 and o-3 are already paid.
    membersFetchMock.mockResolvedValue({
      data: [
        { order_id: 'o-2', status: 'PAID_PROCESSING', pharmacy_id: 'pharm-1' },
        { order_id: 'o-1', status: 'AWAITING_PAYMENT', pharmacy_id: 'pharm-1' },
        { order_id: 'o-3', status: 'PAID_PROCESSING', pharmacy_id: 'pharm-2' },
      ],
      error: null,
    })
    casTransitionMock.mockImplementation(async ({ orderId }: { orderId: string }) =>
      ({ wasAlreadyTransitioned: orderId !== 'o-1' }))
    await invoke()

    expect(notifyMock).toHaveBeenCalledTimes(1)
    expect(notifyMock).toHaveBeenCalledWith('o-1')
  })

  it('a text that throws does not fail the handler or stop the group being marked PAID', async () => {
    notifyMock.mockImplementation(() => { throw new Error('twilio down') })
    await expect(invoke()).resolves.toBeUndefined()
    expect(groupUpdateMock).toHaveBeenCalled()
    expect(branchByTierMock).toHaveBeenCalledTimes(3)
  })
})
