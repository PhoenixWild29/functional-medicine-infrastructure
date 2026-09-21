/**
 * @jest-environment node
 *
 * sign-and-send enforces the allergy and interaction checks at send time.
 *
 * The draft sign page now runs both checks on screen, but the server is
 * the gate that cannot be skipped: it reads the patient's allergy status
 * and runs the interaction check itself, at the moment of sending.
 *
 *   - a read that ERRORS → 503 and a [sign-and-send] log. A check that
 *     could not run is not a clean result.
 *   - a check that runs and FINDS something — recorded allergies, a known
 *     interaction — does not block. That is information for the provider,
 *     not a failure.
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
const siblingsMock         = jest.fn()
const providerFetchMock    = jest.fn()
const pharmacyFetchMock    = jest.fn()
const clinicFetchMock      = jest.fn()
const licenseFetchMock     = jest.fn()
const formulationFetchMock = jest.fn()
const patientAllergyMock   = jest.fn()
const interactionsMock     = jest.fn()
const orderUpdateMock      = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockResolvedValue({ auth: { getSession: () => getSessionMock() } }),
}))

/** A read chain: filters return the chain; maybeSingle / await resolve. */
function readChain(single: () => unknown, list?: () => unknown): Record<string, unknown> {
  const c: Record<string, unknown> = {}
  for (const k of ['select', 'eq', 'is', 'in', 'or', 'order', 'limit', 'neq']) c[k] = () => c
  c['maybeSingle'] = () => single()
  c['single'] = () => single()
  c['then'] = (resolve: (r: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve((list ?? single)()).then(resolve, reject)
  return c
}

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn().mockReturnValue({
    from: (table: string) => {
      if (table === 'orders') {
        return {
          select: () => readChain(() => orderFetchMock(), () => siblingsMock()),
          update: () => ({ eq: () => ({ eq: () => ({ select: () => orderUpdateMock() }) }) }),
        }
      }
      if (table === 'providers')               return { select: () => readChain(() => providerFetchMock()) }
      if (table === 'pharmacies')              return { select: () => readChain(() => pharmacyFetchMock()) }
      if (table === 'clinics')                 return { select: () => readChain(() => clinicFetchMock()) }
      if (table === 'pharmacy_state_licenses') return { select: () => readChain(() => licenseFetchMock()) }
      if (table === 'formulations')            return { select: () => readChain(() => formulationFetchMock()) }
      if (table === 'patients')                return { select: () => readChain(() => patientAllergyMock()) }
      if (table === 'drug_interactions')       return { select: () => readChain(() => interactionsMock(), () => interactionsMock()) }
      throw new Error(`Unexpected table in test: ${table}`)
    },
  }),
}))

function makeParams() { return { params: Promise.resolve({ orderId: TEST_ORDER_ID }) } }
function makeRequest(body: unknown) { return { json: async () => body } as unknown as import('next/server').NextRequest }
async function post() { return POST(makeRequest({ signatureDataUrl: VALID_SIG_DATA_URL }), makeParams()) }

const SEMA_SNAPSHOT  = { medication_name: 'Semaglutide 5mg/mL Injectable', dea_schedule: 0 }
const TESTO_SNAPSHOT = { medication_name: 'Testosterone Cypionate 200mg/mL', dea_schedule: 0 }
const INTERACTION = {
  interaction_id: 'int-1', severity: 'warning', description: 'Monitor together.',
  ingredient_a: { common_name: 'Semaglutide' }, ingredient_b: { common_name: 'Testosterone' },
}

beforeEach(() => {
  for (const m of [getSessionMock, orderFetchMock, siblingsMock, providerFetchMock, pharmacyFetchMock, clinicFetchMock,
    licenseFetchMock, formulationFetchMock, patientAllergyMock, interactionsMock, orderUpdateMock]) m.mockReset()

  getSessionMock.mockResolvedValue({
    data: { session: { user: { id: PROVIDER_USER_ID, email: 'p@e.t', user_metadata: { app_role: 'provider', clinic_id: TEST_CLINIC_ID } } } },
  })
  orderFetchMock.mockResolvedValue({
    data: {
      order_id: TEST_ORDER_ID, status: 'DRAFT', clinic_id: TEST_CLINIC_ID,
      patient_id: 'patient-1', provider_id: TEST_PROVIDER_ID,
      catalog_item_id: null, formulation_id: TEST_FORM_ID, pharmacy_id: 'pharmacy-1',
      retail_price_snapshot: 100, wholesale_price_snapshot: 60, shipping_state_snapshot: 'TX',
      medication_snapshot: SEMA_SNAPSHOT,
      pharmacy_snapshot: { integration_tier: 'TIER_4_FAX' },
      clinical_difference: null, diagnosis_code: null, diagnosis_text: null,
      days_supply: 28, dispense_quantity: 1, dispense_unit: 'mL', refills: 0,
    },
    error: null,
  })
  // This draft and a sibling draft the MA prepared with it.
  siblingsMock.mockResolvedValue({
    data: [{ medication_snapshot: SEMA_SNAPSHOT }, { medication_snapshot: TESTO_SNAPSHOT }],
    error: null,
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
  // Findings on both checks: recorded allergies, and a real interaction.
  patientAllergyMock.mockResolvedValue({ data: { allergies: ['penicillin'], nkda: false }, error: null })
  interactionsMock.mockResolvedValue({ data: [INTERACTION], error: null })
  // Unmodelled CAS update: reaching it (a 500 with this message) means
  // every gate before it let the order through.
  orderUpdateMock.mockResolvedValue({ data: null, error: { message: 'not modelled in this harness' } })
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'info').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => { jest.restoreAllMocks() })

describe('sign-and-send — allergy status at send time', () => {
  it('returns 503 when the allergy read errors', async () => {
    patientAllergyMock.mockResolvedValue({ data: null, error: { message: 'connection reset', code: '08006' } })

    const res = await post()

    expect(res.status).toBe(503)
    expect((await res.json() as { error: string }).error).toMatch(/allerg/i)
  })

  it('logs it with the [sign-and-send] prefix', async () => {
    const errorSpy = jest.spyOn(console, 'error')
    patientAllergyMock.mockResolvedValue({ data: null, error: { message: 'connection reset', code: '08006' } })

    await post()

    expect(errorSpy.mock.calls.some(c => String(c[0]).includes('[sign-and-send]') && /allerg/i.test(String(c[0])))).toBe(true)
  })
})

describe('sign-and-send — interaction check at send time', () => {
  it('returns 503 when the interaction read errors', async () => {
    interactionsMock.mockResolvedValue({ data: null, error: { message: 'connection reset', code: '08006' } })

    const res = await post()

    expect(res.status).toBe(503)
    expect((await res.json() as { error: string }).error).toMatch(/interaction/i)
  })

  it('returns 503 when the sibling drafts it checks across cannot be read', async () => {
    siblingsMock.mockResolvedValue({ data: null, error: { message: 'connection reset', code: '08006' } })

    const res = await post()

    expect(res.status).toBe(503)
  })

  it('logs it with the [sign-and-send] prefix', async () => {
    const errorSpy = jest.spyOn(console, 'error')
    interactionsMock.mockResolvedValue({ data: null, error: { message: 'connection reset', code: '08006' } })

    await post()

    expect(errorSpy.mock.calls.some(c => String(c[0]).includes('[sign-and-send]') && /interaction/i.test(String(c[0])))).toBe(true)
  })
})

describe('sign-and-send — checks that run and find something', () => {
  it('still sends with recorded allergies and a known interaction', async () => {
    const res = await post()

    // Reached the (unmodelled) CAS update: nothing refused it.
    expect(res.status).toBe(500)
    expect(orderUpdateMock).toHaveBeenCalled()
  })

  it('actually ran both reads — the result is not a skipped check', async () => {
    await post()

    expect(patientAllergyMock).toHaveBeenCalled()
    expect(interactionsMock).toHaveBeenCalled()
  })
})
