/**
 * @jest-environment node
 *
 * The payments ledger is written from the Stripe webhook (record-only):
 *   - solo payment_intent.succeeded: the order's lines, keyed by the event
 *     id, from the payment that just marked it paid (and on the stranded
 *     resume path, where the write is idempotent); not on a redelivery
 *     that finds the order already past PAID_PROCESSING
 *   - bundle: the members' lines on the group
 *   - charge.dispute.created: the dispute line
 *   - a ledger write that fails is logged; it never fails the webhook,
 *     the payment, fulfilment or the money path (no transfers created)
 * Stripe, the ledger writer and the database are mocked.
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
const recordPaymentMock   = jest.fn()
const recordDisputeMock   = jest.fn()
const disputeUpsertMock   = jest.fn()
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

jest.mock('@/lib/payments/ledger', () => ({
  recordPaymentLedger: (_s: unknown, a: unknown) => recordPaymentMock(a),
  recordDisputeLedger: (_s: unknown, a: unknown) => recordDisputeMock(a),
  recordLatePaymentLedger: jest.fn(async () => ({ ok: true, inserted: 0 })),
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
              // .is() awaited (bundle members), or .is().maybeSingle() (the solo lookup by PaymentIntent, Payment Flow v1.1).
              is:          () => Object.assign(Promise.resolve(membersFetchMock()), { maybeSingle: () => orderFetchMock() }),
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
      if (table === 'disputes' || table === 'dispute_orders') {
        return { upsert: (v: unknown) => disputeUpsertMock(table, v) }
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
    id: 'pi_solo_1', object: 'payment_intent', latest_charge: 'ch_1', currency: 'usd', amount: 20900,
    metadata: { order_id: 'o-1', clinic_id: 'clinic-1', platform: '8090ai' },
  }
}

function groupPi() {
  return {
    id: 'pi_group_1', object: 'payment_intent', latest_charge: 'ch_g', currency: 'usd', amount: 40900,
    metadata: { payment_group_id: 'group-aaa', clinic_id: 'clinic-1', platform: '8090ai' },
  }
}

async function deliver(type: string, object: Record<string, unknown>, eventId = 'evt_1') {
  const event = { id: eventId, type, data: { object } }
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
  orderFetchMock.mockReset().mockResolvedValue({ data: { order_id: 'o-1', status: 'AWAITING_PAYMENT', pharmacy_id: 'pharm-1' }, error: null })
  orderUpdateMock.mockReset().mockResolvedValue({ error: null })
  membersFetchMock.mockReset().mockResolvedValue({
    data: [{ order_id: 'o-1', status: 'AWAITING_PAYMENT', pharmacy_id: 'pharm-1' }, { order_id: 'o-2', status: 'AWAITING_PAYMENT', pharmacy_id: 'pharm-1' }],
    error: null,
  })
  groupFetchMock.mockReset().mockResolvedValue({ data: { group_id: 'group-aaa', status: 'AWAITING_PAYMENT', clinic_id: 'clinic-1', stripe_payment_intent_id: 'pi_group_1' }, error: null })
  groupUpdateMock.mockReset().mockResolvedValue({ error: null })
  pharmacyFetchMock.mockReset().mockResolvedValue({ data: { integration_tier: 'TIER_4_FAX' } })
  eventInsertMock.mockReset().mockResolvedValue({ data: { event_id: 'we-1' }, error: null })
  eventExistingMock.mockReset()
  routeOrderMock.mockReset().mockResolvedValue({ outcome: 'accepted', tier: 'TIER_4_FAX' })
  sendConfirmMock.mockReset().mockResolvedValue({ outcome: 'sent', messageSid: 'SM1' })
  recordPaymentMock.mockReset().mockResolvedValue({ ok: true, inserted: 4 })
  recordDisputeMock.mockReset().mockResolvedValue({ ok: true, inserted: 1 })
  disputeUpsertMock.mockReset().mockResolvedValue({ error: null })
  errorSpy.mockClear()
})

describe('ledger from the Stripe webhook', () => {
  it('solo: the order is recorded, keyed by the event, with the charge id', async () => {
    const res = await deliver('payment_intent.succeeded', soloPi(), 'evt_pay_1')
    expect(res.status).toBe(200)
    expect(recordPaymentMock).toHaveBeenCalledTimes(1)
    expect(recordPaymentMock).toHaveBeenCalledWith({
      eventId: 'evt_pay_1', paymentIntentId: 'pi_solo_1', chargeId: 'ch_1', currency: 'usd', orderIds: ['o-1'], paymentGroupId: null,
    })
  })

  it('solo: a redelivery that finds the order already past paid records nothing', async () => {
    orderFetchMock.mockResolvedValue({ data: { order_id: 'o-1', status: 'SUBMISSION_PENDING', pharmacy_id: 'pharm-1' }, error: null })
    casTransitionMock.mockResolvedValue({ wasAlreadyTransitioned: true })
    await deliver('payment_intent.succeeded', soloPi())
    expect(recordPaymentMock).not.toHaveBeenCalled()
  })

  it('solo: the stranded resume path records again (the write is idempotent on the event id)', async () => {
    orderFetchMock.mockResolvedValue({ data: { order_id: 'o-1', status: 'PAID_PROCESSING', pharmacy_id: 'pharm-1' }, error: null })
    casTransitionMock.mockResolvedValue({ wasAlreadyTransitioned: true })
    await deliver('payment_intent.succeeded', soloPi())
    expect(recordPaymentMock).toHaveBeenCalledTimes(1)
  })

  it('a ledger write that fails or throws never fails the webhook, fulfilment or the money path', async () => {
    recordPaymentMock.mockResolvedValue({ ok: false, error: 'down' })
    expect((await deliver('payment_intent.succeeded', soloPi())).status).toBe(200)
    recordPaymentMock.mockRejectedValue(new Error('boom'))
    expect((await deliver('payment_intent.succeeded', soloPi(), 'evt_2')).status).toBe(200)
    expect(routeOrderMock).toHaveBeenCalled()
    expect(transfersCreateMock).not.toHaveBeenCalled()
  })

  it('bundle: the members are recorded on the group, keyed by the event', async () => {
    await deliver('payment_intent.succeeded', groupPi(), 'evt_grp_1')
    expect(recordPaymentMock).toHaveBeenCalledWith({
      eventId: 'evt_grp_1', paymentIntentId: 'pi_group_1', chargeId: 'ch_g', currency: 'usd', orderIds: ['o-1', 'o-2'], paymentGroupId: 'group-aaa',
    })
  })

  it('a dispute is recorded, keyed by the event', async () => {
    const dispute = { id: 'du_1', object: 'dispute', amount: 20900, currency: 'usd', status: 'needs_response', reason: 'fraudulent', payment_intent: 'pi_solo_1', metadata: { order_id: 'o-1', clinic_id: 'clinic-1', platform: '8090ai' } }
    groupFetchMock.mockResolvedValue({ data: null, error: null })
    orderFetchMock.mockResolvedValue({ data: { order_id: 'o-1', status: 'DELIVERED', payment_group_id: null, stripe_payment_intent_id: 'pi_solo_1', retail_price_snapshot: 200 }, error: null })
    const res = await deliver('charge.dispute.created', dispute, 'evt_dsp_1')
    expect(res.status).toBe(200)
    expect(recordDisputeMock).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 'evt_dsp_1', disputeId: 'du_1', amountCents: 20900, currency: 'usd', orderId: 'o-1', paymentGroupId: null,
    }))
  })
})
