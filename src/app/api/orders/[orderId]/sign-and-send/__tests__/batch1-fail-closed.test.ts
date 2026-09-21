/**
 * @jest-environment node
 *
 * Batch 1, findings 2 and 3 (server half): the send gate must fail
 * closed when a check cannot run.
 *
 * 3. The clinical-difference rule was read as `{ data }` with the error
 *    discarded, so a failed lookup meant "not required" and the Rx was
 *    signed and sent without the statement.
 *
 * 2. The DEA schedule fell back to 0 twice over — a discarded catalog
 *    error, then `?? 0` on the snapshot — so an unknown schedule passed
 *    the "Schedule 2+ must go by fax" gate as if it were not controlled.
 *    Unknown must route to fax, never to "not controlled".
 */

import { POST } from '../route'

const TEST_ORDER_ID    = '11111111-1111-4111-9111-111111111111'
const TEST_CLINIC_ID   = '22222222-2222-4222-9222-222222222222'
const TEST_PROVIDER_ID = '33333333-3333-4333-9333-333333333333'
const TEST_FORM_ID     = '44444444-4444-4444-9444-444444444444'
const PROVIDER_USER_ID = 'auth-uid-provider-correct'
const VALID_SIG_DATA_URL = 'data:image/png;base64,' + 'A'.repeat(6000)

const getSessionMock       = jest.fn()
const orderFetchMock       = jest.fn()
const providerFetchMock    = jest.fn()
const pharmacyFetchMock    = jest.fn()
const clinicFetchMock      = jest.fn()
const licenseFetchMock     = jest.fn()
const formulationFetchMock = jest.fn()
const catalogFetchMock     = jest.fn()
const orderUpdateMock      = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockResolvedValue({ auth: { getSession: () => getSessionMock() } }),
}))

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn().mockReturnValue({
    from: (table: string) => {
      if (table === 'orders') {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ is: () => ({ maybeSingle: () => orderFetchMock() }) }) }) }) }),
          update: () => ({ eq: () => ({ eq: () => ({ select: () => orderUpdateMock() }) }) }),
        }
      }
      if (table === 'providers') {
        return { select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ is: () => ({ maybeSingle: () => providerFetchMock() }) }) }) }) }) }
      }
      if (table === 'pharmacies')             return { select: () => ({ eq: () => ({ maybeSingle: () => pharmacyFetchMock() }) }) }
      if (table === 'clinics')                return { select: () => ({ eq: () => ({ maybeSingle: () => clinicFetchMock() }) }) }
      if (table === 'pharmacy_state_licenses') return { select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => licenseFetchMock() }) }) }) }) }
      if (table === 'formulations')           return { select: () => ({ eq: () => ({ maybeSingle: () => formulationFetchMock() }) }) }
      if (table === 'catalog')                return { select: () => ({ eq: () => ({ maybeSingle: () => catalogFetchMock() }) }) }
      throw new Error(`Unexpected table in test: ${table}`)
    },
  }),
}))

function makeParams() { return { params: Promise.resolve({ orderId: TEST_ORDER_ID }) } }
function makeRequest(body: unknown) { return { json: async () => body } as unknown as import('next/server').NextRequest }
async function post() { return POST(makeRequest({ signatureDataUrl: VALID_SIG_DATA_URL }), makeParams()) }

function mockDraftOrder(overrides: Record<string, unknown> = {}) {
  orderFetchMock.mockResolvedValue({
    data: {
      order_id: TEST_ORDER_ID, status: 'DRAFT', clinic_id: TEST_CLINIC_ID,
      patient_id: 'patient-1', provider_id: TEST_PROVIDER_ID,
      catalog_item_id: null, formulation_id: TEST_FORM_ID, pharmacy_id: 'pharmacy-1',
      retail_price_snapshot: 100, wholesale_price_snapshot: 60, shipping_state_snapshot: 'TX',
      medication_snapshot: { dea_schedule: 0 },
      pharmacy_snapshot: { integration_tier: 'TIER_4_FAX' },
      clinical_difference: null, diagnosis_code: null, diagnosis_text: null,
      days_supply: 28, dispense_quantity: 1, dispense_unit: 'mL', refills: 0,
      ...overrides,
    },
    error: null,
  })
}

beforeEach(() => {
  for (const m of [getSessionMock, orderFetchMock, providerFetchMock, pharmacyFetchMock, clinicFetchMock, licenseFetchMock, formulationFetchMock, catalogFetchMock, orderUpdateMock]) m.mockReset()
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
  formulationFetchMock.mockResolvedValue({ data: { requires_clinical_difference: false }, error: null })
  catalogFetchMock.mockResolvedValue({ data: { dea_schedule: 0 }, error: null })
  // Unmocked CAS update: the route logs and 500s. Anything but the
  // expected refusal means the gate let the order through.
  orderUpdateMock.mockResolvedValue({ data: null, error: { message: 'not modelled in this harness' } })
  mockDraftOrder()
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { jest.restoreAllMocks() })

describe('finding 3 — the clinical-difference rule could not be read', () => {
  it('refuses the send instead of treating it as not required', async () => {
    formulationFetchMock.mockResolvedValue({ data: null, error: { message: 'connection reset', code: '08006' } })

    const res = await post()

    // 503: the check could not run. Distinguishable from 422 (the check
    // ran and the order failed it) and from the 500 the unmodelled CAS
    // update produces, which is what the old code reached.
    expect(res.status).toBe(503)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/could not be checked/i)
  })

  it('still sends when the rule reads cleanly and is not required', async () => {
    formulationFetchMock.mockResolvedValue({ data: { requires_clinical_difference: false }, error: null })

    const res = await post()

    // Reaches the CAS update, which this harness does not model.
    expect(res.status).toBe(500)
    const body = await res.json() as { error: string }
    expect(body.error).not.toMatch(/could not be checked/i)
  })
})

describe('finding 2 — an unknown DEA schedule', () => {
  it('routes to fax rather than passing as non-controlled', async () => {
    // Snapshot carries no schedule and the catalog lookup fails: the
    // schedule is unknown. The pharmacy is API-only, so the fax gate
    // must refuse it.
    mockDraftOrder({
      catalog_item_id: 'item-1', formulation_id: null,
      medication_snapshot: {},
      pharmacy_snapshot: { integration_tier: 'TIER_1_API' },
    })
    catalogFetchMock.mockResolvedValue({ data: null, error: { message: 'connection reset', code: '08006' } })
    pharmacyFetchMock.mockResolvedValue({
      data: { pharmacy_id: 'pharmacy-1', integration_tier: 'TIER_1_API', is_active: true, pharmacy_status: 'ACTIVE', deleted_at: null },
      error: null,
    })

    const res = await post()

    // 422 from the compliance gate — not the 500 of a CAS update it
    // should never have reached.
    expect(res.status).toBe(422)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/schedule|controlled|fax/i)
  })

  it('a known Schedule 0 on an API pharmacy still sends', async () => {
    mockDraftOrder({
      medication_snapshot: { dea_schedule: 0 },
      pharmacy_snapshot: { integration_tier: 'TIER_1_API' },
    })
    pharmacyFetchMock.mockResolvedValue({
      data: { pharmacy_id: 'pharmacy-1', integration_tier: 'TIER_1_API', is_active: true, pharmacy_status: 'ACTIVE', deleted_at: null },
      error: null,
    })

    const res = await post()

    expect(res.status).toBe(500)   // the unmodelled CAS update, i.e. the gate passed
  })
})
