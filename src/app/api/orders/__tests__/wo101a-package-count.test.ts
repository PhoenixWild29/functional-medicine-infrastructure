/**
 * @jest-environment node
 *
 * WO-101a: POST /api/orders prices a line as package price × packageCount,
 * server-side, and stores the count on the order.
 *
 *   - packageCount 2 of the 5 mL vial ($285) → wholesale $570, package_count 2
 *   - retail between one and two vials → 422 (priced from the count, not the client)
 *   - packageCount out of range / not an integer → 400
 *   - packageCount without a package → 400
 *   - no packageCount → 1 (WO-101 clients unchanged)
 *
 * Harness copied from wo101-packages.test.ts.
 */

import { POST } from '../route'

const TEST_CLINIC_ID   = 'a1000000-0000-0000-0000-000000000001'
const TEST_PROVIDER_ID = 'a2000000-0000-0000-0000-000000000001'
const TEST_PATIENT_ID  = 'a3000000-0000-0000-0000-000000000001'
const TEST_PHARMACY_ID = 'a4000000-0000-0000-0000-000000000004'
const TEST_FORM_ID     = 'a7000000-0000-0000-0000-000000000001'
const TEST_ORDER_ID    = 'a6000000-0000-0000-0000-000000000001'
const TEST_PF_ID       = 'a8000000-0000-0000-0000-000000000001'

type ChainBuilder = Record<string, unknown>

let insertedRows: Array<{ table: string; row: Record<string, unknown> }> = []
let tablesTouched: string[] = []
let eqCalls: Array<{ table: string; col: string; val: unknown }> = []

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
  builder['eq'] = (col: string, val: unknown) => {
    eqCalls.push({ table, col, val })
    return builder
  }
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
  fixtures['pharmacy_formulations:maybeSingle'] = () => ({ data: { pharmacy_formulation_id: TEST_PF_ID, wholesale_price: 95 }, error: null })
  fixtures['formulation_ingredients:await'] = () => ({ data: [{ ingredients: { dea_schedule: null } }], error: null })
  fixtures['pharmacies:maybeSingle'] = () => ({
    data: { pharmacy_id: TEST_PHARMACY_ID, name: 'Strive Pharmacy', integration_tier: 'TIER_1_API', fax_number: null, is_active: true, deleted_at: null },
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
  eqCalls = []
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

const PKG_5_ML = 'a9000000-0000-0000-0000-000000000050'

function fiveMlVial() {
  fixtures['pharmacy_formulation_packages:maybeSingle'] = () => ({
    data: { id: PKG_5_ML, package_label: '5 mL vial', wholesale_price: 285 },
    error: null,
  })
}

describe('POST /api/orders — WO-101a package count', () => {
  it('prices 2 × 5 mL vials at $570 and stores package_count 2', async () => {
    fiveMlVial()
    const res = await POST(makeRequest(formulationBody({
      retailCents:   79800,
      packageId:     PKG_5_ML,
      packageCount:  2,
      rxDetails:     { daysSupply: 90, dispenseQuantity: 9.6, dispenseUnit: 'mL' },
    })))
    expect(res.status).toBe(201)
    const row = orderInsert()
    expect(row).toEqual(expect.objectContaining({
      wholesale_price_snapshot: 570,
      retail_price_snapshot:    798,
      package_id:               PKG_5_ML,
      package_label:            '5 mL vial',
      package_count:            2,
      dispense_quantity:        9.6,
    }))
    expect(row['medication_snapshot']).toEqual(expect.objectContaining({
      wholesale_price: 570,
      quantity_label:  '5 mL vial',
      package_label:   '5 mL vial',
      package_count:   2,
    }))
  })

  it('retail that clears one vial but not two is rejected — the count prices it', async () => {
    fiveMlVial()
    const res = await POST(makeRequest(formulationBody({ retailCents: 40000, packageId: PKG_5_ML, packageCount: 2 })))
    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toEqual({ error: 'retail price must be >= wholesale ($570.00)' })
    expect(insertedRows.find(r => r.table === 'orders')).toBeUndefined()
  })

  it.each([0, 21, 1.5, '2', -1])('packageCount %p → 400 before any insert', async (packageCount) => {
    fiveMlVial()
    const res = await POST(makeRequest(formulationBody({ retailCents: 90000, packageId: PKG_5_ML, packageCount })))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'packageCount must be an integer between 1 and 20' })
    expect(insertedRows.find(r => r.table === 'orders')).toBeUndefined()
  })

  it('packageCount above 1 without a package → 400', async () => {
    const res = await POST(makeRequest(formulationBody({ retailCents: 90000, packageCount: 3 })))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'packageCount requires packageId' })
  })

  it('no packageCount → one package (WO-101 clients unchanged)', async () => {
    fiveMlVial()
    const res = await POST(makeRequest(formulationBody({ retailCents: 40000, packageId: PKG_5_ML })))
    expect(res.status).toBe(201)
    expect(orderInsert()).toEqual(expect.objectContaining({ wholesale_price_snapshot: 285, package_count: 1 }))
  })

  it('no package at all → package_count 1, pharmacy formulation price', async () => {
    const res = await POST(makeRequest(formulationBody()))
    expect(res.status).toBe(201)
    expect(orderInsert()).toEqual(expect.objectContaining({ wholesale_price_snapshot: 95, package_id: null, package_count: 1 }))
  })
})
