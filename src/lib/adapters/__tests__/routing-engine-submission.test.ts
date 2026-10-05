/**
 * @jest-environment node
 *
 * Launch blocker: a paid order is submitted to its pharmacy exactly once,
 * through the routing engine, and every failure lands in SUBMISSION_FAILED
 * with a Slack alert instead of hanging.
 *
 * The harness models the order's status with the REAL state machine
 * (casTransition rejects an illegal transition, as the real one does), so
 * a path that relied on an illegal move (PAID_PROCESSING or FAX_QUEUED
 * straight to SUBMISSION_FAILED) is caught here instead of stranding an
 * order in production. Every adapter is a jest.fn(): no pharmacy API,
 * portal or fax is reached.
 */

import { routeOrder, submitQueuedFax } from '../routing-engine'

const { canTransition } = jest.requireActual('@/lib/orders/state-machine') as typeof import('@/lib/orders/state-machine')

// ── Modelled state ─────────────────────────────────────────────────

let orderStatus = 'PAID_PROCESSING'
const transitions: string[] = []
/** Chronological log of the side effects that matter, for ordering checks. */
const timeline: string[] = []

let pharmacyRow: { integration_tier: string; name: string; slug: string } | null = null
let circuitRow: Record<string, unknown> | null = null

const submitTier1ApiMock    = jest.fn()
const submitTier2PortalMock = jest.fn()
const submitTier4FaxMock    = jest.fn()
const createSlasMock        = jest.fn()
const upsertFaxSlaMock      = jest.fn()
const resolveSlasMock       = jest.fn()
const sendSlackAlertMock    = jest.fn()

const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
const warnSpy  = jest.spyOn(console, 'warn').mockImplementation(() => {})
const infoSpy  = jest.spyOn(console, 'info').mockImplementation(() => {})

jest.mock('@/lib/orders/cas-transition', () => ({
  casTransition: async (args: { expectedStatus: string; newStatus: string }) => {
    if (!canTransition(args.expectedStatus as never, args.newStatus as never)) {
      throw new Error(`CAS: illegal transition ${args.expectedStatus} → ${args.newStatus}`)
    }
    if (orderStatus !== args.expectedStatus) return { success: true, wasAlreadyTransitioned: true, orderId: 'o-1' }
    orderStatus = args.newStatus
    transitions.push(args.newStatus)
    timeline.push(`status:${args.newStatus}`)
    return { success: true, wasAlreadyTransitioned: false, orderId: 'o-1' }
  },
}))

jest.mock('@/lib/adapters/tier1-api', () => ({
  submitTier1Api: (...a: unknown[]) => { timeline.push('submit:tier1'); return submitTier1ApiMock(...a) },
}))
jest.mock('@/lib/adapters/tier2-portal', () => ({
  submitTier2Portal: (...a: unknown[]) => { timeline.push('submit:tier2'); return submitTier2PortalMock(...a) },
}))
jest.mock('@/lib/adapters/tier4-fax', () => ({
  submitTier4Fax: (...a: unknown[]) => { timeline.push('submit:fax'); return submitTier4FaxMock(...a) },
}))

jest.mock('@/lib/sla/creator', () => ({
  createSlasForTransition: (args: { newStatus: string }) => { timeline.push(`sla:${args.newStatus}`); return createSlasMock(args) },
  upsertFaxDeliverySla: (orderId: string) => { timeline.push('sla:FAX_DELIVERY'); return upsertFaxSlaMock(orderId) },
}))
jest.mock('@/lib/sla/resolver', () => ({
  resolveSlasForTransition: (...a: unknown[]) => resolveSlasMock(...a),
}))

jest.mock('@/lib/slack/client', () => ({
  sendSlackAlert: (payload: unknown) => sendSlackAlertMock(payload),
  buildAdapterFailureAlert: (args: unknown) => ({ kind: 'adapter_failure', ...(args as object) }),
  buildSubmissionFailedAlert: (args: unknown) => ({ kind: 'submission_failed', ...(args as object) }),
}))

function chain(result: () => unknown): Record<string, unknown> {
  const c: Record<string, unknown> = {}
  for (const k of ['select', 'eq', 'is', 'in', 'order', 'limit']) c[k] = () => c
  c['single'] = async () => result()
  c['maybeSingle'] = async () => result()
  c['then'] = (resolve: (r: unknown) => unknown) => Promise.resolve(result()).then(resolve)
  return c
}

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table === 'pharmacies') {
        return { select: () => chain(() => ({ data: pharmacyRow, error: null })) }
      }
      if (table === 'orders') {
        return { select: () => chain(() => ({ data: { order_id: 'o-1', status: orderStatus, pharmacy_id: 'pharm-1' }, error: null })) }
      }
      if (table === 'circuit_breaker_state') {
        return {
          select: () => chain(() => ({ data: circuitRow, error: null })),
          upsert: async () => ({ error: null }),
          update: () => chain(() => ({ error: null })),
        }
      }
      throw new Error(`Unexpected table in test: ${table}`)
    },
  }),
}))

const route = (currentStatus = 'PAID_PROCESSING') =>
  routeOrder({ orderId: 'o-1', pharmacyId: 'pharm-1', currentStatus: currentStatus as never })

const alertKinds = () => sendSlackAlertMock.mock.calls.map(c => (c[0] as { kind: string }).kind)
const adapterCalls = () =>
  submitTier1ApiMock.mock.calls.length + submitTier2PortalMock.mock.calls.length + submitTier4FaxMock.mock.calls.length

beforeEach(() => {
  orderStatus = 'PAID_PROCESSING'
  transitions.length = 0
  timeline.length = 0
  pharmacyRow = { integration_tier: 'TIER_1_API', name: 'Pharm', slug: 'pharm' }
  circuitRow = null
  submitTier1ApiMock.mockReset().mockResolvedValue({ outcome: 'accepted', submissionId: 'sub-1', externalOrderId: 'x', attemptsMade: 1, errorCode: null, errorMessage: null })
  submitTier2PortalMock.mockReset().mockResolvedValue({ outcome: 'acknowledged', submissionId: 'sub-2', aiConfidenceScore: 0.99, screenshotUrl: null })
  submitTier4FaxMock.mockReset().mockResolvedValue({ submissionId: 'sub-4', documoFaxId: 'fax-1', attemptNumber: 1 })
  createSlasMock.mockReset().mockResolvedValue(undefined)
  upsertFaxSlaMock.mockReset().mockResolvedValue(undefined)
  resolveSlasMock.mockReset().mockResolvedValue(undefined)
  sendSlackAlertMock.mockReset().mockResolvedValue(undefined)
  errorSpy.mockClear(); warnSpy.mockClear(); infoSpy.mockClear()
})

afterAll(() => { errorSpy.mockRestore(); warnSpy.mockRestore(); infoSpy.mockRestore() })

// ── Idempotency ────────────────────────────────────────────────────

describe('exactly one submission per order', () => {
  it('a second routing of the same order does not submit again', async () => {
    await route()
    await route()

    expect(submitTier1ApiMock).toHaveBeenCalledTimes(1)
  })

  it('two concurrent routings of the same order submit once', async () => {
    await Promise.all([route(), route()])

    expect(adapterCalls()).toBe(1)
  })

  it('an order that already left PAID_PROCESSING is not submitted', async () => {
    orderStatus = 'SUBMISSION_PENDING'

    await route()

    expect(adapterCalls()).toBe(0)
    expect(sendSlackAlertMock).not.toHaveBeenCalled()
  })

  it('a second routing of a Tier 4 order does not fax again', async () => {
    pharmacyRow = { integration_tier: 'TIER_4_FAX', name: 'Fax Pharm', slug: 'fax-pharm' }

    await route()
    await route()

    expect(submitTier4FaxMock).toHaveBeenCalledTimes(1)
  })
})

// ── Each tier path ─────────────────────────────────────────────────

describe('Tier 1 API', () => {
  it('submits, then lands in PHARMACY_ACKNOWLEDGED', async () => {
    const result = await route()

    expect(submitTier1ApiMock).toHaveBeenCalledWith('o-1', 'pharm-1', 'TIER_1_API')
    expect(transitions).toEqual(['SUBMISSION_PENDING', 'PHARMACY_ACKNOWLEDGED'])
    expect(result.outcome).toBe('accepted')
  })

  it('creates the ADAPTER_SUBMISSION_ACK SLA before calling the pharmacy', async () => {
    await route()

    expect(createSlasMock).toHaveBeenCalledWith(expect.objectContaining({
      orderId: 'o-1', newStatus: 'SUBMISSION_PENDING', pharmacyId: 'pharm-1', tier: 'TIER_1_API',
    }))
    expect(timeline.indexOf('sla:SUBMISSION_PENDING')).toBeGreaterThanOrEqual(0)
    expect(timeline.indexOf('sla:SUBMISSION_PENDING')).toBeLessThan(timeline.indexOf('submit:tier1'))
  })

  it('creates the PHARMACY_ACKNOWLEDGED SLAs and resolves the ack SLA on acceptance', async () => {
    await route()

    expect(createSlasMock).toHaveBeenCalledWith(expect.objectContaining({ newStatus: 'PHARMACY_ACKNOWLEDGED', tier: 'TIER_1_API' }))
    expect(resolveSlasMock).toHaveBeenCalledWith('o-1', 'PHARMACY_ACKNOWLEDGED')
  })

  it('a pharmacy rejection goes to REROUTE_PENDING with an alert', async () => {
    submitTier1ApiMock.mockResolvedValue({ outcome: 'rejected', submissionId: 'sub-1', externalOrderId: null, attemptsMade: 1, errorCode: 'X', errorMessage: 'no' })

    const result = await route()

    expect(orderStatus).toBe('REROUTE_PENDING')
    expect(result.outcome).toBe('reroute_pending')
    expect(sendSlackAlertMock).toHaveBeenCalledTimes(1)
  })
})

describe('Tier 3 spec', () => {
  it('goes through the Tier 1 adapter with its own tier recorded', async () => {
    pharmacyRow = { integration_tier: 'TIER_3_SPEC', name: 'Spec', slug: 'spec' }

    await route()

    expect(submitTier1ApiMock).toHaveBeenCalledWith('o-1', 'pharm-1', 'TIER_3_SPEC')
    expect(orderStatus).toBe('PHARMACY_ACKNOWLEDGED')
  })
})

describe('Tier 2 portal', () => {
  beforeEach(() => { pharmacyRow = { integration_tier: 'TIER_2_PORTAL', name: 'Portal', slug: 'portal' } })

  it('submits through the portal and lands in PHARMACY_ACKNOWLEDGED', async () => {
    await route()

    expect(submitTier2PortalMock).toHaveBeenCalledWith('o-1', 'pharm-1', 1)
    expect(orderStatus).toBe('PHARMACY_ACKNOWLEDGED')
    expect(createSlasMock).toHaveBeenCalledWith(expect.objectContaining({ newStatus: 'SUBMISSION_PENDING', tier: 'TIER_2_PORTAL' }))
  })

  it('a manual_review result stays in SUBMISSION_PENDING for ops', async () => {
    submitTier2PortalMock.mockResolvedValue({ outcome: 'manual_review', submissionId: 'sub-2', aiConfidenceScore: 0.5, screenshotUrl: null })

    const result = await route()

    expect(orderStatus).toBe('SUBMISSION_PENDING')
    expect(result.outcome).toBe('manual_review')
  })
})

describe('Tier 4 fax', () => {
  beforeEach(() => { pharmacyRow = { integration_tier: 'TIER_4_FAX', name: 'Fax Pharm', slug: 'fax-pharm' } })

  it('faxes once and lands in FAX_QUEUED with the FAX_DELIVERY SLA', async () => {
    const result = await route()

    expect(submitTier4FaxMock).toHaveBeenCalledWith('o-1')
    expect(orderStatus).toBe('FAX_QUEUED')
    expect(upsertFaxSlaMock).toHaveBeenCalledWith('o-1')
    expect(result.outcome).toBe('accepted')
  })

  it('a fax that cannot be sent lands in SUBMISSION_FAILED with an alert, not stuck in PAID_PROCESSING', async () => {
    submitTier4FaxMock.mockRejectedValue(new Error('[tier4-fax] pharmacy pharm-1 has no fax_number'))

    const result = await route()

    expect(orderStatus).toBe('SUBMISSION_FAILED')
    expect(result.outcome).toBe('submission_failed')
    expect(alertKinds()).toContain('submission_failed')
  })
})

describe('Tier 3 hybrid (unsupported)', () => {
  beforeEach(() => { pharmacyRow = { integration_tier: 'TIER_3_HYBRID', name: 'Hybrid', slug: 'hybrid' } })

  it('fails loudly into SUBMISSION_FAILED instead of hanging in PAID_PROCESSING', async () => {
    const result = await route()

    expect(orderStatus).toBe('SUBMISSION_FAILED')
    expect(result.outcome).toBe('submission_failed')
    expect(adapterCalls()).toBe(0)
    expect(alertKinds()).toContain('submission_failed')
  })
})

// ── Failures ───────────────────────────────────────────────────────

describe('failure paths', () => {
  it('an exhausted API submission cascades to fax and lands in FAX_QUEUED', async () => {
    submitTier1ApiMock.mockResolvedValue({ outcome: 'exhausted', submissionId: 'sub-1', externalOrderId: null, attemptsMade: 3, errorCode: 'NETWORK_ERROR', errorMessage: 'timeout' })

    const result = await route()

    expect(submitTier4FaxMock).toHaveBeenCalledTimes(1)
    expect(orderStatus).toBe('FAX_QUEUED')
    expect(result.outcome).toBe('cascaded_to_fax')
    expect(upsertFaxSlaMock).toHaveBeenCalledWith('o-1')
  })

  it('API exhausted AND the fax cascade failing lands in SUBMISSION_FAILED with an alert', async () => {
    submitTier1ApiMock.mockResolvedValue({ outcome: 'exhausted', submissionId: 'sub-1', externalOrderId: null, attemptsMade: 3, errorCode: 'NETWORK_ERROR', errorMessage: 'timeout' })
    submitTier4FaxMock.mockRejectedValue(new Error('documo down'))

    const result = await route()

    expect(orderStatus).toBe('SUBMISSION_FAILED')
    expect(result.outcome).toBe('submission_failed')
    expect(alertKinds()).toContain('submission_failed')
    expect(resolveSlasMock).toHaveBeenCalledWith('o-1', 'SUBMISSION_FAILED')
  })

  it('an adapter that throws is treated as exhausted, not left in SUBMISSION_PENDING', async () => {
    submitTier1ApiMock.mockRejectedValue(new Error('no active pharmacy_api_configs'))
    submitTier4FaxMock.mockRejectedValue(new Error('no fax number'))

    await route()

    expect(orderStatus).toBe('SUBMISSION_FAILED')
  })

  it('an OPEN circuit fails the order into SUBMISSION_FAILED with an alert and calls no adapter', async () => {
    circuitRow = {
      pharmacy_id: 'pharm-1', state: 'OPEN', failure_count: 5,
      last_failure_at: new Date().toISOString(),
      cooldown_until: new Date(Date.now() + 60_000).toISOString(),
      tripped_by_submission_id: 'sub-x', updated_at: new Date().toISOString(),
    }

    const result = await route()

    expect(result.outcome).toBe('circuit_open')
    expect(orderStatus).toBe('SUBMISSION_FAILED')
    expect(adapterCalls()).toBe(0)
    expect(alertKinds()).toContain('submission_failed')
  })

  it('an inactive or missing pharmacy fails the order into SUBMISSION_FAILED rather than throwing', async () => {
    pharmacyRow = null

    const result = await route()

    expect(result.outcome).toBe('submission_failed')
    expect(orderStatus).toBe('SUBMISSION_FAILED')
    expect(alertKinds()).toContain('submission_failed')
  })

  it('a failure alert carries no adapter error text (it can echo PHI)', async () => {
    submitTier4FaxMock.mockRejectedValue(new Error('patient Jane Doe DOB 1980-01-01 not found'))
    pharmacyRow = { integration_tier: 'TIER_4_FAX', name: 'Fax Pharm', slug: 'fax-pharm' }

    await route()

    expect(JSON.stringify(sendSlackAlertMock.mock.calls)).not.toContain('Jane')
  })
})

// ── Ops resubmission entry point ───────────────────────────────────

describe('resubmitting from REROUTE_PENDING (ops retry_submission)', () => {
  it('claims REROUTE_PENDING and submits once', async () => {
    orderStatus = 'REROUTE_PENDING'

    await route('REROUTE_PENDING')
    await route('REROUTE_PENDING')

    expect(submitTier1ApiMock).toHaveBeenCalledTimes(1)
    expect(orderStatus).toBe('PHARMACY_ACKNOWLEDGED')
  })
})

// ── Ops fax entry point (force_fax / retry_fax) ────────────────────

describe('submitQueuedFax (ops force_fax / retry_fax)', () => {
  beforeEach(() => { orderStatus = 'FAX_QUEUED' })

  it('sends the fax once and keeps the order in FAX_QUEUED with a FAX_DELIVERY SLA', async () => {
    const result = await submitQueuedFax({ orderId: 'o-1', pharmacyId: 'pharm-1' })

    expect(submitTier4FaxMock).toHaveBeenCalledTimes(1)
    expect(submitTier4FaxMock).toHaveBeenCalledWith('o-1')
    expect(orderStatus).toBe('FAX_QUEUED')
    expect(upsertFaxSlaMock).toHaveBeenCalledWith('o-1')
    expect(result.outcome).toBe('accepted')
  })

  it('a fax that fails lands in FAX_FAILED with an alert, so ops can retry it', async () => {
    submitTier4FaxMock.mockRejectedValue(new Error('documo down'))

    const result = await submitQueuedFax({ orderId: 'o-1', pharmacyId: 'pharm-1' })

    expect(orderStatus).toBe('FAX_FAILED')
    expect(result.outcome).toBe('fax_failed')
    expect(sendSlackAlertMock).toHaveBeenCalledTimes(1)
  })

  it('does nothing for an order that is not FAX_QUEUED', async () => {
    orderStatus = 'FAX_DELIVERED'

    const result = await submitQueuedFax({ orderId: 'o-1', pharmacyId: 'pharm-1' })

    expect(submitTier4FaxMock).not.toHaveBeenCalled()
    expect(result.outcome).toBe('not_claimed')
  })
})
