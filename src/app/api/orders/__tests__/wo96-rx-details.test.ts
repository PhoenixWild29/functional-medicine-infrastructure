/**
 * @jest-environment node
 *
 * WO-96: POST /api/orders persists the Rx detail fields.
 *
 *   - rxDetails omitted → defaults (refills 0, substitution allowed,
 *     syringe none, shipping standard) so pre-WO-96 clients still work.
 *   - rxDetails supplied → every field lands on the insert as its
 *     snake_case column.
 *   - malformed rxDetails → 400 before any DB access.
 *
 * Mocking pattern reused from state-license-validation.test.ts.
 */

import { POST } from '../route'

const TEST_CLINIC_ID   = 'a1000000-0000-0000-0000-000000000001'
const TEST_PROVIDER_ID = 'a2000000-0000-0000-0000-000000000001'
const TEST_PATIENT_ID  = 'a3000000-0000-0000-0000-000000000001'
const TEST_PHARMACY_ID = 'a4000000-0000-0000-0000-000000000004'
const TEST_FORM_ID     = 'a7000000-0000-0000-0000-000000000001'
const TEST_ORDER_ID    = 'a6000000-0000-0000-0000-000000000001'

type ChainBuilder = Record<string, unknown>

let insertedRows: Array<{ table: string; row: Record<string, unknown> }> = []
let tablesTouched: string[] = []

const getSessionMock = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockResolvedValue({
    auth: { getSession: () => getSessionMock() },
  }),
}))

const fixtures: Record<string, () => unknown> = {}

function makeChain(table: string): ChainBuilder {
  tablesTouched.push(table)
  const builder: ChainBuilder = {}
  const passthrough = () => builder

  builder['select'] = passthrough
  builder['insert'] = (row: Record<string, unknown>) => {
    insertedRows.push({ table, row })
    return builder
  }
  builder['update'] = passthrough
  builder['eq'] = passthrough
  builder['is'] = passthrough
  builder['in'] = passthrough
  builder['maybeSingle'] = () => {
    const fixture = fixtures[`${table}:maybeSingle`]
    return Promise.resolve(fixture ? fixture() : { data: null, error: null })
  }
  builder['single'] = () => {
    const fixture = fixtures[`${table}:single`]
    return Promise.resolve(fixture ? fixture() : { data: null, error: null })
  }
  builder['then'] = (resolve: (v: unknown) => unknown) => {
    const fixture = fixtures[`${table}:await`]
    return Promise.resolve(fixture ? fixture() : { data: null, error: null }).then(resolve)
  }
  return builder
}

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn().mockReturnValue({
    from: (table: string) => makeChain(table),
  }),
}))

function makeRequest(body: unknown): import('next/server').NextRequest {
  return { json: async () => body } as unknown as import('next/server').NextRequest
}

function formulationBody(extra: Record<string, unknown> = {}) {
  return {
    patientId:     TEST_PATIENT_ID,
    providerId:    TEST_PROVIDER_ID,
    formulationId: TEST_FORM_ID,
    pharmacyId:    TEST_PHARMACY_ID,
    retailCents:   19000,
    sigText:       'Inject 10 units (0.10mL / 0.50mg) subcutaneously once weekly',
    patientState:  'TX',
    ...extra,
  }
}

function installHappyFixtures() {
  fixtures['formulations:maybeSingle'] = () => ({
    data: {
      formulation_id: TEST_FORM_ID,
      name:           'Semaglutide 5mg/mL Injectable',
      concentration:  '5mg/mL',
      dosage_forms:   { name: 'Injectable Solution' },
    },
    error: null,
  })
  fixtures['pharmacy_formulations:maybeSingle'] = () => ({ data: { wholesale_price: 95 }, error: null })
  fixtures['formulation_ingredients:await'] = () => ({ data: [{ ingredients: { dea_schedule: null } }], error: null })
  fixtures['pharmacies:maybeSingle'] = () => ({
    data: { pharmacy_id: TEST_PHARMACY_ID, name: 'Strive Pharmacy', integration_tier: 'TIER_1_API', fax_number: null },
    error: null,
  })
  fixtures['pharmacy_state_licenses:maybeSingle'] = () => ({ data: { pharmacy_id: TEST_PHARMACY_ID }, error: null })
  fixtures['providers:maybeSingle'] = () => ({
    data: { provider_id: TEST_PROVIDER_ID, npi_number: '1234567890', clinic_id: TEST_CLINIC_ID },
    error: null,
  })
  fixtures['patients:maybeSingle'] = () => ({ data: { patient_id: TEST_PATIENT_ID, clinic_id: TEST_CLINIC_ID }, error: null })
  fixtures['clinics:maybeSingle'] = () => ({ data: { order_intake_blocked: false, stripe_connect_status: 'ACTIVE' }, error: null })
  fixtures['orders:single'] = () => ({ data: { order_id: TEST_ORDER_ID }, error: null })
}

beforeEach(() => {
  insertedRows = []
  tablesTouched = []
  Object.keys(fixtures).forEach(k => delete fixtures[k])
  getSessionMock.mockResolvedValue({
    data: {
      session: {
        user: { id: 'auth-uid-provider', user_metadata: { clinic_id: TEST_CLINIC_ID, app_role: 'provider' } },
      },
    },
  })
  installHappyFixtures()
})

function orderInsert(): Record<string, unknown> {
  const insert = insertedRows.find(r => r.table === 'orders')
  if (!insert) throw new Error('orders insert not recorded')
  return insert.row
}

describe('POST /api/orders — WO-96 Rx detail fields', () => {
  it('writes defaults when rxDetails is omitted (pre-WO-96 clients)', async () => {
    const res = await POST(makeRequest(formulationBody()))
    expect(res.status).toBe(201)

    expect(orderInsert()).toEqual(expect.objectContaining({
      days_supply:          null,
      dispense_quantity:    null,
      dispense_unit:        null,
      refills:              0,
      substitution_allowed: true,
      syringe_option:       'none',
      shipping_type:        'standard',
      clinical_difference:  null,
      diagnosis_code:       null,
      diagnosis_text:       null,
      special_instructions: null,
    }))
  })

  it('persists every supplied field as its column', async () => {
    const res = await POST(makeRequest(formulationBody({
      rxDetails: {
        daysSupply:          350,
        dispenseQuantity:    5,
        dispenseUnit:        'mL',
        refills:             1,
        substitutionAllowed: false,
        syringeOption:       'sc_kit',
        shippingType:        'cold_chain',
        clinicalDifference:  'Patient requires a dose or strength not commercially available',
        diagnosisCode:       'E66.9',
        diagnosisText:       'Obesity, unspecified',
        specialInstructions: 'Ship with ice packs',
      },
    })))
    expect(res.status).toBe(201)

    expect(orderInsert()).toEqual(expect.objectContaining({
      formulation_id:       TEST_FORM_ID,
      days_supply:          350,
      dispense_quantity:    5,
      dispense_unit:        'mL',
      refills:              1,
      substitution_allowed: false,
      syringe_option:       'sc_kit',
      shipping_type:        'cold_chain',
      clinical_difference:  'Patient requires a dose or strength not commercially available',
      diagnosis_code:       'E66.9',
      diagnosis_text:       'Obesity, unspecified',
      special_instructions: 'Ship with ice packs',
    }))
  })

  it('does not block a DRAFT missing a rule-required field (sign-and-send is the gate)', async () => {
    // Controlled ingredient, no diagnosis: the MA may still save the draft.
    fixtures['formulation_ingredients:await'] = () => ({ data: [{ ingredients: { dea_schedule: 3 } }], error: null })
    const res = await POST(makeRequest(formulationBody({ rxDetails: { refills: 0 } })))
    expect(res.status).toBe(201)
    expect(orderInsert()).toEqual(expect.objectContaining({ diagnosis_code: null, diagnosis_text: null }))
  })

  it.each([
    [{ refills: 13 },              /refills/],
    [{ syringeOption: 'needle' },  /syringeOption/],
    [{ shippingType: 'overnight' }, /shippingType/],
    [{ daysSupply: -3 },           /daysSupply/],
  ])('rejects malformed rxDetails %j with 400 before touching the database', async (rxDetails, pattern) => {
    const res = await POST(makeRequest(formulationBody({ rxDetails })))
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(pattern)
    expect(tablesTouched).toEqual([])
  })
})
