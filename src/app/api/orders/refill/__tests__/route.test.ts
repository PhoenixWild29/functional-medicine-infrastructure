/**
 * @jest-environment node
 *
 * WO-106: POST /api/orders/refill — what the server decides for the
 * provider, and shows them.
 *
 * The three hard cases from the WO-106 report are pinned here:
 *   - a titration refills at its MAINTENANCE dose, not by repeating the
 *     ramp (the WO-105 overshoot in reverse);
 *   - a multi-vial line is re-priced against today's ACTIVE packages and
 *     the delta is reported, never applied silently;
 *   - a refill is blocked when the DERIVED count has reached the
 *     source's authorized refills.
 */

import { POST } from '../route'

const CLINIC   = 'c0000000-0000-4000-8000-000000000001'
const PATIENT  = 'p0000000-0000-4000-8000-000000000001'
const PHARMACY = 'ph000000-0000-4000-8000-000000000001'
const FORM     = 'f0000000-0000-4000-8000-000000000001'
const SOURCE   = '45e03578-e208-468d-a35b-ab9bc82320ae'
const SOURCE_2 = '55e03578-e208-468d-a35b-ab9bc82320af'

const getUserMock = jest.fn()
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockImplementation(async () => ({
    auth: { getUser: () => getUserMock() },
  })),
}))

/** Rows the mocked service client returns, per table. */
let orderRows: Record<string, unknown>[] = []
let refillRows: Record<string, unknown>[] = []
let pharmacyFormulationRows: Record<string, unknown>[] = []

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn().mockImplementation(() => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {}
      const result = () => {
        if (table === 'pharmacy_formulations') return { data: pharmacyFormulationRows, error: null }
        // orders: the refill-count query filters on refill_of_order_id.
        return { data: chain['__refillCount'] ? refillRows : orderRows, error: null }
      }
      chain['select'] = () => chain
      chain['in']     = (col: string) => { if (col === 'refill_of_order_id') chain['__refillCount'] = true; return chain }
      chain['eq']     = (col: string) => { if (col === 'refill_of_order_id') chain['__refillCount'] = true; return chain }
      chain['is']     = () => chain
      chain['then']   = (resolve: (r: unknown) => unknown) => Promise.resolve(result()).then(resolve)
      return chain
    },
  })),
}))

const TITRATION_STEPS = [
  { dose: '10', unit: 'units', frequency: 'QW', weeks: 4 },
  { dose: '20', unit: 'units', frequency: 'QW', weeks: 4 },
  { dose: '40', unit: 'units', frequency: 'QW', weeks: 4 },
]

function orderRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    order_id: SOURCE, patient_id: PATIENT, provider_id: 'prov-1',
    formulation_id: FORM, catalog_item_id: null, pharmacy_id: PHARMACY,
    sig_text: 'Inject 40 units subcutaneous once weekly', sig_mode: 'standard', titration_steps: [],
    quantity: 1, created_at: '2026-08-12T10:00:00.000Z',
    retail_price_snapshot: 231, wholesale_price_snapshot: 285,
    medication_snapshot: {
      medication_name: 'Semaglutide', form: 'Injectable Solution',
      prescribed_dose: '40 units', frequency_code: 'QW', quantity_label: '5 mL vial',
      concentration_value: 5, concentration_unit: 'mg/mL',
      route: { name: 'Subcutaneous', sig_prefix: 'Inject' },
    },
    pharmacy_snapshot: { name: 'Strive Pharmacy' },
    package_id: 'pkg-5ml', package_label: '5 mL vial', package_count: 2,
    refills: 2, days_supply: 90, dispense_quantity: 9.6, dispense_unit: 'mL',
    ...over,
  }
}

function packagesRow(packages: Record<string, unknown>[]): Record<string, unknown> {
  return {
    pharmacy_id: PHARMACY, formulation_id: FORM, wholesale_price: 95,
    pharmacy_formulation_packages: packages,
  }
}

const PKG_5ML = { id: 'pkg-5ml', package_label: '5 mL vial', package_qty: 5, package_unit: 'mL', wholesale_price: 285, is_default: true, active: true }

const call = (orderIds: string[]) =>
  POST({ json: async () => ({ orderIds }) } as never)

beforeEach(() => {
  getUserMock.mockReset()
  getUserMock.mockResolvedValue({ data: { user: { id: 'u1', user_metadata: { clinic_id: CLINIC } } } })
  orderRows = [orderRow()]
  refillRows = []
  pharmacyFormulationRows = [packagesRow([PKG_5ML])]
})

describe('a titration refills at its maintenance dose', () => {
  it('uses the final step, drops the schedule, and says why', async () => {
    orderRows = [orderRow({
      sig_mode: 'titration',
      titration_steps: TITRATION_STEPS,
      sig_text: 'Weeks 1–4: inject 10 units subcutaneous once weekly. … Total dispense 2.8 mL over 84 days.',
      medication_snapshot: { ...(orderRow().medication_snapshot as object), prescribed_dose: '10 units' },
    })]

    const res = await call([SOURCE])
    expect(res.status).toBe(200)
    const body = await res.json() as { lines: Record<string, unknown>[] }
    const line = body.lines[0]!

    // 40 units, not the 10 the ramp started at.
    expect(line['dose']).toBe('40 units')
    expect(line['frequencyCode']).toBe('QW')
    expect(line['sigMode']).toBe('standard')
    expect(line['titrationSteps']).toEqual([])
    expect(line['maintenanceNote']).toBe(
      'Refilling at the maintenance dose, 40 units once weekly. Change it if the patient is still titrating.',
    )
    // The sig is regenerated from the maintenance dose, not carried over.
    expect(String(line['sigText'])).toContain('40 units')
    expect(String(line['sigText'])).not.toContain('Weeks 1')
  })

  it('a standard order refills as itself, with no maintenance note', async () => {
    const body = await (await call([SOURCE])).json() as { lines: Record<string, unknown>[] }
    expect(body.lines[0]!['dose']).toBe('40 units')
    expect(body.lines[0]!['maintenanceNote']).toBeNull()
  })
})

describe('a multi-vial line is re-priced against today, and the move is reported', () => {
  it('reports the new price and the old one when the package price moved', async () => {
    pharmacyFormulationRows = [packagesRow([{ ...PKG_5ML, wholesale_price: 310 }])]

    const body = await (await call([SOURCE])).json() as { lines: Record<string, unknown>[] }
    const line = body.lines[0]!
    // 2 × 5 mL vial at today's 310.00 = 620.00, against the order's 285.00.
    expect(line['packageId']).toBe('pkg-5ml')
    expect(line['packageCount']).toBe(2)
    expect(line['wholesaleCents']).toBe(62000)
    expect(String(line['priceNote'])).toContain('2 × 5 mL vial')
    expect(String(line['priceNote'])).toContain('was $285.00')
  })

  it('says nothing when the price has not moved', async () => {
    // Source wholesale 285 = 1 x 285; count 1 so the totals match.
    orderRows = [orderRow({ package_count: 1 })]
    const body = await (await call([SOURCE])).json() as { lines: Record<string, unknown>[] }
    expect(body.lines[0]!['priceNote']).toBeNull()
  })

  it('a package the pharmacy no longer prices is replaced, and the swap is visible', async () => {
    pharmacyFormulationRows = [packagesRow([
      { id: 'pkg-25ml', package_label: '2.5 mL vial', package_qty: 2.5, package_unit: 'mL', wholesale_price: 165, is_default: true, active: true },
    ])]

    const body = await (await call([SOURCE])).json() as { lines: Record<string, unknown>[] }
    const line = body.lines[0]!
    expect(line['packageId']).toBe('pkg-25ml')
    expect(String(line['priceNote'])).toContain('no longer prices the size on the original order')
    // It never resends the stale id and lets the server reject it.
    expect(line['packageId']).not.toBe('pkg-5ml')
  })
})

describe('a refill is blocked when the authorization is used up', () => {
  it('409s when the derived count has reached the source refills', async () => {
    refillRows = [
      { order_id: 'r1', status: 'DELIVERED',  refill_of_order_id: SOURCE },
      { order_id: 'r2', status: 'SHIPPED',    refill_of_order_id: SOURCE },
    ]
    const res = await call([SOURCE])
    expect(res.status).toBe(409)
    const body = await res.json() as { error: string; blocked: { orderId: string; used: number; authorized: number }[] }
    expect(body.error).toBe('All 2 authorized refills have been used. Write a new prescription.')
    expect(body.blocked).toEqual([{ orderId: SOURCE, used: 2, authorized: 2 }])
  })

  it('a cancelled refill does not consume the authorization', async () => {
    refillRows = [
      { order_id: 'r1', status: 'DELIVERED', refill_of_order_id: SOURCE },
      { order_id: 'r2', status: 'CANCELLED', refill_of_order_id: SOURCE },
    ]
    const res = await call([SOURCE])
    expect(res.status).toBe(200)
  })

  it('an order that authorized none is blocked from the start', async () => {
    orderRows = [orderRow({ refills: 0 })]
    const res = await call([SOURCE])
    expect(res.status).toBe(409)
    expect((await res.json() as { error: string }).error)
      .toBe('This prescription authorized no refills. Write a new prescription.')
  })
})

describe('guards', () => {
  it('401 without a verified user; 400 without clinic_id', async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: null } })
    expect((await call([SOURCE])).status).toBe(401)
    getUserMock.mockResolvedValueOnce({ data: { user: { id: 'u1', user_metadata: {} } } })
    expect((await call([SOURCE])).status).toBe(400)
  })

  it('400 with no orders, 404 when one is not this clinic\'s', async () => {
    expect((await call([])).status).toBe(400)
    // Two asked for, one returned by the clinic-scoped query.
    expect((await call([SOURCE, SOURCE_2])).status).toBe(404)
  })

  it('400 when the orders belong to different patients — one session, one patient', async () => {
    orderRows = [orderRow(), orderRow({ order_id: SOURCE_2, patient_id: 'other-patient' })]
    const res = await call([SOURCE, SOURCE_2])
    expect(res.status).toBe(400)
    expect((await res.json() as { error: string }).error).toBe('All orders must be for the same patient')
  })

  it('several orders for one patient come back as several lines, each pointing at its source', async () => {
    orderRows = [orderRow(), orderRow({ order_id: SOURCE_2 })]
    const body = await (await call([SOURCE, SOURCE_2])).json() as { patientId: string; lines: Record<string, unknown>[] }
    expect(body.patientId).toBe(PATIENT)
    expect(body.lines.map(l => l['refillOfOrderId'])).toEqual([SOURCE, SOURCE_2])
  })
})
