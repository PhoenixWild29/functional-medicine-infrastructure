/**
 * @jest-environment node
 *
 * Solo payment_intent.succeeded — money path regression guard.
 *
 * The solo PI is a Connect DESTINATION charge (transfer_data.destination +
 * application_fee_amount, see /api/checkout/payment-intent). Stripe moves
 * the clinic's share itself at capture, so the webhook must NEVER create a
 * second transfer. These tests pin:
 *
 *   - stripe.transfers.create is never called on solo success
 *   - charge.transfer (Stripe's destination transfer) → orders.stripe_transfer_id
 *   - no transfer on the charge (POC placeholder) → column untouched, info log
 *   - a charge-retrieve failure does not block fulfilment (branchByTier)
 */

import type { NextRequest } from 'next/server'
import { POST } from '../route'

// ── Mocks ──────────────────────────────────────────────────────────

const constructEventMock    = jest.fn()
const transfersCreateMock   = jest.fn()
const chargesRetrieveMock   = jest.fn()
const casTransitionMock     = jest.fn()
const orderFetchMock        = jest.fn()
const orderUpdateMock       = jest.fn()
const pharmacyFetchMock     = jest.fn()
const sendSlackAlertMock    = jest.fn().mockResolvedValue(undefined)
const errorSpy              = jest.spyOn(console, 'error').mockImplementation(() => {})
const warnSpy               = jest.spyOn(console, 'warn').mockImplementation(() => {})
const infoSpy               = jest.spyOn(console, 'info').mockImplementation(() => {})

jest.mock('@/lib/env', () => ({
  serverEnv: { stripeWebhookSecret: () => 'whsec_test' },
}))

jest.mock('@/lib/stripe/client', () => ({
  createStripeClient: () => ({
    webhooks:  { constructEvent: (...args: unknown[]) => constructEventMock(...args) },
    transfers: { create: (args: unknown) => transfersCreateMock(args) },
    charges:   { retrieve: (id: string) => chargesRetrieveMock(id) },
  }),
}))

jest.mock('@/lib/orders/cas-transition', () => ({
  casTransition: (args: unknown) => casTransitionMock(args),
}))

jest.mock('@/lib/slack/client', () => ({
  sendSlackAlert: (args: unknown) => sendSlackAlertMock(args),
  buildAdapterFailureAlert: (args: unknown) => args,
}))

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table === 'webhook_events') {
        return {
          insert: () => ({
            select: () => ({
              single: async () => ({ data: { event_id: 'we-1' }, error: null }),
            }),
          }),
          update: () => ({ eq: async () => ({ error: null }) }),
        }
      }
      if (table === 'orders') {
        return {
          select: () => ({ eq: () => ({ single: () => orderFetchMock(), maybeSingle: () => orderFetchMock() }) }),
          update: (values: unknown) => ({
            eq: (col: string, val: unknown) => orderUpdateMock(values, col, val),
          }),
        }
      }
      if (table === 'pharmacies') {
        return {
          select: () => ({ eq: () => ({ single: () => pharmacyFetchMock() }) }),
        }
      }
      throw new Error(`Unexpected table in test: ${table}`)
    },
  }),
}))

// ── Helpers ────────────────────────────────────────────────────────

function makeSoloPi(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'pi_solo_1',
    object: 'payment_intent',
    amount: 32000,
    currency: 'usd',
    latest_charge: 'ch_solo_1',
    metadata: { order_id: 'o-1', clinic_id: 'clinic-1', platform: '8090ai' },
    ...overrides,
  }
}

async function deliver(pi: Record<string, unknown>) {
  const event = { id: 'evt_solo_1', type: 'payment_intent.succeeded', data: { object: pi } }
  constructEventMock.mockReturnValue(event)
  const request = {
    text: async () => JSON.stringify(event),
    headers: { get: () => 't=1,v1=sig' },
  } as unknown as NextRequest
  return POST(request)
}

// ── Setup ──────────────────────────────────────────────────────────

beforeEach(() => {
  constructEventMock.mockReset()
  transfersCreateMock.mockReset().mockResolvedValue({ id: 'tr_should_not_exist' })
  chargesRetrieveMock.mockReset().mockResolvedValue({ id: 'ch_solo_1', transfer: 'tr_dest_1' })
  casTransitionMock.mockReset().mockResolvedValue({ wasAlreadyTransitioned: false })
  orderFetchMock.mockReset().mockResolvedValue({
    data: { order_id: 'o-1', status: 'AWAITING_PAYMENT', pharmacy_id: 'pharm-1' },
    error: null,
  })
  orderUpdateMock.mockReset().mockResolvedValue({ error: null })
  pharmacyFetchMock.mockReset().mockResolvedValue({ data: { integration_tier: 'TIER_4_FAX' } })
  sendSlackAlertMock.mockClear()
  errorSpy.mockClear()
  warnSpy.mockClear()
  infoSpy.mockClear()
})

afterAll(() => {
  errorSpy.mockRestore()
  warnSpy.mockRestore()
  infoSpy.mockRestore()
})

// ── Tests ──────────────────────────────────────────────────────────

describe('stripe webhook — solo payment_intent.succeeded (destination charge)', () => {
  it('never calls stripe.transfers.create on a solo payment_intent.succeeded', async () => {
    const res = await deliver(makeSoloPi())

    expect(res.status).toBe(200)
    expect(transfersCreateMock).not.toHaveBeenCalled()
    expect(sendSlackAlertMock).not.toHaveBeenCalled()
  })

  it("stores the destination charge's transfer id on the order and still fulfils", async () => {
    await deliver(makeSoloPi())

    expect(chargesRetrieveMock).toHaveBeenCalledWith('ch_solo_1')
    expect(orderUpdateMock).toHaveBeenCalledWith({ stripe_transfer_id: 'tr_dest_1' }, 'order_id', 'o-1')
    expect(casTransitionMock).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'o-1', expectedStatus: 'PAID_PROCESSING', newStatus: 'FAX_QUEUED' }),
    )
  })

  it('reads the transfer from an already-expanded latest_charge without a retrieve', async () => {
    await deliver(makeSoloPi({ latest_charge: { id: 'ch_solo_1', transfer: { id: 'tr_dest_2' } } }))

    expect(chargesRetrieveMock).not.toHaveBeenCalled()
    expect(orderUpdateMock).toHaveBeenCalledWith({ stripe_transfer_id: 'tr_dest_2' }, 'order_id', 'o-1')
  })

  it('leaves stripe_transfer_id null and logs at info when the charge has no transfer (POC placeholder)', async () => {
    chargesRetrieveMock.mockResolvedValue({ id: 'ch_solo_1', transfer: null })

    const res = await deliver(makeSoloPi())

    expect(res.status).toBe(200)
    expect(orderUpdateMock).not.toHaveBeenCalled()
    expect(transfersCreateMock).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('has no destination transfer'))
    expect(casTransitionMock).toHaveBeenCalledWith(expect.objectContaining({ newStatus: 'FAX_QUEUED' }))
  })

  it('does not block fulfilment when the charge lookup fails', async () => {
    chargesRetrieveMock.mockRejectedValue(new Error('stripe down'))

    const res = await deliver(makeSoloPi())

    expect(res.status).toBe(200)
    expect(orderUpdateMock).not.toHaveBeenCalled()
    expect(transfersCreateMock).not.toHaveBeenCalled()
    expect(casTransitionMock).toHaveBeenCalledWith(expect.objectContaining({ newStatus: 'FAX_QUEUED' }))
  })

  it('skips transfer bookkeeping entirely on an already-transitioned redelivery', async () => {
    casTransitionMock.mockResolvedValue({ wasAlreadyTransitioned: true })

    await deliver(makeSoloPi())

    expect(chargesRetrieveMock).not.toHaveBeenCalled()
    expect(transfersCreateMock).not.toHaveBeenCalled()
    expect(casTransitionMock).toHaveBeenCalledTimes(1)
  })
})
