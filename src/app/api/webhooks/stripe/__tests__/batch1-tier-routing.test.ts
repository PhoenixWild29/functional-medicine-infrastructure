/**
 * @jest-environment node
 *
 * Batch 1, finding 5: a failed pharmacy-tier lookup must not route an Rx
 * down the API path.
 *
 * branchByTier read the tier as `{ data }` with the error discarded. On
 * failure `tier` was undefined, so the else branch ran: SUBMISSION_PENDING
 * with metadata tier 'TIER_1_API'. A fax-only pharmacy's prescription —
 * including controlled substances that must go by fax — was routed to an
 * API adapter, and the webhook still answered 200, so Stripe never
 * retried.
 *
 * The fix: a lookup that failed has no answer, so it throws. The route
 * already turns a thrown handler into a 500, which is what makes Stripe
 * redeliver.
 */

import type { NextRequest } from 'next/server'
import { POST } from '../route'

const constructEventMock  = jest.fn()
const casTransitionMock   = jest.fn()
const orderFetchMock      = jest.fn()
const orderUpdateMock     = jest.fn()
const pharmacyFetchMock   = jest.fn()
const chargesRetrieveMock = jest.fn()
const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
const warnSpy  = jest.spyOn(console, 'warn').mockImplementation(() => {})
const infoSpy  = jest.spyOn(console, 'info').mockImplementation(() => {})

jest.mock('@/lib/env', () => ({ serverEnv: { stripeWebhookSecret: () => 'whsec_test' } }))

jest.mock('@/lib/stripe/client', () => ({
  createStripeClient: () => ({
    webhooks:  { constructEvent: (...args: unknown[]) => constructEventMock(...args) },
    transfers: { create: jest.fn() },
    charges:   { retrieve: (id: string) => chargesRetrieveMock(id) },
  }),
}))

jest.mock('@/lib/orders/cas-transition', () => ({
  casTransition: (args: unknown) => casTransitionMock(args),
}))

jest.mock('@/lib/slack/client', () => ({
  sendSlackAlert: jest.fn().mockResolvedValue(undefined),
  buildAdapterFailureAlert: (args: unknown) => args,
}))

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table === 'webhook_events') {
        return {
          insert: () => ({ select: () => ({ single: async () => ({ data: { event_id: 'we-1' }, error: null }) }) }),
          update: () => ({ eq: async () => ({ error: null }) }),
        }
      }
      if (table === 'orders') {
        return {
          select: () => ({ eq: () => ({ single: () => orderFetchMock() }) }),
          update: (values: unknown) => ({ eq: (col: string, val: unknown) => orderUpdateMock(values, col, val) }),
        }
      }
      if (table === 'pharmacies') {
        return { select: () => ({ eq: () => ({ single: () => pharmacyFetchMock() }) }) }
      }
      throw new Error(`Unexpected table in test: ${table}`)
    },
  }),
}))

async function deliver() {
  const event = {
    id: 'evt_tier_1',
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: 'pi_tier_1', object: 'payment_intent', amount: 32000, currency: 'usd',
        latest_charge: 'ch_1', metadata: { order_id: 'o-1', clinic_id: 'clinic-1' },
      },
    },
  }
  constructEventMock.mockReturnValue(event)
  return POST({
    text: async () => JSON.stringify(event),
    headers: { get: () => 't=1,v1=sig' },
  } as unknown as NextRequest)
}

/** Every CAS call the handler made, by target status. */
const casTargets = () => casTransitionMock.mock.calls.map(c => (c[0] as { newStatus: string }).newStatus)

beforeEach(() => {
  constructEventMock.mockReset()
  casTransitionMock.mockReset().mockResolvedValue({ wasAlreadyTransitioned: false })
  orderFetchMock.mockReset().mockResolvedValue({
    data: { order_id: 'o-1', status: 'AWAITING_PAYMENT', pharmacy_id: 'pharm-1' }, error: null,
  })
  orderUpdateMock.mockReset().mockResolvedValue({ error: null })
  chargesRetrieveMock.mockReset().mockResolvedValue({ id: 'ch_1', transfer: null })
  pharmacyFetchMock.mockReset().mockResolvedValue({ data: { integration_tier: 'TIER_4_FAX' }, error: null })
  errorSpy.mockClear(); warnSpy.mockClear(); infoSpy.mockClear()
})

afterAll(() => { errorSpy.mockRestore(); warnSpy.mockRestore(); infoSpy.mockRestore() })

describe('branchByTier when the pharmacy tier cannot be read', () => {
  it('never routes to the API path on a lookup error', async () => {
    pharmacyFetchMock.mockResolvedValue({ data: null, error: { message: 'connection reset', code: '08006' } })

    await deliver()

    expect(casTargets()).not.toContain('SUBMISSION_PENDING')
  })

  it('returns 500 so Stripe redelivers, instead of marking it done', async () => {
    pharmacyFetchMock.mockResolvedValue({ data: null, error: { message: 'connection reset', code: '08006' } })

    const res = await deliver()

    expect(res.status).toBe(500)
  })

  it('logs the failure with the [stripe-webhook] prefix', async () => {
    pharmacyFetchMock.mockResolvedValue({ data: null, error: { message: 'connection reset', code: '08006' } })

    await deliver()

    expect(errorSpy.mock.calls.some(c => String(c[0]).includes('[stripe-webhook]'))).toBe(true)
  })

  it('a pharmacy row that is missing is also not assumed to be API', async () => {
    pharmacyFetchMock.mockResolvedValue({ data: null, error: null })

    const res = await deliver()

    expect(casTargets()).not.toContain('SUBMISSION_PENDING')
    expect(res.status).toBe(500)
  })

  it('a fax pharmacy still goes to FAX_QUEUED', async () => {
    const res = await deliver()

    expect(casTargets()).toContain('FAX_QUEUED')
    expect(res.status).toBe(200)
  })

  it('an API pharmacy still goes to SUBMISSION_PENDING', async () => {
    pharmacyFetchMock.mockResolvedValue({ data: { integration_tier: 'TIER_1_API' }, error: null })

    const res = await deliver()

    expect(casTargets()).toContain('SUBMISSION_PENDING')
    expect(res.status).toBe(200)
  })
})
