/**
 * @jest-environment node
 *
 * Defense-in-depth: POST /api/orders must reject a DRAFT whose pharmacy
 * holds no ACTIVE license in the patient's shipping state.
 *
 * Context: the builder's pharmacy_options level and the quick-actions
 * panel filter unlicensed pharmacies client-side, and sign-and-send
 * re-checks at lock time — but the DRAFT creation path previously
 * trusted the caller. A protocol/favorite quick-load with a pinned
 * pharmacy (e.g. the BHRT protocol's Portal Plus items for a CA
 * patient) could create a DRAFT routed to an unlicensed pharmacy.
 *
 * Mocking pattern reused from f5-primary-provider.test.ts: a proxy
 * builder that records filters and resolves terminals from per-table
 * fixtures.
 */

import { POST } from '../route'

// ── Constants ──────────────────────────────────────────────────

const TEST_CLINIC_ID    = 'a1000000-0000-0000-0000-000000000001'
const TEST_PROVIDER_ID  = 'a2000000-0000-0000-0000-000000000001'
const TEST_PATIENT_ID   = 'a3000000-0000-0000-0000-000000000001'
const TEST_PHARMACY_ID  = 'a4000000-0000-0000-0000-000000000004'
const TEST_CATALOG_ID   = 'a5000000-0000-0000-0000-000000000001'
const TEST_FORM_ID      = 'a7000000-0000-0000-0000-000000000001'
const TEST_ORDER_ID     = 'a6000000-0000-0000-0000-000000000001'

// ── Supabase mocks (see f5-primary-provider.test.ts) ─────────────────

type ChainBuilder = Record<string, unknown>

type QueryCall = {
  table: string
  filters: Array<{ method: string; column: string; value: unknown }>
}

let queryCalls: QueryCall[] = []

const getSessionMock = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockResolvedValue({
    auth: { getSession: () => getSessionMock() },
  }),
}))

const fixtures: Record<string, () => unknown> = {}

function makeChain(table: string): ChainBuilder {
  const filters: QueryCall['filters'] = []
  const builder: ChainBuilder = {}

  const recordFilter = (method: string) => (column: string, value: unknown) => {
    filters.push({ method, column, value })
    return builder
  }

  builder['select']      = () => builder
  builder['insert']      = () => builder
  builder['update']      = () => builder
  builder['eq']          = recordFilter('eq')
  builder['is']          = recordFilter('is')
  builder['in']          = recordFilter('in')

  builder['maybeSingle'] = () => {
    queryCalls.push({ table, filters })
    const fixture = fixtures[`${table}:maybeSingle`]
    return Promise.resolve(fixture ? fixture() : { data: null, error: null })
  }

  builder['single'] = () => {
    queryCalls.push({ table, filters })
    const fixture = fixtures[`${table}:single`]
    return Promise.resolve(fixture ? fixture() : { data: null, error: null })
  }

  builder['then'] = (resolve: (v: unknown) => unknown) => {
    queryCalls.push({ table, filters })
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
  return {
    json: async () => body,
  } as unknown as import('next/server').NextRequest
}

function defaultBody() {
  return {
    patientId:     TEST_PATIENT_ID,
    providerId:    TEST_PROVIDER_ID,
    catalogItemId: TEST_CATALOG_ID,
    pharmacyId:    TEST_PHARMACY_ID,
    retailCents:   5000,
    sigText:       'Take one capsule by mouth at bedtime',
    patientState:  'CA',
  }
}

function installHappyFixtures() {
  fixtures['catalog:maybeSingle'] = () => ({
    data: {
      item_id:         TEST_CATALOG_ID,
      medication_name: 'Progesterone Capsule 100mg',
      form:            'Capsule',
      dose:            '100mg',
      wholesale_price: 18.50,
      dea_schedule:    null,
    },
    error: null,
  })
  fixtures['formulations:maybeSingle'] = () => ({
    data: {
      formulation_id: TEST_FORM_ID,
      name:           'Progesterone Capsule 100mg',
      concentration:  '100mg',
      dosage_forms:   { name: 'Capsule' },
    },
    error: null,
  })
  fixtures['pharmacy_formulations:maybeSingle'] = () => ({
    data: { wholesale_price: 18.50 },
    error: null,
  })
  fixtures['formulation_ingredients:await'] = () => ({
    data: [],
    error: null,
  })
  fixtures['pharmacies:maybeSingle'] = () => ({
    data: {
      pharmacy_id:      TEST_PHARMACY_ID,
      name:             'Portal Plus Pharmacy',
      integration_tier: 'TIER_2_PORTAL',
      fax_number:       null,
    },
    error: null,
  })
  fixtures['pharmacy_state_licenses:maybeSingle'] = () => ({
    data: { pharmacy_id: TEST_PHARMACY_ID },
    error: null,
  })
  fixtures['providers:maybeSingle'] = () => ({
    data: {
      provider_id: TEST_PROVIDER_ID,
      npi_number:  '1234567890',
      clinic_id:   TEST_CLINIC_ID,
    },
    error: null,
  })
  fixtures['patients:maybeSingle'] = () => ({
    data: {
      patient_id: TEST_PATIENT_ID,
      clinic_id:  TEST_CLINIC_ID,
    },
    error: null,
  })
  fixtures['clinics:maybeSingle'] = () => ({
    data: {
      order_intake_blocked:  false,
      stripe_connect_status: 'ACTIVE',
    },
    error: null,
  })
  fixtures['orders:single'] = () => ({
    data: { order_id: TEST_ORDER_ID },
    error: null,
  })
}

beforeEach(() => {
  queryCalls = []
  Object.keys(fixtures).forEach((k) => delete fixtures[k])

  getSessionMock.mockResolvedValue({
    data: {
      session: {
        user: {
          id: 'auth-uid-provider',
          user_metadata: {
            clinic_id: TEST_CLINIC_ID,
            app_role:  'provider',
          },
        },
      },
    },
  })

  installHappyFixtures()
})

// ── Tests ──────────────────────────────────────────────────────

describe('POST /api/orders — pharmacy state-licensure validation', () => {
  it('rejects with 400 naming the pharmacy and state when no ACTIVE license exists', async () => {
    fixtures['pharmacy_state_licenses:maybeSingle'] = () => ({ data: null, error: null })

    const res = await POST(makeRequest(defaultBody()))
    expect(res.status).toBe(400)

    const body = await res.json()
    expect(body.error).toBe('Pharmacy Portal Plus Pharmacy is not licensed in CA')
  })

  it('queries pharmacy_state_licenses scoped to pharmacy + state + is_active', async () => {
    const res = await POST(makeRequest(defaultBody()))
    expect(res.status).toBe(201)

    const licenseQueries = queryCalls.filter((c) => c.table === 'pharmacy_state_licenses')
    expect(licenseQueries).toHaveLength(1)

    const [q] = licenseQueries
    if (!q) throw new Error('unreachable')
    expect(q.filters).toEqual(
      expect.arrayContaining([
        { method: 'eq', column: 'pharmacy_id', value: TEST_PHARMACY_ID },
        { method: 'eq', column: 'state_code',  value: 'CA' },
        { method: 'eq', column: 'is_active',   value: true },
      ]),
    )
  })

  it('creates the DRAFT (201) when an ACTIVE license row exists', async () => {
    const res = await POST(makeRequest(defaultBody()))
    expect(res.status).toBe(201)

    const body = await res.json()
    expect(body).toEqual({ orderId: TEST_ORDER_ID })
  })

  it('also rejects on the V3.0 formulation branch (protocol quick-load path)', async () => {
    fixtures['pharmacy_state_licenses:maybeSingle'] = () => ({ data: null, error: null })

    const res = await POST(makeRequest({
      ...defaultBody(),
      catalogItemId: undefined,
      formulationId: TEST_FORM_ID,
    }))
    expect(res.status).toBe(400)

    const body = await res.json()
    expect(body.error).toBe('Pharmacy Portal Plus Pharmacy is not licensed in CA')
  })

  it('returns 500 (not a silent pass) when the license lookup itself errors', async () => {
    fixtures['pharmacy_state_licenses:maybeSingle'] = () => ({
      data: null,
      error: { message: 'connection reset' },
    })

    const res = await POST(makeRequest(defaultBody()))
    expect(res.status).toBe(500)
  })
})
