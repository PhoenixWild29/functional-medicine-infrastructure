/**
 * @jest-environment node
 *
 * Stripe webhook payment-confirmation text (C7 follow-up).
 *
 *   - solo payment_intent.succeeded: exactly one text, after the response
 *   - a redelivery (CAS already transitioned, including the stranded
 *     PAID_PROCESSING resume path) sends nothing
 *   - a duplicate event already processed (webhook_events idempotency)
 *     sends nothing
 *   - a text that fails is logged and the webhook still answers 200, with
 *     the money bookkeeping and fulfilment unchanged
 *   - a bundle PI sends exactly one text through the route
 *
 * Stripe, Twilio and the database are mocked; nothing is sent.
 */

import type { NextRequest } from 'next/server'
import { POST } from '../route'

const constructEventMock  = jest.fn()
const transfersCreateMock = jest.fn()
const chargesRetrieveMock = jest.fn()
const casTransitionMock   = jest.fn()
const orderFetchMock      = jest.fn()
const orderUpdateMock     = jest.fn()
const membersFetchMock    = jest.fn()
const groupFetchMock      = jest.fn()
const groupUpdateMock     = jest.fn()
const pharmacyFetchMock   = jest.fn()
const eventInsertMock     = jest.fn()
const eventExistingMock   = jest.fn()
const routeOrderMock      = jest.fn()
const sendConfirmMock     = jest.fn()
const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
jest.spyOn(console, 'warn').mockImplementation(() => {})
jest.spyOn(console, 'info').mockImplementation(() => {})

jest.mock('@/lib/env', () => ({
  serverEnv: { stripeWebhookSecret: () => 'whsec_test', pharmacySubmissionsEnabled: () => true },
}))

jest.mock('@/lib/stripe/client', () => ({
  createStripeClient: () => ({
    webhooks:  { constructEvent: (...a: unknown[]) => constructEventMock(...a) },
    transfers: { create: (a: unknown) => transfersCreateMock(a) },
    charges:   { retrieve: (id: string) => chargesRetrieveMock(id) },
    refunds:   { create: jest.fn() },
  }),
}))

jest.mock('@/lib/orders/cas-transition', () => ({
  casTransition: (a: unknown) => casTransitionMock(a),
}))

let afterQueue: Array<() => unknown> = []
jest.mock('next/server', () => ({
  ...jest.requireActual('next/server'),
  after: (task: unknown) => { afterQueue.push(typeof task === 'function' ? task as () => unknown : () => task) },
}))
async function flushAfter() { while (afterQueue.length > 0) await afterQueue.shift()!() }

jest.mock('@/lib/adapters/routing-engine', () => ({
  routeOrder: (p: unknown) => routeOrderMock(p),
}))

jest.mock('@/lib/sms/triggers', () => ({
  sendPaymentConfirmationSms: (orderId: string) => sendConfirmMock(orderId),
}))

jest.mock('@/lib/slack/client', () => ({
  sendSlackAlert: async () => undefined,
  buildAdapterFailureAlert: (a: unknown) => a,
}))

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table === 'webhook_events') {
        return {
          insert: () => ({ select: () => ({ single: () => eventInsertMock() }) }),
          select: () => ({ eq: () => ({ maybeSingle: () => eventExistingMock() }) }),
          update: () => ({ eq: async () => ({ error: null }) }),
        }
      }
      if (table === 'orders') {
        return {
          select: () => ({
            eq: () => ({
              single:      () => orderFetchMock(),
              maybeSingle: () => orderFetchMock(),
              is:          () => membersFetchMock(),
            }),
          }),
          update: (values: unknown) => ({
            eq: (c: string, v: unknown) => {
              // eq() awaited, or eq().is().is() for the bundle's PaymentIntent stamp (Payment Flow v1.1).
              const result = orderUpdateMock(values, c, v)
              return Object.assign(Promise.resolve(result), { is: () => ({ is: async () => ({ error: null }) }) })
            },
          }),
        }
      }
      if (table === 'payment_groups') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => groupFetchMock() }) }),
          update: () => ({ eq: () => ({ eq: () => groupUpdateMock() }) }),
        }
      }
      if (table === 'pharmacies') {
        return { select: () => ({ eq: () => ({ single: () => pharmacyFetchMock() }) }) }
      }
      throw new Error(`Unexpected table in test: ${table}`)
    },
  }),
}))

function soloPi() {
  return {
    id: 'pi_solo_1', object: 'payment_intent', latest_charge: 'ch_1',
    metadata: { order_id: 'o-1', clinic_id: 'clinic-1', platform: '8090ai' },
  }
}

function groupPi() {
  return {
    id: 'pi_group_1', object: 'payment_intent', latest_charge: 'ch_g',
    metadata: { payment_group_id: 'group-aaa', clinic_id: 'clinic-1', platform: '8090ai' },
  }
}

async function deliver(pi: Record<string, unknown>, eventId = 'evt_1') {
  const event = { id: eventId, type: 'payment_intent.succeeded', data: { object: pi } }
  constructEventMock.mockReturnValue(event)
  const res = await POST({
    text: async () => JSON.stringify(event),
    headers: { get: () => 't=1,v1=sig' },
  } as unknown as NextRequest)
  await flushAfter()
  return res
}

beforeEach(() => {
  afterQueue = []
  constructEventMock.mockReset()
  transfersCreateMock.mockReset()
  chargesRetrieveMock.mockReset().mockResolvedValue({ id: 'ch_1', transfer: 'tr_dest_1' })
  casTransitionMock.mockReset().mockResolvedValue({ wasAlreadyTransitioned: false })
  orderFetchMock.mockReset().mockResolvedValue({
    data: { order_id: 'o-1', status: 'AWAITING_PAYMENT', pharmacy_id: 'pharm-1' }, error: null,
  })
  orderUpdateMock.mockReset().mockResolvedValue({ error: null })
  membersFetchMock.mockReset().mockResolvedValue({
    data: [
      { order_id: 'o-2', status: 'AWAITING_PAYMENT', pharmacy_id: 'pharm-1' },
      { order_id: 'o-1', status: 'AWAITING_PAYMENT', pharmacy_id: 'pharm-1' },
    ],
    error: null,
  })
  groupFetchMock.mockReset().mockResolvedValue({
    data: { group_id: 'group-aaa', status: 'AWAITING_PAYMENT', clinic_id: 'clinic-1', stripe_payment_intent_id: 'pi_group_1' },
    error: null,
  })
  groupUpdateMock.mockReset().mockResolvedValue({ error: null })
  pharmacyFetchMock.mockReset().mockResolvedValue({ data: { integration_tier: 'TIER_4_FAX' } })
  eventInsertMock.mockReset().mockResolvedValue({ data: { event_id: 'we-1' }, error: null })
  eventExistingMock.mockReset()
  routeOrderMock.mockReset().mockResolvedValue({ outcome: 'accepted', tier: 'TIER_4_FAX' })
  sendConfirmMock.mockReset().mockResolvedValue({ outcome: 'sent', messageSid: 'SM1' })
  errorSpy.mockClear()
})

describe('stripe webhook payment-confirmation text', () => {
  it('solo: sends exactly one text when the payment succeeds', async () => {
    const res = await deliver(soloPi())
    expect(res.status).toBe(200)
    expect(sendConfirmMock).toHaveBeenCalledTimes(1)
    expect(sendConfirmMock).toHaveBeenCalledWith('o-1')
  })

  it('solo: sends nothing on a redelivery that finds the order already paid', async () => {
    casTransitionMock.mockResolvedValue({ wasAlreadyTransitioned: true })
    await deliver(soloPi())
    expect(sendConfirmMock).not.toHaveBeenCalled()
  })

  it('solo: sends nothing on the stranded resume path (paid earlier, routing failed)', async () => {
    orderFetchMock.mockResolvedValue({
      data: { order_id: 'o-1', status: 'PAID_PROCESSING', pharmacy_id: 'pharm-1' }, error: null,
    })
    casTransitionMock.mockResolvedValue({ wasAlreadyTransitioned: true })
    await deliver(soloPi())
    expect(routeOrderMock).toHaveBeenCalled()        // resume still fulfils
    expect(sendConfirmMock).not.toHaveBeenCalled()  // but texts nothing
  })

  it('a duplicate event already processed (webhook_events) sends nothing', async () => {
    eventInsertMock.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate' } })
    eventExistingMock.mockResolvedValue({
      data: { event_id: 'we-1', processed_at: '2026-10-06T00:00:00Z', error: null }, error: null,
    })
    const res = await deliver(soloPi())
    expect(res.status).toBe(200)
    expect(casTransitionMock).not.toHaveBeenCalled()
    expect(sendConfirmMock).not.toHaveBeenCalled()
  })

  it('a text that fails is logged; the webhook answers 200 and money + fulfilment are unchanged', async () => {
    sendConfirmMock.mockRejectedValue(new Error('twilio down'))
    const res = await deliver(soloPi())
    expect(res.status).toBe(200)
    expect(orderUpdateMock).toHaveBeenCalledWith({ stripe_transfer_id: 'tr_dest_1' }, 'order_id', 'o-1')
    expect(transfersCreateMock).not.toHaveBeenCalled()
    expect(routeOrderMock).toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('payment confirmation text'), expect.anything())
  })

  it('a text that returns failed is logged and the webhook still answers 200', async () => {
    sendConfirmMock.mockResolvedValue({ outcome: 'failed', reason: 'dedup_check_failed' })
    const res = await deliver(soloPi())
    expect(res.status).toBe(200)
    expect(sendConfirmMock).toHaveBeenCalledTimes(1)
  })

  it('bundle: sends exactly one text through the route', async () => {
    const res = await deliver(groupPi())
    expect(res.status).toBe(200)
    expect(sendConfirmMock).toHaveBeenCalledTimes(1)
    expect(sendConfirmMock).toHaveBeenCalledWith('o-1')
  })
})
