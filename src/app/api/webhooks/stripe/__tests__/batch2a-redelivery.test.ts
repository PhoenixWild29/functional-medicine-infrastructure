/**
 * @jest-environment node
 *
 * Batch 2, PR A: a Stripe webhook that hits a database error must be
 * retried, and a retry must complete the order exactly once.
 *
 * Handlers used to `return` on a DB error. The route only knows a
 * handler failed when it throws, so a returned error was stamped
 * processed and answered 200 — Stripe never redelivered, and a paid
 * order sat in AWAITING_PAYMENT until the expiry cron expired it.
 *
 * Handlers now throw on a DB error, the route answers 500 and leaves the
 * event unprocessed, and Stripe's redelivery completes the work. The
 * redelivery is idempotent: the order changes state once, not twice —
 * including when the first delivery failed AFTER the payment transition,
 * where the retry must resume routing rather than skip it.
 *
 * This harness models the two pieces of state that matter — the order's
 * status and the webhook_events row — so "once" is measured, not assumed.
 * Stripe is mocked throughout; nothing here can touch a real account.
 */

import type { NextRequest } from 'next/server'
import { POST } from '../route'

// ── Modelled state ─────────────────────────────────────────────────

let orderStatus = 'AWAITING_PAYMENT'
const transitions: string[] = []
let eventRow: { event_id: string; processed_at: string | null; error: string | null } | null = null

/** Failure switches, each consumed by the next matching call. */
let failOrderLookup = 0
let failPharmacyLookup = 0
let failDedupLookup = false
let failAccountUpdate = false

const constructEventMock = jest.fn()
const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
const warnSpy  = jest.spyOn(console, 'warn').mockImplementation(() => {})
const infoSpy  = jest.spyOn(console, 'info').mockImplementation(() => {})

jest.mock('@/lib/env', () => ({ serverEnv: { stripeWebhookSecret: () => 'whsec_test' } }))

jest.mock('@/lib/stripe/client', () => ({
  createStripeClient: () => ({
    webhooks:  { constructEvent: (...args: unknown[]) => constructEventMock(...args) },
    transfers: { create: jest.fn() },
    charges:   { retrieve: async () => ({ id: 'ch_1', transfer: 'tr_1' }) },
  }),
}))

// CAS against the modelled status: transitions only from the expected one.
jest.mock('@/lib/orders/cas-transition', () => ({
  casTransition: async (args: { expectedStatus: string; newStatus: string }) => {
    if (orderStatus !== args.expectedStatus) return { success: true, wasAlreadyTransitioned: true }
    orderStatus = args.newStatus
    transitions.push(args.newStatus)
    return { success: true, wasAlreadyTransitioned: false }
  },
}))

jest.mock('@/lib/slack/client', () => ({
  sendSlackAlert: jest.fn().mockResolvedValue(undefined),
  buildAdapterFailureAlert: (args: unknown) => args,
}))

const DB_ERROR = { message: 'connection reset', code: '08006' }

function chain(single: () => unknown): Record<string, unknown> {
  const c: Record<string, unknown> = {}
  for (const k of ['select', 'eq', 'is', 'in', 'order', 'limit']) c[k] = () => c
  c['single'] = async () => single()
  c['maybeSingle'] = async () => single()
  c['then'] = (resolve: (r: unknown) => unknown) => Promise.resolve(single()).then(resolve)
  return c
}

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table === 'webhook_events') {
        return {
          insert: () => ({
            select: () => ({
              single: async () => {
                if (eventRow) return { data: null, error: { code: '23505', message: 'duplicate key' } }
                eventRow = { event_id: 'we-1', processed_at: null, error: null }
                return { data: { event_id: 'we-1' }, error: null }
              },
            }),
          }),
          select: () => chain(() => (failDedupLookup ? { data: null, error: DB_ERROR } : { data: eventRow, error: null })),
          update: (values: { processed_at?: string; error?: string | null }) => ({
            eq: async () => {
              if (eventRow) Object.assign(eventRow, values)
              return { error: null }
            },
          }),
        }
      }
      if (table === 'orders') {
        return {
          select: () => chain(() => {
            if (failOrderLookup > 0) { failOrderLookup--; return { data: null, error: DB_ERROR } }
            return { data: { order_id: 'o-1', status: orderStatus, pharmacy_id: 'pharm-1', clinic_id: 'clinic-1' }, error: null }
          }),
          update: () => ({ eq: async () => ({ error: null }) }),
        }
      }
      if (table === 'pharmacies') {
        return {
          select: () => chain(() => {
            if (failPharmacyLookup > 0) { failPharmacyLookup--; return { data: null, error: DB_ERROR } }
            return { data: { integration_tier: 'TIER_4_FAX' }, error: null }
          }),
        }
      }
      if (table === 'clinics') {
        return {
          update: () => ({ eq: async () => (failAccountUpdate ? { error: DB_ERROR } : { error: null }) }),
        }
      }
      if (table === 'disputes' || table === 'dispute_orders') {
        return { upsert: async () => ({ error: null }) }
      }
      if (table === 'payment_groups') {
        return { select: () => chain(() => ({ data: null, error: null })) }
      }
      if (table === 'transfer_failures') {
        return { insert: async () => ({ error: null }) }
      }
      throw new Error(`Unexpected table in test: ${table}`)
    },
  }),
}))

async function deliver(event: { id: string; type: string; data: { object: unknown } }) {
  constructEventMock.mockReturnValue(event)
  return POST({
    text: async () => JSON.stringify(event),
    headers: { get: () => 't=1,v1=sig' },
  } as unknown as NextRequest)
}

const PAYMENT_SUCCEEDED = {
  id: 'evt_pay_1',
  type: 'payment_intent.succeeded',
  data: {
    object: {
      id: 'pi_1', object: 'payment_intent', amount: 32000, currency: 'usd',
      latest_charge: 'ch_1', metadata: { order_id: 'o-1', clinic_id: 'clinic-1' },
    },
  },
}

beforeEach(() => {
  orderStatus = 'AWAITING_PAYMENT'
  transitions.length = 0
  eventRow = null
  failOrderLookup = 0
  failPharmacyLookup = 0
  failDedupLookup = false
  failAccountUpdate = false
  errorSpy.mockClear(); warnSpy.mockClear(); infoSpy.mockClear()
})

afterAll(() => { errorSpy.mockRestore(); warnSpy.mockRestore(); infoSpy.mockRestore() })

describe('payment_intent.succeeded — a DB error is retried, not swallowed', () => {
  it('handler DB error returns 500 and does not mark the event processed', async () => {
    failOrderLookup = 1

    const res = await deliver(PAYMENT_SUCCEEDED)

    expect(res.status).toBe(500)
    expect(eventRow?.processed_at).toBeNull()
    expect(orderStatus).toBe('AWAITING_PAYMENT')
  })

  it('redelivery after the error completes the order once', async () => {
    failOrderLookup = 1
    await deliver(PAYMENT_SUCCEEDED)            // fails: 500, unprocessed
    const retry = await deliver(PAYMENT_SUCCEEDED)
    const replay = await deliver(PAYMENT_SUCCEEDED)   // a later duplicate

    expect(retry.status).toBe(200)
    expect(replay.status).toBe(200)
    // Paid, then routed to the fax pharmacy — each exactly once.
    expect(transitions).toEqual(['PAID_PROCESSING', 'FAX_QUEUED'])
    expect(eventRow?.processed_at).not.toBeNull()
  })

  it('a failure AFTER the payment transition is resumed on redelivery, still once', async () => {
    // The first delivery marks the order paid, then cannot read the
    // pharmacy tier and throws. The retry must route it — not skip it
    // because the payment transition has already happened.
    failPharmacyLookup = 1
    const first = await deliver(PAYMENT_SUCCEEDED)
    expect(first.status).toBe(500)
    expect(orderStatus).toBe('PAID_PROCESSING')

    const retry = await deliver(PAYMENT_SUCCEEDED)

    expect(retry.status).toBe(200)
    expect(transitions).toEqual(['PAID_PROCESSING', 'FAX_QUEUED'])
  })

  it('a dedup lookup that errors answers 500 rather than guessing', async () => {
    await deliver(PAYMENT_SUCCEEDED)            // succeeds and is recorded
    failDedupLookup = true

    const res = await deliver(PAYMENT_SUCCEEDED)

    expect(res.status).toBe(500)
    expect(transitions).toEqual(['PAID_PROCESSING', 'FAX_QUEUED'])
  })
})

describe('other handlers — a DB error is retried, not swallowed', () => {
  it('charge.dispute.created: an order lookup error returns 500, unprocessed', async () => {
    failOrderLookup = 1

    const res = await deliver({
      id: 'evt_dp_1', type: 'charge.dispute.created',
      data: { object: { id: 'dp_1', payment_intent: 'pi_1', amount: 32000, currency: 'usd', reason: 'fraudulent', status: 'needs_response', metadata: {} } },
    })

    expect(res.status).toBe(500)
    expect(eventRow?.processed_at).toBeNull()
  })

  it('transfer.failed: an order lookup error returns 500, unprocessed', async () => {
    failOrderLookup = 1

    const res = await deliver({
      id: 'evt_tr_1', type: 'transfer.failed',
      data: { object: { id: 'tr_1', amount: 32000, currency: 'usd', metadata: { order_id: 'o-1' } } },
    })

    expect(res.status).toBe(500)
    expect(eventRow?.processed_at).toBeNull()
  })

  it('account.updated: a clinic update error returns 500, unprocessed', async () => {
    failAccountUpdate = true

    const res = await deliver({
      id: 'evt_acct_1', type: 'account.updated',
      data: { object: { id: 'acct_1', details_submitted: true, charges_enabled: true, payouts_enabled: true } },
    })

    expect(res.status).toBe(500)
    expect(eventRow?.processed_at).toBeNull()
  })
})
