/**
 * @jest-environment node
 *
 * Launch blocker: a paid order must be sent to its pharmacy.
 *
 * payment_intent.succeeded used to stop at SUBMISSION_PENDING / FAX_QUEUED:
 * nothing called the routing engine, so no paid order ever reached a
 * pharmacy. The webhook now hands every paid order (solo and every bundle
 * member) to the routing engine AFTER the response is sent, so a slow
 * pharmacy API or portal never holds Stripe's request open.
 *
 * The harness models the order rows, the webhook_events row and the
 * after-response queue, so "exactly once" and "not before the response"
 * are measured. routeOrder is modelled by its claim: it submits only when
 * the order is still in the status it was called with (the real claim is
 * covered in lib/adapters/__tests__/routing-engine-submission.test.ts).
 * Stripe is mocked; nothing here can reach a real account or pharmacy.
 */

import type { NextRequest } from 'next/server'
import { POST } from '../route'

// ── Modelled state ─────────────────────────────────────────────────

interface OrderRow { order_id: string; status: string; pharmacy_id: string; payment_group_id: string | null; stripe_payment_intent_id: string | null }

let orders: Record<string, OrderRow> = {}
let groups: Record<string, { group_id: string; status: string; clinic_id: string; stripe_payment_intent_id: string | null }> = {}
let eventRows: Record<string, { event_id: string; processed_at: string | null; error: string | null }> = {}
const tiers: Record<string, string> = {
  'pharm-api':    'TIER_1_API',
  'pharm-portal': 'TIER_2_PORTAL',
  'pharm-fax':    'TIER_4_FAX',
}
/** Submissions the modelled routing engine actually made, per order. */
let submissions: Record<string, number> = {}
/** Work queued with after(); runs only when the test flushes it. */
let afterQueue: Array<() => unknown> = []
let failPharmacyLookups = 0

const routeOrderMock     = jest.fn()
const sendSlackAlertMock = jest.fn().mockResolvedValue(undefined)
const constructEventMock = jest.fn()
const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
const warnSpy  = jest.spyOn(console, 'warn').mockImplementation(() => {})
const infoSpy  = jest.spyOn(console, 'info').mockImplementation(() => {})

jest.mock('next/server', () => {
  const actual = jest.requireActual('next/server')
  return {
    ...actual,
    after: (task: unknown) => { afterQueue.push(typeof task === 'function' ? task as () => unknown : () => task) },
  }
})

jest.mock('@/lib/env', () => ({
  serverEnv: {
    stripeWebhookSecret: () => 'whsec_test',
    pharmacySubmissionsEnabled: () => process.env['PHARMACY_SUBMISSIONS_ENABLED'] === 'true',
  },
}))

jest.mock('@/lib/stripe/client', () => ({
  createStripeClient: () => ({
    webhooks: { constructEvent: (...args: unknown[]) => constructEventMock(...args) },
    charges:  { retrieve: async () => ({ id: 'ch_1', transfer: null }) },
    refunds:  { create: jest.fn() },
  }),
}))

jest.mock('@/lib/orders/cas-transition', () => ({
  casTransition: async (args: { orderId: string; expectedStatus: string; newStatus: string }) => {
    const row = orders[args.orderId]
    if (!row || row.status !== args.expectedStatus) return { success: true, wasAlreadyTransitioned: true, orderId: args.orderId }
    row.status = args.newStatus
    return { success: true, wasAlreadyTransitioned: false, orderId: args.orderId }
  },
}))

jest.mock('@/lib/adapters/routing-engine', () => ({
  routeOrder: (params: unknown) => routeOrderMock(params),
}))

jest.mock('@/lib/slack/client', () => ({
  sendSlackAlert: (...a: unknown[]) => sendSlackAlertMock(...a),
  buildAdapterFailureAlert: (args: unknown) => args,
}))

type Lookup = (filters: Record<string, unknown>) => unknown

function chain(single: Lookup, list?: Lookup): Record<string, unknown> {
  const filters: Record<string, unknown> = {}
  const c: Record<string, unknown> = {}
  c['select'] = () => c
  c['eq'] = (col: string, val: unknown) => { filters[col] = val; return c }
  for (const k of ['is', 'in', 'order', 'limit']) c[k] = () => c
  c['filters'] = filters
  c['single'] = async () => single(filters)
  c['maybeSingle'] = async () => single(filters)
  c['then'] = (resolve: (r: unknown) => unknown) => Promise.resolve((list ?? single)(filters)).then(resolve)
  return c
}

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table === 'webhook_events') {
        return {
          insert: (row: { external_event_id: string }) => ({
            select: () => ({
              single: async () => {
                if (eventRows[row.external_event_id]) return { data: null, error: { code: '23505', message: 'duplicate' } }
                eventRows[row.external_event_id] = { event_id: `we-${row.external_event_id}`, processed_at: null, error: null }
                return { data: { event_id: `we-${row.external_event_id}` }, error: null }
              },
            }),
          }),
          select: () => chain((f: Record<string, unknown>) => ({ data: eventRows[f['external_event_id'] as string] ?? null, error: null })),
          update: (values: { processed_at?: string; error?: string | null }) => ({
            eq: async (_col: string, eventId: string) => {
              const row = Object.values(eventRows).find(r => r.event_id === eventId)
              if (row) Object.assign(row, values)
              return { error: null }
            },
          }),
        }
      }
      if (table === 'orders') {
        return {
          select: () => chain(
            (f: Record<string, unknown>) => ({
              data: Object.values(orders).find(o => o.stripe_payment_intent_id === f['stripe_payment_intent_id']) ?? null,
              error: null,
            }),
            (f: Record<string, unknown>) => ({
              data: Object.values(orders).filter(o => o.payment_group_id === f['payment_group_id']),
              error: null,
            }),
          ),
          update: () => {
            // eq() awaited (transfer bookkeeping) or eq().is().is() (Payment
            // Flow v1.1: the bundle's PaymentIntent stamped on its members).
            const done = Promise.resolve({ error: null })
            const is2 = { is: async () => ({ error: null }) }
            return { eq: () => Object.assign(done, { is: () => is2 }) }
          },
        }
      }
      if (table === 'payment_groups') {
        return {
          select: () => chain((f: Record<string, unknown>) => ({ data: groups[f['group_id'] as string] ?? null, error: null })),
          update: (values: { status: string; stripe_payment_intent_id?: string }) => {
            const c = chain(() => ({ error: null }))
            c['then'] = (resolve: (r: unknown) => unknown) => {
              const g = groups[(c['filters'] as Record<string, unknown>)['group_id'] as string]
              if (g && g.status === (c['filters'] as Record<string, unknown>)['status']) Object.assign(g, values)
              return Promise.resolve({ error: null }).then(resolve)
            }
            return c
          },
        }
      }
      if (table === 'pharmacies') {
        return {
          select: () => chain((f: Record<string, unknown>) => {
            if (failPharmacyLookups > 0) { failPharmacyLookups -= 1; return { data: null, error: { message: 'connection reset' } } }
            return { data: { integration_tier: tiers[f['pharmacy_id'] as string] }, error: null }
          }),
        }
      }
      throw new Error(`Unexpected table in test: ${table}`)
    },
  }),
}))

// ── Helpers ────────────────────────────────────────────────────────

function soloEvent(id = 'evt_solo') {
  return {
    id, type: 'payment_intent.succeeded',
    data: { object: { id: 'pi_solo', object: 'payment_intent', latest_charge: null, metadata: { order_id: 'o-1', clinic_id: 'c-1', platform: '8090ai' } } },
  }
}

function groupEvent(id = 'evt_group') {
  return {
    id, type: 'payment_intent.succeeded',
    data: { object: { id: 'pi_group', object: 'payment_intent', latest_charge: null, metadata: { payment_group_id: 'g-1', clinic_id: 'c-1', order_count: '3', platform: '8090ai' } } },
  }
}

async function deliver(event: { id: string }) {
  constructEventMock.mockReturnValue(event)
  return POST({
    text: async () => JSON.stringify(event),
    headers: { get: () => 't=1,v1=sig' },
  } as unknown as NextRequest)
}

async function flushAfter() {
  while (afterQueue.length > 0) {
    const task = afterQueue.shift()!
    await task()
  }
}

const routedOrderIds = () => routeOrderMock.mock.calls.map(c => (c[0] as { orderId: string }).orderId).sort()

beforeEach(() => {
  // These tests describe the switch ON; the kill-switch tests below turn it off.
  process.env['PHARMACY_SUBMISSIONS_ENABLED'] = 'true'
  sendSlackAlertMock.mockClear()
  orders = {
    'o-1': { order_id: 'o-1', status: 'AWAITING_PAYMENT', pharmacy_id: 'pharm-api', payment_group_id: null, stripe_payment_intent_id: 'pi_solo' },
    'o-g1': { order_id: 'o-g1', status: 'AWAITING_PAYMENT', pharmacy_id: 'pharm-api',    payment_group_id: 'g-1', stripe_payment_intent_id: null },
    'o-g2': { order_id: 'o-g2', status: 'AWAITING_PAYMENT', pharmacy_id: 'pharm-portal', payment_group_id: 'g-1', stripe_payment_intent_id: null },
    'o-g3': { order_id: 'o-g3', status: 'AWAITING_PAYMENT', pharmacy_id: 'pharm-fax',    payment_group_id: 'g-1', stripe_payment_intent_id: null },
  }
  groups = { 'g-1': { group_id: 'g-1', status: 'AWAITING_PAYMENT', clinic_id: 'c-1', stripe_payment_intent_id: 'pi_group' } }
  eventRows = {}
  submissions = {}
  afterQueue = []
  failPharmacyLookups = 0
  constructEventMock.mockReset()
  routeOrderMock.mockReset().mockImplementation(async (p: { orderId: string; currentStatus: string }) => {
    const row = orders[p.orderId]
    if (!row || row.status !== p.currentStatus) return { outcome: 'not_claimed', tier: 'TIER_1_API' }
    row.status = 'SUBMISSION_PENDING'
    submissions[p.orderId] = (submissions[p.orderId] ?? 0) + 1
    return { outcome: 'accepted', tier: 'TIER_1_API' }
  })
  errorSpy.mockClear(); warnSpy.mockClear(); infoSpy.mockClear()
})

afterAll(() => { errorSpy.mockRestore(); warnSpy.mockRestore(); infoSpy.mockRestore() })

// ── Solo ───────────────────────────────────────────────────────────

describe('solo payment_intent.succeeded', () => {
  it('submits the paid order to its pharmacy through the routing engine, once', async () => {
    const res = await deliver(soloEvent())
    await flushAfter()

    expect(res.status).toBe(200)
    expect(routeOrderMock).toHaveBeenCalledTimes(1)
    expect(routeOrderMock).toHaveBeenCalledWith(expect.objectContaining({
      orderId: 'o-1', pharmacyId: 'pharm-api', currentStatus: 'PAID_PROCESSING',
    }))
    expect(submissions).toEqual({ 'o-1': 1 })
  })

  it('does not submit inside the request: the response comes back first', async () => {
    const res = await deliver(soloEvent())

    expect(res.status).toBe(200)
    expect(routeOrderMock).not.toHaveBeenCalled()
    expect(afterQueue.length).toBeGreaterThan(0)

    await flushAfter()
    expect(routeOrderMock).toHaveBeenCalledTimes(1)
  })

  it('a redelivered event does not submit again', async () => {
    await deliver(soloEvent())
    await flushAfter()
    await deliver(soloEvent())
    await flushAfter()

    expect(submissions).toEqual({ 'o-1': 1 })
  })

  it('a retry of an event that failed after payment resumes submission exactly once', async () => {
    // First delivery: payment lands, the tier lookup fails, Stripe gets a 500.
    failPharmacyLookups = 1
    const first = await deliver(soloEvent())
    expect(first.status).toBe(500)
    expect(orders['o-1']!.status).toBe('PAID_PROCESSING')

    // Stripe redelivers twice (its retry plus a manual replay racing it).
    await deliver(soloEvent())
    eventRows['evt_solo']!.processed_at = null
    await deliver(soloEvent())
    await flushAfter()

    expect(submissions).toEqual({ 'o-1': 1 })
  })

  it('a fax-tier order is also handed to the routing engine (it sends the fax)', async () => {
    orders['o-1']!.pharmacy_id = 'pharm-fax'

    await deliver(soloEvent())
    await flushAfter()

    expect(routeOrderMock).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'o-1', pharmacyId: 'pharm-fax' }))
    expect(submissions).toEqual({ 'o-1': 1 })
  })

  it('a routing engine that throws does not fail the already-answered webhook', async () => {
    routeOrderMock.mockRejectedValue(new Error('pharmacy read failed'))

    const res = await deliver(soloEvent())
    await expect(flushAfter()).resolves.toBeUndefined()

    expect(res.status).toBe(200)
  })
})

// ── Group ──────────────────────────────────────────────────────────

describe('group payment_intent.succeeded', () => {
  it('submits every member order once, each to its own pharmacy', async () => {
    const res = await deliver(groupEvent())
    await flushAfter()

    expect(res.status).toBe(200)
    expect(routedOrderIds()).toEqual(['o-g1', 'o-g2', 'o-g3'])
    expect(submissions).toEqual({ 'o-g1': 1, 'o-g2': 1, 'o-g3': 1 })
    expect(routeOrderMock).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'o-g3', pharmacyId: 'pharm-fax', currentStatus: 'PAID_PROCESSING' }))
  })

  it('does not submit inside the request', async () => {
    await deliver(groupEvent())

    expect(routeOrderMock).not.toHaveBeenCalled()
  })

  it('a redelivered group event does not submit any member again', async () => {
    await deliver(groupEvent())
    await flushAfter()
    await deliver(groupEvent())
    await flushAfter()

    expect(submissions).toEqual({ 'o-g1': 1, 'o-g2': 1, 'o-g3': 1 })
  })

  it('a retry after a partial failure submits each member exactly once', async () => {
    // One member's tier lookup fails: the event is retryable (500).
    failPharmacyLookups = 1
    const first = await deliver(groupEvent())
    expect(first.status).toBe(500)

    await deliver(groupEvent())
    await flushAfter()

    expect(submissions).toEqual({ 'o-g1': 1, 'o-g2': 1, 'o-g3': 1 })
  })
})

// ── Kill switch: PHARMACY_SUBMISSIONS_ENABLED off (or unset) ───────

describe('pharmacy submissions turned off', () => {
  beforeEach(() => { delete process.env['PHARMACY_SUBMISSIONS_ENABLED'] })
  afterAll(() => { delete process.env['PHARMACY_SUBMISSIONS_ENABLED'] })

  const skipLogs = (orderId: string) =>
    infoSpy.mock.calls.filter(c => String(c[0]).includes('submissions are turned off') && String(c[0]).includes(orderId))

  it('solo: the payment is recorded, nothing is submitted, the order stays PAID_PROCESSING', async () => {
    const res = await deliver(soloEvent())
    await flushAfter()

    expect(res.status).toBe(200)
    expect(orders['o-1']!.status).toBe('PAID_PROCESSING')
    expect(routeOrderMock).not.toHaveBeenCalled()
    expect(afterQueue).toHaveLength(0)
  })

  it('solo: the skip is logged once, by order id, with no Slack alert', async () => {
    await deliver(soloEvent())
    await flushAfter()

    expect(skipLogs('o-1')).toHaveLength(1)
    expect(sendSlackAlertMock).not.toHaveBeenCalled()
  })

  it('group: every member stays PAID_PROCESSING and nothing is submitted', async () => {
    const res = await deliver(groupEvent())
    await flushAfter()

    expect(res.status).toBe(200)
    expect(['o-g1', 'o-g2', 'o-g3'].map(id => orders[id]!.status)).toEqual(['PAID_PROCESSING', 'PAID_PROCESSING', 'PAID_PROCESSING'])
    expect(routeOrderMock).not.toHaveBeenCalled()
    expect(skipLogs('o-g2')).toHaveLength(1)
  })

  it('"false" is off too', async () => {
    process.env['PHARMACY_SUBMISSIONS_ENABLED'] = 'false'

    await deliver(soloEvent())
    await flushAfter()

    expect(routeOrderMock).not.toHaveBeenCalled()
    expect(orders['o-1']!.status).toBe('PAID_PROCESSING')
  })
})
