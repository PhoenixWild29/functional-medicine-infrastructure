/**
 * @jest-environment node
 *
 * A protocol line whose titration lives only in its directions refills
 * sized like the protocol (#191): Mold/MCAS LDN, 0.1 mL at bedtime up
 * 0.1 mL every 3-4 days to 0.5 mL, over 56 days, is 25 mL. Refill used to
 * size the starting dose for every day: 0.1 mL x 56 = 5.6 mL.
 */

import { POST } from '../route'

const CLINIC   = 'c0000000-0000-4000-8000-000000000001'
const PATIENT  = 'p0000000-0000-4000-8000-000000000001'
const PHARMACY = 'ph000000-0000-4000-8000-000000000001'
const FORM     = 'f0000000-0000-4000-8000-000000000001'
const SOURCE   = '45e03578-e208-468d-a35b-ab9bc82320ae'

const getUserMock = jest.fn()
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockImplementation(async () => ({
    auth: { getUser: () => getUserMock() },
  })),
}))
jest.mock('@/lib/audit/phi-access', () => ({ logPhiAccess: jest.fn(async () => {}) }))

let orderRows: Record<string, unknown>[] = []
let pharmacyFormulationRows: Record<string, unknown>[] = []

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn().mockImplementation(() => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {}
      const result = () => {
        if (table === 'pharmacy_formulations') return { data: pharmacyFormulationRows, error: null }
        if (table === 'formulations') return { data: [], error: null }
        return { data: chain['__refillCount'] ? [] : orderRows, error: null }
      }
      chain['select'] = () => chain
      chain['in']     = (col: string) => { if (col === 'refill_of_order_id') chain['__refillCount'] = true; return chain }
      chain['eq']     = () => chain
      chain['is']     = () => chain
      chain['then']   = (resolve: (r: unknown) => unknown) => Promise.resolve(result()).then(resolve)
      return chain
    },
  })),
}))

const LDN_SIG = 'Take 0.1mL by mouth at bedtime. Titrate up by 0.1mL every 3-4 days as tolerated up to 0.5mL (0.5mg)'

function ldnRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    order_id: SOURCE, patient_id: PATIENT, provider_id: 'prov-1',
    formulation_id: FORM, catalog_item_id: null, pharmacy_id: PHARMACY,
    sig_text: LDN_SIG, sig_mode: 'standard', titration_steps: null,
    cycle_on_days: null, cycle_off_days: null,
    quantity: 1, created_at: '2026-09-01T10:00:00.000Z',
    retail_price_snapshot: 90, wholesale_price_snapshot: 45,
    medication_snapshot: {
      medication_name: 'Naltrexone (LDN) Oral Solution', form: 'Oral Solution',
      prescribed_dose: '0.1 mL', frequency_code: 'QHS', quantity_label: '30 mL bottle',
      concentration_value: 1, concentration_unit: 'mg/mL',
      route: { name: 'Oral', sig_prefix: 'Take' },
    },
    pharmacy_snapshot: { name: 'Strive Pharmacy' },
    package_id: 'pkg-30', package_label: '30 mL bottle', package_count: 1,
    refills: 2, days_supply: 56, dispense_quantity: 25, dispense_unit: 'mL',
    ...over,
  }
}

const PKGS = [
  { id: 'pkg-30', package_label: '30 mL bottle', package_qty: 30, package_unit: 'mL', wholesale_price: 45, is_default: true, active: true },
]

const call = async () => {
  const res = await POST({ json: async () => ({ orderIds: [SOURCE] }), headers: new Headers() } as never)
  return { status: res.status, body: await res.json() as { lines: Record<string, unknown>[] } }
}

beforeEach(() => {
  getUserMock.mockReset()
  getUserMock.mockResolvedValue({ data: { user: { id: 'u1', app_metadata: { clinic_id: CLINIC } } } })
  orderRows = [ldnRow()]
  pharmacyFormulationRows = [{
    pharmacy_id: PHARMACY, formulation_id: FORM, wholesale_price: 45,
    pharmacy_formulation_packages: PKGS,
    pharmacies: { name: 'Strive Pharmacy', is_active: true, deleted_at: null },
  }]
})

it('LDN refills at 25 mL over 56 days, sized for the titration in its directions (not 5.6 mL)', async () => {
  const { status, body } = await call()
  expect(status).toBe(200)
  const line = body.lines[0]!
  const details = line['rxDetails'] as Record<string, unknown>
  expect(details['dispenseQuantity']).toBe(25)
  expect(details['dispenseUnit']).toBe('mL')
  expect(details['daysSupply']).toBe(56)
  expect(line['packageLabel']).toBe('30 mL bottle')
  expect(line['packageCount']).toBe(1)
})

it('carries the length and the sizing assumption, so Review sizes it the same way and says why', async () => {
  const line = (await call()).body.lines[0]!
  expect(line['protocolDurationDays']).toBe(56)
  expect(line['sizingNote']).toEqual(expect.stringContaining('Quantity sized for the titration in the directions'))
  expect(line['sigText']).toBe(LDN_SIG)
})

it('a plain daily line is unchanged: sized from its dose and frequency', async () => {
  orderRows = [ldnRow({ sig_text: 'Take 0.5mL by mouth at bedtime.', medication_snapshot: { ...(ldnRow()['medication_snapshot'] as object), prescribed_dose: '0.5 mL' }, days_supply: 30 })]
  const line = (await call()).body.lines[0]!
  const details = line['rxDetails'] as Record<string, unknown>
  expect(details['dispenseQuantity']).toBe(15)
  expect(line['sizingNote'] ?? null).toBeNull()
})
