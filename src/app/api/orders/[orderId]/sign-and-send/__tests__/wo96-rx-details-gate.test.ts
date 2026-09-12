/**
 * @jest-environment node
 *
 * WO-96: sign-and-send refuses an order that is missing a rule-required
 * Rx detail field, after the F-2 signer guard and the existing
 * compliance checks:
 *
 *   - DEA-scheduled medication with no diagnosis (code or text) → 422
 *   - formulation.requires_clinical_difference with no statement  → 422
 *   - both present → the gate passes (the request proceeds to the CAS
 *     transition, which this harness does not model, so it surfaces as
 *     a 500 from the unmocked update — anything but 422 proves the gate
 *     let it through)
 *
 * The Review card pre-fills and blocks client-side; this is the
 * authoritative server gate for drafts saved before the field was set.
 */

import { POST } from '../route'

const TEST_ORDER_ID    = '11111111-1111-4111-9111-111111111111'
const TEST_CLINIC_ID   = '22222222-2222-4222-9222-222222222222'
const TEST_PROVIDER_ID = '33333333-3333-4333-9333-333333333333'
const TEST_FORM_ID     = '44444444-4444-4444-9444-444444444444'
const PROVIDER_USER_ID = 'auth-uid-provider-correct'

const VALID_SIG_DATA_URL = 'data:image/png;base64,' + 'A'.repeat(6000)

function makeParams() {
  return { params: Promise.resolve({ orderId: TEST_ORDER_ID }) }
}

function makeRequest(body: unknown): import('next/server').NextRequest {
  return { json: async () => body } as unknown as import('next/server').NextRequest
}

const getSessionMock = jest.fn()
const orderFetchMock = jest.fn()
const providerFetchMock = jest.fn()
const pharmacyFetchMock = jest.fn()
const clinicFetchMock = jest.fn()
const licenseFetchMock = jest.fn()
const formulationFetchMock = jest.fn()
const orderUpdateMock = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockResolvedValue({
    auth: { getSession: () => getSessionMock() },
  }),
}))

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn().mockReturnValue({
    from: (table: string) => {
      if (table === 'orders') {
        return {
          select: () => ({
            eq: () => ({ eq: () => ({ eq: () => ({ is: () => ({ maybeSingle: () => orderFetchMock() }) }) }) }),
          }),
          update: () => ({ eq: () => ({ eq: () => ({ select: () => orderUpdateMock() }) }) }),
        }
      }
      if (table === 'providers') {
        return {
          select: () => ({
            eq: () => ({ eq: () => ({ eq: () => ({ is: () => ({ maybeSingle: () => providerFetchMock() }) }) }) }),
          }),
        }
      }
      if (table === 'pharmacies') {
        return { select: () => ({ eq: () => ({ maybeSingle: () => pharmacyFetchMock() }) }) }
      }
      if (table === 'clinics') {
        return { select: () => ({ eq: () => ({ maybeSingle: () => clinicFetchMock() }) }) }
      }
      if (table === 'pharmacy_state_licenses') {
        return { select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => licenseFetchMock() }) }) }) }) }
      }
      if (table === 'formulations') {
        return { select: () => ({ eq: () => ({ maybeSingle: () => formulationFetchMock() }) }) }
      }
      throw new Error(`Unexpected table in test: ${table}`)
    },
  }),
}))

beforeEach(() => {
  for (const m of [getSessionMock, orderFetchMock, providerFetchMock, pharmacyFetchMock, clinicFetchMock, licenseFetchMock, formulationFetchMock, orderUpdateMock]) {
    m.mockReset()
  }
  getSessionMock.mockResolvedValue({
    data: { session: { user: { id: PROVIDER_USER_ID, email: 'p@e.t', user_metadata: { app_role: 'provider', clinic_id: TEST_CLINIC_ID } } } },
  })
  providerFetchMock.mockResolvedValue({
    data: { provider_id: TEST_PROVIDER_ID, npi_number: '1234567890', signature_hash: null, clinic_id: TEST_CLINIC_ID, user_id: PROVIDER_USER_ID },
    error: null,
  })
  pharmacyFetchMock.mockResolvedValue({
    data: { pharmacy_id: 'pharmacy-1', integration_tier: 'TIER_4_FAX', is_active: true, pharmacy_status: 'ACTIVE', deleted_at: null },
    error: null,
  })
  clinicFetchMock.mockResolvedValue({ data: { stripe_connect_status: 'ACTIVE' }, error: null })
  licenseFetchMock.mockResolvedValue({ data: { pharmacy_id: 'pharmacy-1' }, error: null })
  // Unmocked CAS update: the route logs and returns 500. Anything but
  // 422 from a request that reaches this point means the gate passed.
  orderUpdateMock.mockResolvedValue({ data: null, error: { message: 'not modelled in this harness' } })
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  jest.restoreAllMocks()
})

function mockDraftOrder(overrides: Record<string, unknown> = {}) {
  orderFetchMock.mockResolvedValue({
    data: {
      order_id: TEST_ORDER_ID,
      status: 'DRAFT',
      clinic_id: TEST_CLINIC_ID,
      patient_id: 'patient-1',
      provider_id: TEST_PROVIDER_ID,
      catalog_item_id: null,
      formulation_id: TEST_FORM_ID,
      pharmacy_id: 'pharmacy-1',
      retail_price_snapshot: 100,
      wholesale_price_snapshot: 60,
      shipping_state_snapshot: 'TX',
      medication_snapshot: { dea_schedule: 0 },
      pharmacy_snapshot: { integration_tier: 'TIER_4_FAX' },
      clinical_difference: null,
      diagnosis_code: null,
      diagnosis_text: null,
      ...overrides,
    },
    error: null,
  })
}

async function post() {
  return POST(makeRequest({ signatureDataUrl: VALID_SIG_DATA_URL }), makeParams())
}

describe('POST /api/orders/[orderId]/sign-and-send — WO-96 rule-required Rx details', () => {
  it('422 for a Schedule III order with no diagnosis', async () => {
    mockDraftOrder({ medication_snapshot: { dea_schedule: 3 } })
    formulationFetchMock.mockResolvedValue({ data: { requires_clinical_difference: false }, error: null })

    const res = await post()
    expect(res.status).toBe(422)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/needs a diagnosis \(controlled substance\)/)
    expect(body.error).toMatch(/Rx details on the Review step/)
    expect(orderUpdateMock).not.toHaveBeenCalled()
  })

  it('a diagnosis text alone satisfies the controlled-substance rule', async () => {
    mockDraftOrder({ medication_snapshot: { dea_schedule: 3 }, diagnosis_text: 'Testicular hypofunction' })
    formulationFetchMock.mockResolvedValue({ data: { requires_clinical_difference: false }, error: null })

    const res = await post()
    expect(res.status).not.toBe(422)
    expect(orderUpdateMock).toHaveBeenCalled()
  })

  it('422 when the formulation requires a clinical difference and none is recorded', async () => {
    mockDraftOrder()
    formulationFetchMock.mockResolvedValue({ data: { requires_clinical_difference: true }, error: null })

    const res = await post()
    expect(res.status).toBe(422)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/needs a clinical difference statement/)
    expect(orderUpdateMock).not.toHaveBeenCalled()
  })

  it('names both missing fields when both rules apply', async () => {
    mockDraftOrder({ medication_snapshot: { dea_schedule: 2 } })
    formulationFetchMock.mockResolvedValue({ data: { requires_clinical_difference: true }, error: null })

    const res = await post()
    expect(res.status).toBe(422)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/a diagnosis \(controlled substance\) and a clinical difference statement/)
  })

  it('passes when the clinical difference is recorded', async () => {
    mockDraftOrder({ clinical_difference: 'Commercial product is unavailable or on national shortage' })
    formulationFetchMock.mockResolvedValue({ data: { requires_clinical_difference: true }, error: null })

    const res = await post()
    expect(res.status).not.toBe(422)
    expect(orderUpdateMock).toHaveBeenCalled()
  })

  it('a non-controlled order on a formulation with no requirement is not gated', async () => {
    mockDraftOrder()
    formulationFetchMock.mockResolvedValue({ data: { requires_clinical_difference: false }, error: null })

    const res = await post()
    expect(res.status).not.toBe(422)
    expect(orderUpdateMock).toHaveBeenCalled()
  })

  it('skips the formulation lookup for a legacy catalog order', async () => {
    mockDraftOrder({ formulation_id: null, catalog_item_id: null })

    const res = await post()
    expect(res.status).not.toBe(422)
    expect(formulationFetchMock).not.toHaveBeenCalled()
  })
})
