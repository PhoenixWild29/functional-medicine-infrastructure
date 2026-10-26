/**
 * @jest-environment node
 *
 * HIPAA B6 / B7 / B17 in the routing engine: routeOrder (Tier 1, 2, 3, 4,
 * retries and reroutes all come through it) and submitQueuedFax (ops
 * force_fax / retry_fax) check the order before dispatch. An unsigned
 * order, or one that no longer matches its signature, is never sent and
 * never cascades to fax: it lands in SUBMISSION_FAILED / FAX_FAILED with
 * the refusal code as the reason, and ops are alerted. An adapter's own
 * refusal (an http pharmacy URL) does not cascade either.
 *
 * Adapters are mocked; nothing reaches a pharmacy.
 */

import { routeOrder, submitQueuedFax } from '../routing-engine'
import { TransmissionRefusedError } from '../transmission-guard'
import { boundSignatureValue, canonicalSignedContent, patientSnapshotFor, prescriberSnapshotFor, rerouteBinding } from '@/lib/orders/signature-binding'

const SIGNED_AT = '2026-10-25T14:03:07.123Z'
const DIGEST = 'd'.repeat(64)
const PATIENT = { first_name: 'Alex', last_name: 'Demo', date_of_birth: '1980-01-01', allergies: [] as string[], nkda: true }
let history: unknown[] = []

const CONTENT = {
  order_id: 'o-1', patient_id: 'pt-1', provider_npi_snapshot: '1234567890', shipping_state_snapshot: 'TX',
  patient_snapshot: patientSnapshotFor(PATIENT),
  prescriber_snapshot: prescriberSnapshotFor({ provider_id: 'pr-1', first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', dea_number: null, license_state: 'TX' }),
  pharmacy_snapshot: { pharmacy_id: 'ph-1', name: 'Strive' },
  medication_snapshot: { medication_name: 'Fixture 10 mg', dea_schedule: 0 },
  sig_mode: 'standard', sig_text: 'Take one daily', titration_steps: [], quantity: 30, dispense_quantity: 30,
  dispense_unit: 'capsule', days_supply: 30, refills: 1, package_count: 1, syringe_option: 'none',
  substitution_allowed: true, shipping_type: 'standard',
}

let orderStatus = 'PAID_PROCESSING'
let orderOver: Record<string, unknown> = {}
let tier = 'TIER_1_API'

const submitTier1ApiMock  = jest.fn()
const submitTier2PortalMock = jest.fn()
const submitTier4FaxMock  = jest.fn()
const sendSlackAlertMock  = jest.fn()
const casCalls: Array<{ newStatus: string; metadata?: Record<string, unknown> }> = []

const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
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
jest.mock('@/lib/adapters/tier2-portal', () => ({ submitTier2Portal: (...a: unknown[]) => submitTier2PortalMock(...a) }))
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

const signedValue = () => boundSignatureValue(DIGEST, SIGNED_AT, canonicalSignedContent(CONTENT))

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      switch (table) {
        case 'pharmacies':
          return chain(() => ({ data: { integration_tier: tier, name: 'Strive', slug: 'strive', facility_type: null }, error: null }))
        case 'orders':
          return chain(() => ({ data: {
            ...CONTENT, status: orderStatus, shipping_state_snapshot: 'TX', formulation_id: 'f-1', catalog_item_id: null, pharmacy_id: 'ph-1',
            locked_at: SIGNED_AT, provider_signature_hash_snapshot: signedValue(), ...orderOver,
          }, error: null }))
        case 'patients':
          return chain(() => ({ data: PATIENT, error: null }))
        case 'order_status_history':
          return chain(() => ({ data: history, error: null }))
        case 'providers':
          return chain(() => ({ data: { first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', dea_number: null, license_state: 'TX' }, error: null }))
        case 'formulations':
          return chain(() => ({ data: { formulation_id: 'f-1', dosage_forms: { name: 'Capsule', is_sterile: false }, salt_forms: { ingredients: { common_name: 'Fixture', dea_schedule: null, compounding_status: 'approved_drug_component' } } }, error: null }))
        case 'pharmacy_state_licenses':
          return chain(() => ({ data: ['ph-1', 'ph-2'].map(pharmacy_id => ({ pharmacy_id, state_code: 'TX', license_number: 'TX-1', expiration_date: '2099-12-31', is_active: true, deleted_at: null, license_type: 'nonresident_pharmacy', sterile_compounding: true })), error: null }))
        default:
          return chain(() => ({ data: null, error: null }))
      }
    },
  }),
}))

beforeAll(() => { process.env['PHARMACY_SUBMISSIONS_ENABLED'] = 'true'; process.env['RX_BINDING_SECRET'] = 'test-binding-secret-0123456789abcdef' })
afterAll(() => { delete process.env['PHARMACY_SUBMISSIONS_ENABLED']; delete process.env['RX_BINDING_SECRET'] })

beforeEach(() => {
  orderStatus = 'PAID_PROCESSING'
  orderOver = {}
  history = []
  tier = 'TIER_1_API'
  casCalls.length = 0
  errorSpy.mockClear()
  submitTier1ApiMock.mockReset().mockResolvedValue({ outcome: 'accepted', submissionId: 's-1', externalOrderId: 'x', attemptsMade: 1, errorCode: null, errorMessage: null })
  submitTier2PortalMock.mockReset().mockResolvedValue({ outcome: 'acknowledged', submissionId: 's-2' })
  submitTier4FaxMock.mockReset().mockResolvedValue({ submissionId: 's-4', documoFaxId: 'fax-1', attemptNumber: 1 })
  sendSlackAlertMock.mockReset().mockResolvedValue(undefined)
})

const route = (currentStatus = 'PAID_PROCESSING') => routeOrder({ orderId: 'o-1', pharmacyId: 'ph-1', currentStatus: currentStatus as 'PAID_PROCESSING' })
const failedWith = (status: string) => casCalls.find(c => c.newStatus === status)?.metadata
const nothingSent = () => {
  expect(submitTier1ApiMock).not.toHaveBeenCalled()
  expect(submitTier2PortalMock).not.toHaveBeenCalled()
  expect(submitTier4FaxMock).not.toHaveBeenCalled()
}

describe('routeOrder', () => {
  it('a signed order whose content matches its signature is sent', async () => {
    const r = await route()
    expect(r.outcome).toBe('accepted')
    expect(submitTier1ApiMock).toHaveBeenCalledTimes(1)
  })

  it.each(['TIER_1_API', 'TIER_2_PORTAL', 'TIER_3_SPEC', 'TIER_4_FAX'])('%s: an unsigned order is not sent and does not cascade', async t => {
    tier = t
    orderOver = { locked_at: null }
    const r = await route()
    expect(r.outcome).toBe('submission_failed')
    nothingSent()
    expect(orderStatus).toBe('SUBMISSION_FAILED')
    expect(failedWith('SUBMISSION_FAILED')).toMatchObject({ reason: 'unsigned_order' })
    expect(sendSlackAlertMock).toHaveBeenCalled()
  })

  it('an order changed after signing is not sent: SUBMISSION_FAILED, reason signature_mismatch', async () => {
    orderOver = { refills: 4 }
    await route()
    nothingSent()
    expect(failedWith('SUBMISSION_FAILED')).toMatchObject({ reason: 'signature_mismatch' })
  })

  it('a retry or reroute (from REROUTE_PENDING) is checked the same way', async () => {
    orderStatus = 'REROUTE_PENDING'
    orderOver = { sig_text: 'Take two daily' }
    await route('REROUTE_PENDING')
    nothingSent()
    expect(failedWith('SUBMISSION_FAILED')).toMatchObject({ reason: 'signature_mismatch' })
  })

  it('T2: a pharmacy change without the ops reroute proof is not sent: reason pharmacy_mismatch', async () => {
    orderOver = { pharmacy_id: 'ph-2' }
    const r = await routeOrder({ orderId: 'o-1', pharmacyId: 'ph-2', currentStatus: 'PAID_PROCESSING' })
    expect(r.outcome).toBe('submission_failed')
    nothingSent()
    expect(failedWith('SUBMISSION_FAILED')).toMatchObject({ reason: 'pharmacy_mismatch' })
  })

  it('T2: the ops reroute re-binds: with its keyed proof the new pharmacy is sent to', async () => {
    orderOver = { pharmacy_id: 'ph-2', reroute_count: 1 }
    history = [{ old_status: 'FAX_FAILED', new_status: 'REROUTE_PENDING', created_at: '2026-10-26T10:00:00Z',
      metadata: { reason: 'ops_reroute', new_pharmacy_id: 'ph-2', reroute_count: 1, reroute_binding: rerouteBinding('o-1', signedValue(), 'ph-2', 1) } }]
    const r = await routeOrder({ orderId: 'o-1', pharmacyId: 'ph-2', currentStatus: 'PAID_PROCESSING' })
    expect(r.outcome).toBe('accepted')
  })

  it('T1: a bare 64-hex value with no signing history is not sent', async () => {
    orderOver = { provider_signature_hash_snapshot: DIGEST }
    const r = await route()
    expect(r.outcome).toBe('submission_failed')
    nothingSent()
    expect(failedWith('SUBMISSION_FAILED')).toMatchObject({ reason: 'signature_mismatch' })
  })

  it('an order signed before binding (its signing history row before the cutoff) is sent as before', async () => {
    orderOver = { provider_signature_hash_snapshot: DIGEST, patient_snapshot: null, prescriber_snapshot: null }
    history = [{ old_status: 'DRAFT', new_status: 'AWAITING_PAYMENT', created_at: '2026-10-01T00:00:00Z', metadata: { actor: 'provider_batch_sign', signed_at: SIGNED_AT, signature_hash: DIGEST } }]
    const r = await route()
    expect(r.outcome).toBe('accepted')
  })

  it("an adapter's refusal (an http pharmacy URL) lands in SUBMISSION_FAILED with its code and does not cascade to fax", async () => {
    submitTier1ApiMock.mockRejectedValue(new TransmissionRefusedError('insecure_pharmacy_url', 'not https'))
    const r = await route()
    expect(r.outcome).toBe('submission_failed')
    expect(submitTier4FaxMock).not.toHaveBeenCalled()
    expect(failedWith('SUBMISSION_FAILED')).toMatchObject({ reason: 'insecure_pharmacy_url' })
  })
})

describe('submitQueuedFax (ops force_fax / retry_fax)', () => {
  it('a signed, matching order is faxed', async () => {
    orderStatus = 'FAX_QUEUED'
    const r = await submitQueuedFax({ orderId: 'o-1', pharmacyId: 'ph-1' })
    expect(r.outcome).toBe('accepted')
  })

  it('an order changed after signing is not faxed: FAX_FAILED with the reason, and an alert', async () => {
    orderStatus = 'FAX_QUEUED'
    orderOver = { days_supply: 90 }
    const r = await submitQueuedFax({ orderId: 'o-1', pharmacyId: 'ph-1' })
    expect(r.outcome).toBe('refused')
    nothingSent()
    expect(orderStatus).toBe('FAX_FAILED')
    expect(failedWith('FAX_FAILED')).toMatchObject({ reason: 'signature_mismatch' })
    expect(sendSlackAlertMock).toHaveBeenCalledWith(expect.objectContaining({ errorCode: 'signature_mismatch' }))
  })

  it('an unsigned order is not faxed', async () => {
    orderStatus = 'FAX_QUEUED'
    orderOver = { provider_signature_hash_snapshot: null }
    const r = await submitQueuedFax({ orderId: 'o-1', pharmacyId: 'ph-1' })
    expect(r.outcome).toBe('refused')
    nothingSent()
    expect(failedWith('FAX_FAILED')).toMatchObject({ reason: 'unsigned_order' })
  })
})
