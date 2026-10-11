/**
 * @jest-environment node
 *
 * Payment Flow v1.1: the four new event types go through the same webhook
 * pipeline as the existing ones: signature check, event idempotency
 * (webhook_events), then their handler with the Stripe event id. A handler
 * that throws answers 500 so Stripe redelivers; a delivery of an event
 * that already succeeded is skipped. Stripe is mocked.
 */

import type { NextRequest } from 'next/server'

const constructEventMock = jest.fn()
const paymentFailed = jest.fn().mockResolvedValue(undefined)
const chargeRefunded = jest.fn().mockResolvedValue(undefined)
const disputeStatus = jest.fn().mockResolvedValue(undefined)

jest.mock('@/lib/env', () => ({ serverEnv: { stripeWebhookSecret: () => 'whsec_test', pharmacySubmissionsEnabled: () => true } }))
jest.mock('@/lib/stripe/client', () => ({
  createStripeClient: () => ({ webhooks: { constructEvent: (...a: unknown[]) => constructEventMock(...a) } }),
}))
jest.mock('../handle-payment-failed', () => ({ handlePaymentFailed: (...a: unknown[]) => paymentFailed(...a) }))
jest.mock('../handle-charge-refunded', () => ({ handleChargeRefunded: (...a: unknown[]) => chargeRefunded(...a) }))
jest.mock('../handle-dispute-status', () => ({ handleDisputeStatusChanged: (...a: unknown[]) => disputeStatus(...a) }))
jest.mock('@/lib/slack/client', () => ({ sendSlackAlert: jest.fn(), buildAdapterFailureAlert: jest.fn(), buildStripePaymentAlert: jest.fn() }))

/** The webhook_events row, so "already succeeded" is modelled. */
let eventRow: { event_id: string; processed_at: string | null; error: string | null } | null = null
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table !== 'webhook_events') throw new Error(`unexpected table ${table}`)
      return {
        insert: () => ({ select: () => ({ single: async () => {
          if (eventRow) return { data: null, error: { code: '23505', message: 'duplicate key' } }
          eventRow = { event_id: 'we-1', processed_at: null, error: null }
          return { data: { event_id: 'we-1' }, error: null }
        } }) }),
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: eventRow, error: null }) }) }),
        update: (values: Record<string, unknown>) => ({ eq: async () => { if (eventRow) Object.assign(eventRow, values); return { error: null } } }),
      }
    },
  }),
}))

import { POST } from '../route'

function request(): NextRequest {
  return { text: async () => '{}', headers: { get: (h: string) => (h === 'stripe-signature' ? 't=1,v1=sig' : null) } } as unknown as NextRequest
}
const deliver = (type: string, object: Record<string, unknown>, id = 'evt_1') => {
  constructEventMock.mockReturnValue({ id, type, data: { object } })
  return POST(request())
}

beforeEach(() => {
  eventRow = null
  for (const m of [paymentFailed, chargeRefunded, disputeStatus]) m.mockClear()
  for (const l of ['info', 'warn', 'error'] as const) jest.spyOn(console, l).mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

it('payment_intent.payment_failed reaches its handler with the event id', async () => {
  const res = await deliver('payment_intent.payment_failed', { id: 'pi_1' })
  expect(res.status).toBe(200)
  expect(paymentFailed).toHaveBeenCalledWith(expect.objectContaining({ id: 'pi_1' }), 'evt_1', expect.any(Object))
})

it('the same payment_failed event twice: the second delivery is skipped by the event idempotency', async () => {
  await deliver('payment_intent.payment_failed', { id: 'pi_1' })
  const second = await deliver('payment_intent.payment_failed', { id: 'pi_1' })
  expect(await second.json()).toEqual({ status: 'duplicate' })
  expect(paymentFailed).toHaveBeenCalledTimes(1)
})

it('charge.refunded reaches its handler', async () => {
  await deliver('charge.refunded', { id: 'ch_1' })
  expect(chargeRefunded).toHaveBeenCalledWith(expect.objectContaining({ id: 'ch_1' }), 'evt_1', expect.objectContaining({ recordRefundInLedger: expect.any(Function) }))
})

it.each(['charge.dispute.updated', 'charge.dispute.closed'])('%s reaches the dispute status handler', async type => {
  await deliver(type, { id: 'dp_1' })
  expect(disputeStatus).toHaveBeenCalledWith(expect.objectContaining({ id: 'dp_1' }), type, 'evt_1', expect.any(Object))
})

it('a handler that throws: 500 and the event stays unprocessed (Stripe redelivers)', async () => {
  chargeRefunded.mockRejectedValueOnce(new Error('db down'))
  const res = await deliver('charge.refunded', { id: 'ch_1' })
  expect(res.status).toBe(500)
  expect(eventRow?.processed_at).toBeNull()
})

it('a bad signature is refused before any handler runs', async () => {
  constructEventMock.mockImplementation(() => { throw new Error('bad sig') })
  const res = await POST(request())
  expect(res.status).toBe(400)
  expect(paymentFailed).not.toHaveBeenCalled()
})
