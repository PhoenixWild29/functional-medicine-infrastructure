/**
 * @jest-environment node
 *
 * WO-101: POST /api/orders prices a line from the package (vial size)
 * the provider sent — server-side, never from the client's numbers.
 *
 *   - packageId of this pharmacy's formulation → wholesale = that
 *     package's price; orders.package_id / package_label set; the stored
 *     quantity (medication_snapshot.quantity_label) is the package label.
 *   - retail below the PACKAGE wholesale → 422.
 *   - packageId not offered for this pharmacy formulation → 400.
 *   - no packageId → today's pharmacy_formulations price, no package
 *     columns (existing clients unaffected).
 *
 * Harness copied from wo96-rx-details.test.ts.
 */

import { POST } from '../route'

const TEST_CLINIC_ID   = 'a1000000-0000-0000-0000-000000000001'
const TEST_PROVIDER_ID = 'a2000000-0000-0000-0000-000000000001'
const TEST_PATIENT_ID  = 'a3000000-0000-0000-0000-000000000001'
const TEST_PHARMACY_ID = 'a4000000-0000-0000-0000-000000000004'
const TEST_FORM_ID     = 'a7000000-0000-0000-0000-000000000001'
const TEST_ORDER_ID    = 'a6000000-0000-0000-0000-000000000001'
const TEST_PF_ID       = 'a8000000-0000-0000-0000-000000000001'
const PKG_2_5_ML       = 'a9000000-0000-0000-0000-000000000025'

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

describe('POST /api/orders — WO-101 package pricing', () => {
  it('prices from the chosen package and stores it on the order', async () => {
    fixtures['pharmacy_formulation_packages:maybeSingle'] = () => ({
      data: { id: PKG_2_5_ML, package_label: '2.5 mL vial', wholesale_price: 165 },
      error: null,
    })

    const res = await POST(makeRequest(formulationBody({
      retailCents:   33000,
      packageId:     PKG_2_5_ML,
      quantityLabel: '1 mL vial',   // stale client label — the package wins
      wholesaleCents: 1,            // ignored: not part of the contract
    })))
    expect(res.status).toBe(201)

    const row = orderInsert()
    expect(row).toEqual(expect.objectContaining({
      wholesale_price_snapshot: 165,
      retail_price_snapshot:    330,
      package_id:               PKG_2_5_ML,
      package_label:            '2.5 mL vial',
    }))
    expect(row['medication_snapshot']).toEqual(expect.objectContaining({
      wholesale_price: 165,
      quantity_label:  '2.5 mL vial',
      package_label:   '2.5 mL vial',
    }))
    // The package must belong to THIS pharmacy formulation and be active.
    expect(eqCalls.filter(c => c.table === 'pharmacy_formulation_packages')).toEqual([
      { table: 'pharmacy_formulation_packages', col: 'id', val: PKG_2_5_ML },
      { table: 'pharmacy_formulation_packages', col: 'pharmacy_formulation_id', val: TEST_PF_ID },
      { table: 'pharmacy_formulation_packages', col: 'active', val: true },
    ])
  })

  it('rejects retail below the package wholesale', async () => {
    fixtures['pharmacy_formulation_packages:maybeSingle'] = () => ({
      data: { id: PKG_2_5_ML, package_label: '2.5 mL vial', wholesale_price: 165 },
      error: null,
    })
    // $120 clears the default $95 price but not the 2.5 mL vial's $165.
    const res = await POST(makeRequest(formulationBody({ retailCents: 12000, packageId: PKG_2_5_ML })))
    expect(res.status).toBe(422)
    expect(insertedRows.find(r => r.table === 'orders')).toBeUndefined()
  })

  it('400 when the package is not offered for this pharmacy formulation', async () => {
    fixtures['pharmacy_formulation_packages:maybeSingle'] = () => ({ data: null, error: null })
    const res = await POST(makeRequest(formulationBody({ packageId: 'a9000000-0000-0000-0000-00000000ffff' })))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'Package is not offered by this pharmacy for this formulation' })
    expect(insertedRows.find(r => r.table === 'orders')).toBeUndefined()
  })

  it('no packageId → pharmacy formulation price, no package columns (existing clients unaffected)', async () => {
    const res = await POST(makeRequest(formulationBody({ quantityLabel: '5mL vial' })))
    expect(res.status).toBe(201)
    const row = orderInsert()
    expect(row).toEqual(expect.objectContaining({ wholesale_price_snapshot: 95, package_id: null, package_label: null }))
    expect(row['medication_snapshot']).toEqual(expect.objectContaining({ quantity_label: '5mL vial' }))
    expect(row['medication_snapshot']).not.toHaveProperty('package_label')
    expect(tablesTouched).not.toContain('pharmacy_formulation_packages')
  })

  it('packageId on a legacy catalog line → 400', async () => {
    const res = await POST(makeRequest({
      ...formulationBody({ packageId: PKG_2_5_ML }),
      formulationId: null,
      catalogItemId: 'a5000000-0000-0000-0000-000000000001',
    }))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'packageId applies to formulation lines only' })
  })
})
