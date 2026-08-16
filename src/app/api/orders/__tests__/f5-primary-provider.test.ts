/**
 * @jest-environment node
 *
 * F-5 (audit role-audit-and-data-model.md §F-5): lazy auto-default of
 * patients.primary_provider_id on first order creation.
 *
 * Two layers of coverage:
 *
 *   1. Migration content. The column + FK + reverse-lookup index must
 *      exist exactly as the audit spec calls for, including the
 *      ON DELETE SET NULL behaviour and idempotency guards.
 *
 *   2. Behavioural contract in the create-order path
 *      (POST /api/orders):
 *        - patient with NULL primary_provider_id → set to order.providerId
 *        - patient with EXISTING primary_provider_id → NOT overwritten
 *      The .is('primary_provider_id', null) filter is what enforces (b)
 *      at the SQL tier, so the test asserts the chain shape — if a future
 *      refactor drops that filter, the test fails.
 *
 * We intentionally do NOT cover the rest of the create-order surface
 * (catalog vs. formulation branch, snapshot freezing, etc.) — that's
 * not what F-5 changed.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { POST } from '../route'

// ── Constants ──────────────────────────────────────────────────

const TEST_CLINIC_ID    = 'a1000000-0000-0000-0000-000000000001'
const TEST_PROVIDER_ID  = 'a2000000-0000-0000-0000-000000000001'
const TEST_PATIENT_ID   = 'a3000000-0000-0000-0000-000000000001'
const TEST_PHARMACY_ID  = 'a4000000-0000-0000-0000-000000000001'
const TEST_CATALOG_ID   = 'a5000000-0000-0000-0000-000000000001'
const TEST_ORDER_ID     = 'a6000000-0000-0000-0000-000000000001'

// ── Migration content tests ──────────────────────────────────────

describe('F-5 migration: 20260614000004_f5_patients_primary_provider_id.sql', () => {
  const migrationPath = join(
    process.cwd(),
    'supabase',
    'migrations',
    '20260614000004_f5_patients_primary_provider_id.sql',
  )
  const sql = readFileSync(migrationPath, 'utf8')

  it('adds primary_provider_id column to patients, idempotently', () => {
    expect(sql).toMatch(
      /ALTER\s+TABLE\s+patients\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+primary_provider_id\s+UUID\s+NULL/i,
    )
  })

  it('FK targets providers(provider_id) with ON DELETE SET NULL', () => {
    // A deleted provider must NOT orphan/cascade-delete their patients.
    // The audit calls for SET NULL specifically so historical orders
    // survive provider deletion while the patient itself stays usable.
    expect(sql).toMatch(
      /REFERENCES\s+providers\s*\(\s*provider_id\s*\)\s+ON\s+DELETE\s+SET\s+NULL/i,
    )
  })

  it('creates a reverse-lookup index, idempotently', () => {
    // "All of provider P's primary patients" needs an index on
    // primary_provider_id. Partial (WHERE NOT NULL) to keep it small.
    expect(sql).toMatch(/CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+patients_primary_provider_id_idx/i)
    expect(sql).toMatch(/ON\s+patients\s*\(\s*primary_provider_id\s*\)/i)
    expect(sql).toMatch(/WHERE\s+primary_provider_id\s+IS\s+NOT\s+NULL/i)
  })

  it('does not backfill existing rows', () => {
    // Per the audit + WO constraints: column starts NULL for all
    // existing patients. The auto-default in the create-order path
    // fills it lazily over time. Any UPDATE statement against patients
    // here would be a regression.
    expect(sql).not.toMatch(/UPDATE\s+patients/i)
  })

  it('does not touch RLS policies', () => {
    // The existing patients_* policies already gate by clinic_id, which
    // covers the new column for free. A new policy here would be a
    // scope creep / regression.
    expect(sql).not.toMatch(/CREATE\s+POLICY/i)
    expect(sql).not.toMatch(/DROP\s+POLICY/i)
  })
})

// ── Auto-default behavioural test ──────────────────────────────────

// We mock the supabase-js builder chain with a single proxy object that
// returns itself for every method except the terminal ones. This is
// enough to drive the create-order route end-to-end without standing up
// a real DB.

type ChainBuilder = Record<string, unknown>

// Track what update payloads were sent to which table, and what filters
// were applied. This is how we assert the F-5 auto-default semantics.
type UpdateCall = {
  table: string
  payload: Record<string, unknown>
  filters: Array<{ method: string; column: string; value: unknown }>
}

let updateCalls: UpdateCall[] = []
let lastFromTable: string | null = null

const getSessionMock = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockResolvedValue({
    auth: { getSession: () => getSessionMock() },
  }),
}))

// Fixtures returned by the terminal .maybeSingle() / .single() calls.
// Each is set per-test; the proxy below picks them up by current
// "lastFromTable" state.
const fixtures: Record<string, () => unknown> = {}

function makeChain(table: string): ChainBuilder {
  const filters: UpdateCall['filters'] = []
  let pendingUpdate: Record<string, unknown> | null = null

  const builder: ChainBuilder = {}

  const recordFilter = (method: string) => (column: string, value: unknown) => {
    filters.push({ method, column, value })
    return builder
  }

  builder['select']      = () => builder
  builder['insert']      = () => builder
  builder['update']      = (payload: Record<string, unknown>) => {
    pendingUpdate = payload
    return builder
  }
  builder['eq']          = recordFilter('eq')
  builder['is']          = recordFilter('is')
  builder['neq']         = recordFilter('neq')

  builder['maybeSingle'] = () => {
    // If there's a pending update with filters, this is the
    // terminal of an update chain.
    if (pendingUpdate !== null) {
      updateCalls.push({ table, payload: pendingUpdate, filters })
      return Promise.resolve({ data: null, error: null })
    }
    const fixture = fixtures[`${table}:maybeSingle`]
    return Promise.resolve(fixture ? fixture() : { data: null, error: null })
  }

  builder['single'] = () => {
    if (pendingUpdate !== null) {
      updateCalls.push({ table, payload: pendingUpdate, filters })
      return Promise.resolve({ data: null, error: null })
    }
    const fixture = fixtures[`${table}:single`]
    return Promise.resolve(fixture ? fixture() : { data: null, error: null })
  }

  // Awaiting the builder without .single/.maybeSingle. This is what the
  // F-5 update chain does: `await supabase.from('patients').update(...).
  // eq(...).eq(...).is(...)`. The terminal isn't .single() — the chain
  // itself is awaited. We expose .then on the builder for that case.
  builder['then'] = (resolve: (v: unknown) => unknown) => {
    if (pendingUpdate !== null) {
      updateCalls.push({ table, payload: pendingUpdate, filters })
      return Promise.resolve({ data: null, error: null }).then(resolve)
    }
    return Promise.resolve({ data: null, error: null }).then(resolve)
  }

  return builder
}

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn().mockReturnValue({
    from: (table: string) => {
      lastFromTable = table
      return makeChain(table)
    },
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
    sigText:       'Take one tablet by mouth daily',
    patientState:  'CA',
  }
}

function installHappyFixtures() {
  fixtures['catalog:maybeSingle'] = () => ({
    data: {
      item_id:         TEST_CATALOG_ID,
      medication_name: 'Test Med',
      form:            'Tablet',
      dose:            '10mg',
      wholesale_price: 10.00,
      dea_schedule:    null,
    },
    error: null,
  })
  fixtures['pharmacies:maybeSingle'] = () => ({
    data: {
      pharmacy_id:      TEST_PHARMACY_ID,
      name:             'Test Pharmacy',
      integration_tier: 'API',
      fax_number:       null,
    },
    error: null,
  })
  // State-licensure defense-in-depth check in POST /api/orders: the
  // happy path needs an ACTIVE license row for the patient's state.
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
      order_intake_blocked:   false,
      stripe_connect_status:  'ACTIVE',
    },
    error: null,
  })
  fixtures['orders:single'] = () => ({
    data: { order_id: TEST_ORDER_ID },
    error: null,
  })
}

beforeEach(() => {
  updateCalls = []
  lastFromTable = null
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

describe('F-5 auto-default: patients.primary_provider_id on order create', () => {
  it('issues an UPDATE patients SET primary_provider_id = providerId WHERE primary_provider_id IS NULL', async () => {
    const res = await POST(makeRequest(defaultBody()))
    expect(res.status).toBe(201)

    // Find the update against patients
    const patientUpdates = updateCalls.filter((c) => c.table === 'patients')
    expect(patientUpdates).toHaveLength(1)

    const [u] = patientUpdates
    if (!u) throw new Error('unreachable')

    // (a) payload sets primary_provider_id to the order's provider
    expect(u.payload).toEqual({ primary_provider_id: TEST_PROVIDER_ID })

    // (b) scoped to this patient + this clinic
    const eqFilters = u.filters.filter((f) => f.method === 'eq')
    expect(eqFilters).toEqual(
      expect.arrayContaining([
        { method: 'eq', column: 'patient_id', value: TEST_PATIENT_ID },
        { method: 'eq', column: 'clinic_id',  value: TEST_CLINIC_ID },
      ]),
    )

    // (c) idempotency guard: .is('primary_provider_id', null). This is
    // the entire point — a second order from this patient with a
    // different provider must NOT overwrite the assignment. The DB
    // filter handles that for us; if a future refactor drops it, we
    // catch the regression here.
    const isFilters = u.filters.filter((f) => f.method === 'is')
    expect(isFilters).toEqual(
      expect.arrayContaining([
        { method: 'is', column: 'primary_provider_id', value: null },
      ]),
    )
  })

  it('a second order does not overwrite an existing assignment (the SQL filter is the contract)', async () => {
    // We can't observe the DB state across two requests from a unit
    // test, but we can confirm the request shape stays identical — the
    // .is('primary_provider_id', null) filter is what makes the second
    // call a no-op at the database tier. If a refactor switched the
    // logic to "always set," the chain shape would change (the .is
    // filter would be gone, or the payload would be conditional).
    const res1 = await POST(makeRequest(defaultBody()))
    expect(res1.status).toBe(201)

    // Second order: same patient, different provider. (The provider
    // FK / clinic match still has to resolve, so we keep the providerId
    // — the point is the UPDATE filter, not provider semantics.)
    const res2 = await POST(makeRequest(defaultBody()))
    expect(res2.status).toBe(201)

    const patientUpdates = updateCalls.filter((c) => c.table === 'patients')
    expect(patientUpdates).toHaveLength(2)

    for (const u of patientUpdates) {
      // Same payload both times — and the .is filter is what makes call
      // #2 a no-op against a patient whose primary_provider_id is now
      // non-NULL.
      expect(u.payload).toEqual({ primary_provider_id: TEST_PROVIDER_ID })
      expect(u.filters).toEqual(
        expect.arrayContaining([
          { method: 'is', column: 'primary_provider_id', value: null },
        ]),
      )
    }
  })

  it('order creation succeeds (201) when the auto-default UPDATE is a no-op', async () => {
    // The proxy's update terminal resolves to { data: null, error: null }
    // — same shape Supabase returns when the .is('primary_provider_id',
    // null) filter matches zero rows (i.e. patient already has a PCP).
    // The route's contract is: 201 either way. A regression that
    // throws on no-op update, or returns 500, would surface here.
    const res = await POST(makeRequest(defaultBody()))
    expect(res.status).toBe(201)

    const body = await res.json()
    expect(body).toEqual({ orderId: TEST_ORDER_ID })
  })
})
