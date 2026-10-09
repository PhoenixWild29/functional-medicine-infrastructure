/**
 * @jest-environment node
 *
 * Launch blocker: the ops recovery buttons must actually resubmit.
 *
 * retry_submission, force_fax and retry_fax used to change the order's
 * status and stop: nothing was sent to the pharmacy, so the order sat in
 * SUBMISSION_PENDING / FAX_QUEUED looking handled. Each one now claims the
 * order with a CAS and hands it to the routing engine (or the fax adapter)
 * after the response. A double click, or two ops users at once, resubmits
 * once: the second CAS no-ops and is reported, never resubmitted.
 *
 * The routing engine is mocked; no pharmacy, portal or fax is reached.
 */

import { POST } from '../route'

let orderRow: { order_id: string; status: string; pharmacy_id: string | null; reroute_count: number } = {
  order_id: 'o-1', status: 'SUBMISSION_FAILED', pharmacy_id: 'pharm-1', reroute_count: 0,
}
let afterQueue: Array<() => unknown> = []

const routeOrderMock      = jest.fn()
const submitQueuedFaxMock = jest.fn()
const getUserMock         = jest.fn()
const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
const infoSpy  = jest.spyOn(console, 'info').mockImplementation(() => {})

jest.mock('next/server', () => {
  const actual = jest.requireActual('next/server')
  return {
    ...actual,
    after: (task: unknown) => { afterQueue.push(typeof task === 'function' ? task as () => unknown : () => task) },
  }
})

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockImplementation(async () => ({
    auth: {
      getUser: () => getUserMock(),
      // A cookie-only session must not be trusted: getUser() verifies it.
      getSession: async () => ({ data: { session: { user: { email: 'ops@test', app_metadata: { app_role: 'ops_admin' } } } } }),
    },
  })),
}))

jest.mock('@/lib/adapters/routing-engine', () => ({
  routeOrder:      (params: unknown) => routeOrderMock(params),
  submitQueuedFax: (params: unknown) => submitQueuedFaxMock(params),
}))

jest.mock('@/lib/stripe/client', () => ({ createStripeClient: () => ({}) }))

jest.mock('@/lib/orders/cas-transition', () => ({
  casTransition: async (args: { expectedStatus: string; newStatus: string }) => {
    if (orderRow.status !== args.expectedStatus) return { success: true, wasAlreadyTransitioned: true, orderId: 'o-1' }
    orderRow.status = args.newStatus
    return { success: true, wasAlreadyTransitioned: false, orderId: 'o-1' }
  },
}))
jest.mock('@/lib/orders/status-history', () => ({ insertStatusHistory: jest.fn().mockResolvedValue(true) }))

function chain(single: () => unknown): Record<string, unknown> {
  const c: Record<string, unknown> = {}
  for (const k of ['select', 'eq', 'is', 'in', 'neq', 'order', 'limit']) c[k] = () => c
  c['maybeSingle'] = async () => single()
  c['single'] = async () => single()
  return c
}

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table === 'orders') {
        return {
          select: () => chain(() => ({
            data: {
              ...orderRow, stripe_payment_intent_id: 'pi_1', payment_group_id: null,
              retail_price_snapshot: 100, ops_assignee: null,
            },
            error: null,
          })),
        }
      }
      throw new Error(`Unexpected table in test: ${table}`)
    },
  }),
}))

function act(action: string) {
  return POST(
    { json: async () => ({ action }) } as never,
    { params: Promise.resolve({ orderId: 'o-1' }) },
  )
}

async function flushAfter() {
  while (afterQueue.length > 0) await afterQueue.shift()!()
}

beforeEach(() => {
  // These tests describe the switch ON; the kill-switch tests below turn it off.
  process.env['PHARMACY_SUBMISSIONS_ENABLED'] = 'true'
  orderRow = { order_id: 'o-1', status: 'SUBMISSION_FAILED', pharmacy_id: 'pharm-1', reroute_count: 0 }
  afterQueue = []
  routeOrderMock.mockReset().mockResolvedValue({ outcome: 'accepted', tier: 'TIER_1_API' })
  submitQueuedFaxMock.mockReset().mockResolvedValue({ outcome: 'accepted' })
  getUserMock.mockReset().mockResolvedValue({
    data: { user: { id: 'u-ops', email: 'ops@test', app_metadata: { app_role: 'ops_admin' } } },
    error: null,
  })
  errorSpy.mockClear(); infoSpy.mockClear()
})

afterAll(() => { errorSpy.mockRestore(); infoSpy.mockRestore() })

describe('retry_submission', () => {
  it('resubmits the order through the routing engine', async () => {
    const res = await act('retry_submission')
    await flushAfter()

    expect(res.status).toBe(200)
    expect(routeOrderMock).toHaveBeenCalledTimes(1)
    expect(routeOrderMock).toHaveBeenCalledWith(expect.objectContaining({
      orderId: 'o-1', pharmacyId: 'pharm-1', currentStatus: 'REROUTE_PENDING',
    }))
  })

  it('answers before the submission runs', async () => {
    await act('retry_submission')

    expect(routeOrderMock).not.toHaveBeenCalled()
    await flushAfter()
    expect(routeOrderMock).toHaveBeenCalledTimes(1)
  })

  it('a double click resubmits once and reports the second', async () => {
    const first  = await act('retry_submission')
    const second = await act('retry_submission')
    await flushAfter()

    expect(first.status).toBe(200)
    expect(second.status).toBeGreaterThanOrEqual(400)
    expect(routeOrderMock).toHaveBeenCalledTimes(1)
  })

  it('an order with no pharmacy is refused, not left in REROUTE_PENDING', async () => {
    orderRow.pharmacy_id = null

    const res = await act('retry_submission')
    await flushAfter()

    expect(res.status).toBe(422)
    expect(orderRow.status).toBe('SUBMISSION_FAILED')
    expect(routeOrderMock).not.toHaveBeenCalled()
  })
})

describe('force_fax', () => {
  it('from SUBMISSION_FAILED: queues the fax and sends it', async () => {
    const res = await act('force_fax')
    await flushAfter()

    expect(res.status).toBe(200)
    expect(orderRow.status).toBe('FAX_QUEUED')
    expect(submitQueuedFaxMock).toHaveBeenCalledTimes(1)
    expect(submitQueuedFaxMock).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'o-1', pharmacyId: 'pharm-1' }))
  })

  it('from FAX_FAILED: queues the fax and sends it', async () => {
    orderRow.status = 'FAX_FAILED'

    await act('force_fax')
    await flushAfter()

    expect(submitQueuedFaxMock).toHaveBeenCalledTimes(1)
  })

  it('a double click sends one fax', async () => {
    await act('force_fax')
    const second = await act('force_fax')
    await flushAfter()

    expect(second.status).toBeGreaterThanOrEqual(400)
    expect(submitQueuedFaxMock).toHaveBeenCalledTimes(1)
  })
})

describe('retry_fax', () => {
  beforeEach(() => { orderRow.status = 'FAX_FAILED' })

  it('re-sends the fax', async () => {
    const res = await act('retry_fax')
    await flushAfter()

    expect(res.status).toBe(200)
    expect(orderRow.status).toBe('FAX_QUEUED')
    expect(submitQueuedFaxMock).toHaveBeenCalledTimes(1)
  })

  it('a double click sends one fax', async () => {
    await act('retry_fax')
    const second = await act('retry_fax')
    await flushAfter()

    expect(second.status).toBeGreaterThanOrEqual(400)
    expect(submitQueuedFaxMock).toHaveBeenCalledTimes(1)
  })
})

describe('auth', () => {
  it('uses the verified user (getUser), not the cookie session', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: { message: 'invalid JWT' } })

    const res = await act('retry_submission')

    expect(res.status).toBe(401)
    expect(routeOrderMock).not.toHaveBeenCalled()
    expect(orderRow.status).toBe('SUBMISSION_FAILED')
  })
})

describe('pharmacy submissions turned off', () => {
  beforeEach(() => { delete process.env['PHARMACY_SUBMISSIONS_ENABLED'] })
  afterAll(() => { delete process.env['PHARMACY_SUBMISSIONS_ENABLED'] })

  it.each([
    ['retry_submission', 'SUBMISSION_FAILED'],
    ['force_fax',        'SUBMISSION_FAILED'],
    ['force_fax',        'FAX_FAILED'],
    ['retry_fax',        'FAX_FAILED'],
  ])('%s from %s: refused with a clear message, nothing changes, nothing is sent', async (action, status) => {
    orderRow.status = status

    const res = await act(action)
    await flushAfter()
    const body = await res.json() as { error?: string }

    expect([409, 423]).toContain(res.status)
    expect(body.error).toContain('Pharmacy submissions are turned off')
    expect(orderRow.status).toBe(status)
    expect(routeOrderMock).not.toHaveBeenCalled()
    expect(submitQueuedFaxMock).not.toHaveBeenCalled()
  })
})
