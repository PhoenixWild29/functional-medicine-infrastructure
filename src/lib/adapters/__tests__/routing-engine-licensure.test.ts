/**
 * @jest-environment node
 *
 * C5 at submission: the routing engine re-checks licensure for the
 * order's shipping state before anything is sent (API, portal or fax).
 * A paid order whose pharmacy's license has expired since signing, or
 * whose sterile product the license does not cover, is not sent: it lands
 * in SUBMISSION_FAILED with an alert so ops can reroute. Ops' manual fax
 * (submitQueuedFax) applies the same rule.
 *
 * Adapters are mocked; nothing reaches a pharmacy.
 */

import { routeOrder, submitQueuedFax } from '../routing-engine'

let orderStatus = 'PAID_PROCESSING'
let licenseRow: Record<string, unknown> | null = null
let sterile = false
let facilityType: string | null = null

const submitTier1ApiMock  = jest.fn()
const submitTier4FaxMock  = jest.fn()
const sendSlackAlertMock  = jest.fn()
const casCalls: Array<{ newStatus: string; metadata?: Record<string, unknown> }> = []

jest.spyOn(console, 'error').mockImplementation(() => {})
jest.spyOn(console, 'warn').mockImplementation(() => {})
jest.spyOn(console, 'info').mockImplementation(() => {})

jest.mock('@/lib/orders/cas-transition', () => ({
  casTransition: async (args: { expectedStatus: string; newStatus: string; metadata?: Record<string, unknown> }) => {
    if (orderStatus !== args.expectedStatus) return { success: true, wasAlreadyTransitioned: true, orderId: 'o-1' }
    orderStatus = args.newStatus
    casCalls.push(args)
    return { success: true, wasAlreadyTransitioned: false, orderId: 'o-1' }
  },
}))
jest.mock('@/lib/adapters/tier1-api', () => ({ submitTier1Api: (...a: unknown[]) => submitTier1ApiMock(...a) }))
jest.mock('@/lib/adapters/tier2-portal', () => ({ submitTier2Portal: jest.fn() }))
jest.mock('@/lib/adapters/tier4-fax', () => ({ submitTier4Fax: (...a: unknown[]) => submitTier4FaxMock(...a) }))
jest.mock('@/lib/sla/creator', () => ({ createSlasForTransition: jest.fn(), upsertFaxDeliverySla: jest.fn() }))
jest.mock('@/lib/sla/resolver', () => ({ resolveSlasForTransition: jest.fn() }))
jest.mock('@/lib/slack/client', () => ({
  sendSlackAlert: (p: unknown) => sendSlackAlertMock(p),
  buildAdapterFailureAlert: (a: unknown) => a,
  buildSubmissionFailedAlert: (a: unknown) => a,
}))

function chain(result: () => unknown): Record<string, unknown> {
  const c: Record<string, unknown> = {}
  for (const k of ['select', 'eq', 'is', 'in', 'order', 'limit', 'update', 'upsert']) c[k] = () => c
  c['single'] = async () => result()
  c['maybeSingle'] = async () => result()
  c['then'] = (resolve: (r: unknown) => unknown) => Promise.resolve(result()).then(resolve)
  return c
}

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      switch (table) {
        case 'pharmacies':
          return chain(() => ({ data: { integration_tier: 'TIER_1_API', name: 'Strive', slug: 'strive', facility_type: facilityType }, error: null }))
        case 'orders':
          return chain(() => ({ data: {
            order_id: 'o-1', status: orderStatus, shipping_state_snapshot: 'TX',
            formulation_id: 'f-1', catalog_item_id: null, pharmacy_id: 'ph-1',
          }, error: null }))
        case 'formulations':
          return chain(() => ({ data: { formulation_id: 'f-1', dosage_forms: { name: sterile ? 'Injectable Solution' : 'Capsule', is_sterile: sterile } }, error: null }))
        case 'pharmacy_state_licenses':
          return chain(() => ({ data: licenseRow ? [licenseRow] : [], error: null }))
        case 'circuit_breaker_state':
          return chain(() => ({ data: null, error: null }))
        default:
          return chain(() => ({ data: null, error: null }))
      }
    },
  }),
}))

const VALID = {
  pharmacy_id: 'ph-1', state_code: 'TX', license_number: 'TX-1', expiration_date: '2099-12-31',
  is_active: true, deleted_at: null, license_type: 'nonresident_pharmacy', sterile_compounding: true,
}

beforeAll(() => { process.env['PHARMACY_SUBMISSIONS_ENABLED'] = 'true' })
afterAll(() => { delete process.env['PHARMACY_SUBMISSIONS_ENABLED'] })

beforeEach(() => {
  orderStatus = 'PAID_PROCESSING'
  licenseRow = { ...VALID }
  sterile = false
  facilityType = null
  casCalls.length = 0
  submitTier1ApiMock.mockReset().mockResolvedValue({ outcome: 'accepted', submissionId: 's-1', externalOrderId: 'x', attemptsMade: 1, errorCode: null, errorMessage: null })
  submitTier4FaxMock.mockReset().mockResolvedValue({ submissionId: 's-4', documoFaxId: 'fax-1', attemptNumber: 1 })
  sendSlackAlertMock.mockReset().mockResolvedValue(undefined)
})

const route = () => routeOrder({ orderId: 'o-1', pharmacyId: 'ph-1', currentStatus: 'PAID_PROCESSING' })
const failedWith = () => casCalls.find(c => c.newStatus === 'SUBMISSION_FAILED')?.metadata

describe('routeOrder re-checks licensure before sending', () => {
  it('a valid license sends as before', async () => {
    const r = await route()
    expect(submitTier1ApiMock).toHaveBeenCalledTimes(1)
    expect(r.outcome).toBe('accepted')
  })

  it('an expired license is not sent: SUBMISSION_FAILED with an alert', async () => {
    licenseRow = { ...VALID, expiration_date: '2026-01-31' }

    const r = await route()

    expect(r.outcome).toBe('submission_failed')
    expect(submitTier1ApiMock).not.toHaveBeenCalled()
    expect(submitTier4FaxMock).not.toHaveBeenCalled()
    expect(orderStatus).toBe('SUBMISSION_FAILED')
    expect(failedWith()).toMatchObject({ reason: 'pharmacy_not_licensed' })
    expect(sendSlackAlertMock).toHaveBeenCalled()
  })

  it('no license in the shipping state is not sent', async () => {
    licenseRow = null

    await route()

    expect(submitTier1ApiMock).not.toHaveBeenCalled()
    expect(orderStatus).toBe('SUBMISSION_FAILED')
  })

  it('a sterile product without sterile coverage is not sent', async () => {
    sterile = true
    licenseRow = { ...VALID, sterile_compounding: false }

    await route()

    expect(submitTier1ApiMock).not.toHaveBeenCalled()
    expect(failedWith()).toMatchObject({ reason: 'pharmacy_not_licensed' })
  })

  it('a sterile product at a 503B outsourcing facility is sent', async () => {
    sterile = true
    licenseRow = { ...VALID, sterile_compounding: null }
    facilityType = '503B'

    await route()

    expect(submitTier1ApiMock).toHaveBeenCalledTimes(1)
  })
})

describe('ops fax re-checks licensure too', () => {
  beforeEach(() => { orderStatus = 'FAX_QUEUED' })

  it('an expired license is not faxed: FAX_FAILED with an alert', async () => {
    licenseRow = { ...VALID, expiration_date: '2026-01-31' }

    const r = await submitQueuedFax({ orderId: 'o-1', pharmacyId: 'ph-1' })

    expect(submitTier4FaxMock).not.toHaveBeenCalled()
    expect(r.outcome).toBe('not_licensed')
    expect(orderStatus).toBe('FAX_FAILED')
    expect(sendSlackAlertMock).toHaveBeenCalled()
  })

  it('a valid license is faxed', async () => {
    const r = await submitQueuedFax({ orderId: 'o-1', pharmacyId: 'ph-1' })
    expect(submitTier4FaxMock).toHaveBeenCalledTimes(1)
    expect(r.outcome).toBe('accepted')
  })
})
