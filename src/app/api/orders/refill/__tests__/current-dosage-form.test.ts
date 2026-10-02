/**
 * @jest-environment node
 *
 * A refill sizes the line with the formulation's CURRENT dosage form,
 * not the one frozen on the source order's snapshot.
 *
 * #183 moved six mL topicals from "Topical Gel" (dispensed in g) to
 * "Topical Solution" (dispensed in mL). An order written before that
 * carries form "Topical Gel" in its medication_snapshot. Read from the
 * snapshot, a 1 mL daily dose could not be counted in g, and the refill
 * took one 60 mL bottle for 90 days of 1 mL — the under-billing the
 * catalog correction was for. Read from the formulation, it is 90 mL:
 * 2 × 60 mL bottles.
 */

import { POST } from '../route'

const CLINIC   = 'c0000000-0000-4000-8000-000000000001'
const PATIENT  = 'p0000000-0000-4000-8000-000000000001'
const PHARMACY = 'ph000000-0000-4000-8000-000000000001'
const FORM     = 'f0000000-0000-4000-8000-00000000c0de'
const SOURCE   = '45e03578-e208-468d-a35b-ab9bc82320ae'

const getUserMock = jest.fn()
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockImplementation(async () => ({
    auth: { getUser: () => getUserMock() },
  })),
}))

let orderRows: Record<string, unknown>[] = []
let pharmacyFormulationRows: Record<string, unknown>[] = []
let formulationRows: Record<string, unknown>[] | null = []
let formulationError: { message: string } | null = null

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn().mockImplementation(() => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {}
      const result = () => {
        if (table === 'pharmacy_formulations') return { data: pharmacyFormulationRows, error: null }
        if (table === 'formulations') return { data: formulationError ? null : formulationRows, error: formulationError }
        return { data: chain['__refillCount'] ? [] : orderRows, error: null }
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

const PKGS = [
  { id: 'pkg-60',  package_label: '60 mL',  package_qty: 60,  package_unit: 'mL', wholesale_price: 24, is_default: true,  active: true },
  { id: 'pkg-120', package_label: '120 mL', package_qty: 120, package_unit: 'mL', wholesale_price: 40, is_default: false, active: true },
]

beforeEach(() => {
  getUserMock.mockReset()
  getUserMock.mockResolvedValue({ data: { user: { id: 'u1', user_metadata: { clinic_id: CLINIC } } } })
  formulationError = null
  // Written while the formulation was still "Topical Gel".
  orderRows = [{
    order_id: SOURCE, patient_id: PATIENT, provider_id: 'prov-1',
    formulation_id: FORM, catalog_item_id: null, pharmacy_id: PHARMACY,
    sig_text: 'Apply 1 mL topical once daily for 90 days', sig_mode: 'standard', titration_steps: [],
    cycle_on_days: null, cycle_off_days: null,
    quantity: 1, created_at: '2026-09-01T10:00:00.000Z',
    retail_price_snapshot: 36, wholesale_price_snapshot: 24,
    medication_snapshot: {
      medication_name: 'Minoxidil Topical Solution 5%', form: 'Topical Gel',
      prescribed_dose: '1 mL', frequency_code: 'QD', quantity_label: '60 mL',
      concentration_value: 5, concentration_unit: '%',
    },
    pharmacy_snapshot: { name: 'Strive Pharmacy' },
    package_id: 'pkg-60', package_label: '60 mL', package_count: 1,
    refills: 2, days_supply: 90, dispense_quantity: 60, dispense_unit: 'mL',
  }]
  pharmacyFormulationRows = [{
    pharmacy_id: PHARMACY, formulation_id: FORM, wholesale_price: 24,
    pharmacy_formulation_packages: PKGS,
    pharmacies: { name: 'Strive Pharmacy', is_active: true, deleted_at: null },
  }]
  // What the catalog says today (#183).
  formulationRows = [{
    formulation_id: FORM, concentration_value: 5, concentration_unit: '%',
    dosage_forms: { name: 'Topical Solution' },
  }]
})

const call = async () => {
  const res = await POST({ json: async () => ({ orderIds: [SOURCE] }) } as never)
  return { status: res.status, body: await res.json() as { lines?: Record<string, unknown>[]; error?: string } }
}

describe('a refill reads the formulation as it is today', () => {
  it('1 mL daily × 90 days of a topical now filed as Topical Solution: 90 mL, 2 × 60 mL at $48', async () => {
    const { status, body } = await call()
    expect(status).toBe(200)
    const line = body.lines![0]!
    const details = line['rxDetails'] as Record<string, unknown>
    expect(details['dispenseQuantity']).toBe(90)
    expect(details['dispenseUnit']).toBe('mL')
    expect(line['packageLabel']).toBe('60 mL')
    expect(line['packageCount']).toBe(2)
    expect(line['wholesaleCents']).toBe(4800)
    // The line carries today's form, so Review and the order snapshot agree with it.
    expect(line['form']).toBe('Topical Solution')
  })

  it('a formulation that can no longer be read falls back to the snapshot, never to nothing', async () => {
    formulationRows = []
    const { status, body } = await call()
    expect(status).toBe(200)
    expect(body.lines![0]!['form']).toBe('Topical Gel')
  })

  it('a read that FAILED is an error, not the snapshot — nothing is priced from a guess', async () => {
    formulationError = { message: 'connection reset' }
    const { status, body } = await call()
    expect(status).toBe(503)
    expect(body.error).toMatch(/could not be read/i)
  })
})
