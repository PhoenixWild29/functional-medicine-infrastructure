/**
 * @jest-environment node
 *
 * WO-100: POST /api/orders — a provider prescribes as themself.
 *
 *   - provider-role session + providerId == own provider row → 201
 *   - provider-role session + providerId != own provider row → 403,
 *     no order insert
 *   - provider-role session with no linked provider row → 403
 *   - clinic_admin / medical_assistant sessions are unaffected: they
 *     may name any provider in the clinic (the MA path)
 *
 * Mocking pattern reused from wo96-rx-details.test.ts.
 */

import { POST } from '../route'

const TEST_CLINIC_ID     = 'a1000000-0000-0000-0000-000000000001'
const PROVIDER_CHEN_ID   = 'a2000000-0000-0000-0000-000000000001'
const PROVIDER_PATEL_ID  = 'a2000000-0000-0000-0000-000000000002'
const TEST_PATIENT_ID    = 'a3000000-0000-0000-0000-000000000001'
const TEST_PHARMACY_ID   = 'a4000000-0000-0000-0000-000000000004'
const TEST_FORM_ID       = 'a7000000-0000-0000-0000-000000000001'
const TEST_ORDER_ID      = 'a6000000-0000-0000-0000-000000000001'
const CHEN_AUTH_UID      = 'auth-uid-chen'

type ChainBuilder = Record<string, unknown>

let insertedRows: Array<{ table: string; row: Record<string, unknown> }> = []
let providerFilters: Array<[string, unknown]> = []

const getSessionMock = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockResolvedValue({
    auth: { getSession: () => getSessionMock() },
  }),
}))

const fixtures: Record<string, () => unknown> = {}

function makeChain(table: string): ChainBuilder {
  const builder: ChainBuilder = {}
  const filters: Array<[string, unknown]> = []
  const passthrough = () => builder

  builder['select'] = passthrough
  builder['insert'] = (row: Record<string, unknown>) => {
    insertedRows.push({ table, row })
    return builder
  }
  builder['update'] = passthrough
  builder['eq'] = (column: string, value: unknown) => { filters.push([column, value]); return builder }
  builder['is'] = passthrough
  builder['in'] = passthrough
  builder['maybeSingle'] = () => {
    if (table === 'providers') {
      providerFilters = filters
      // The WO-100 resolver filters on user_id; the existing
      // "provider belongs to clinic" fetch filters on provider_id.
      const byUser = filters.find(([c]) => c === 'user_id')
      if (byUser) {
        const fixture = fixtures['providers:byUser']
        return Promise.resolve(fixture ? fixture() : { data: null, error: null })
      }
    }
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

function body(providerId: string) {
  return {
    patientId:     TEST_PATIENT_ID,
    providerId,
    formulationId: TEST_FORM_ID,
    pharmacyId:    TEST_PHARMACY_ID,
    retailCents:   19000,
    sigText:       'Inject 10 units (0.10mL / 0.50mg) subcutaneously once weekly',
    patientState:  'TX',
  }
}

function session(appRole: string, userId = CHEN_AUTH_UID) {
  return { data: { session: { user: { id: userId, user_metadata: { clinic_id: TEST_CLINIC_ID, app_role: appRole } } } } }
}

function installHappyFixtures() {
  fixtures['formulations:maybeSingle'] = () => ({
    data: { formulation_id: TEST_FORM_ID, name: 'Semaglutide 5mg/mL Injectable', concentration: '5mg/mL', dosage_forms: { name: 'Injectable Solution' } },
    error: null,
  })
  fixtures['pharmacy_formulations:maybeSingle'] = () => ({ data: { wholesale_price: 95 }, error: null })
  fixtures['formulation_ingredients:await'] = () => ({ data: [{ ingredients: { dea_schedule: null } }], error: null })
  fixtures['pharmacies:maybeSingle'] = () => ({
    data: { pharmacy_id: TEST_PHARMACY_ID, name: 'Strive Pharmacy', integration_tier: 'TIER_1_API', fax_number: null, is_active: true, deleted_at: null },
    error: null,
  })
  fixtures['pharmacy_state_licenses:maybeSingle'] = () => ({ data: { pharmacy_id: TEST_PHARMACY_ID }, error: null })
  // Provider lookup by provider_id (clinic membership) — answers for whichever id was asked.
  fixtures['providers:maybeSingle'] = () => {
    const asked = providerFilters.find(([c]) => c === 'provider_id')?.[1] as string
    return { data: { provider_id: asked, npi_number: '1234567890', clinic_id: TEST_CLINIC_ID }, error: null }
  }
  // Provider lookup by user_id (WO-100 resolver): Chen's login is Chen.
  fixtures['providers:byUser'] = () => ({
    data: { provider_id: PROVIDER_CHEN_ID, clinic_id: TEST_CLINIC_ID, first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', signature_hash: null },
    error: null,
  })
  fixtures['patients:maybeSingle'] = () => ({ data: { patient_id: TEST_PATIENT_ID, clinic_id: TEST_CLINIC_ID }, error: null })
  fixtures['clinics:maybeSingle'] = () => ({ data: { order_intake_blocked: false, stripe_connect_status: 'ACTIVE' }, error: null })
  fixtures['orders:single'] = () => ({ data: { order_id: TEST_ORDER_ID }, error: null })
}

beforeEach(() => {
  insertedRows = []
  providerFilters = []
  Object.keys(fixtures).forEach(k => delete fixtures[k])
  installHappyFixtures()
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('POST /api/orders — WO-100 provider prescribes as themself', () => {
  it('201: a provider creating an order under their own provider row', async () => {
    getSessionMock.mockResolvedValue(session('provider'))
    const res = await POST(makeRequest(body(PROVIDER_CHEN_ID)))
    expect(res.status).toBe(201)
    const insert = insertedRows.find(r => r.table === 'orders')
    expect(insert?.row['provider_id']).toBe(PROVIDER_CHEN_ID)
  })

  it('403: a provider naming a different provider_id — nothing is inserted', async () => {
    getSessionMock.mockResolvedValue(session('provider'))
    const res = await POST(makeRequest(body(PROVIDER_PATEL_ID)))
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toBe(
      'This draft belongs to another provider. Reassign it to yourself with Sign as me before adding or editing prescriptions.',
    )
    expect(json.code).toBe('DRAFT_BELONGS_TO_OTHER_PROVIDER')
    expect(json.error).not.toMatch(/doctor/i)
    expect(insertedRows.filter(r => r.table === 'orders')).toHaveLength(0)
  })

  it("403 with the reassign-first message: a provider adding a line to another provider's draft (WO-98 + Add prescription)", async () => {
    getSessionMock.mockResolvedValue(session('provider'))
    const res = await POST(makeRequest({
      ...body(PROVIDER_PATEL_ID),
      appendedToOrderId: '99999999-9999-4999-8999-999999999999',
    }))
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.code).toBe('DRAFT_BELONGS_TO_OTHER_PROVIDER')
    expect(json.error).toMatch(/belongs to another provider/)
    expect(json.error).toMatch(/Sign as me/)
    expect(insertedRows.filter(r => r.table === 'orders')).toHaveLength(0)
  })

  it('403: a provider-role login with no linked provider row cannot create drafts', async () => {
    getSessionMock.mockResolvedValue(session('provider', 'auth-uid-unlinked'))
    fixtures['providers:byUser'] = () => ({ data: null, error: null })
    const res = await POST(makeRequest(body(PROVIDER_CHEN_ID)))
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toMatch(/not linked/i)
    expect(insertedRows.filter(r => r.table === 'orders')).toHaveLength(0)
  })

  it.each(['clinic_admin', 'medical_assistant'])('201: a %s may create a draft for any provider in the clinic', async (role) => {
    getSessionMock.mockResolvedValue(session(role, 'auth-uid-staff'))
    const res = await POST(makeRequest(body(PROVIDER_PATEL_ID)))
    expect(res.status).toBe(201)
    const insert = insertedRows.find(r => r.table === 'orders')
    expect(insert?.row['provider_id']).toBe(PROVIDER_PATEL_ID)
    // The resolver never ran for a non-provider session.
    expect(providerFilters.find(([c]) => c === 'user_id')).toBeUndefined()
  })
})
