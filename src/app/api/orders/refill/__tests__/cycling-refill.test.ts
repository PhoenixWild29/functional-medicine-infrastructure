/**
 * @jest-environment node
 *
 * Cycling dose math on refill: a cycling order refills as a cycling
 * order, with the same pattern and the same quantity. An order written
 * before the pattern was stored never silently refills as daily dosing:
 * the line stops at the dose step with cycling selected and asks for
 * the days on and off, the old sig shown for reference.
 */

import { POST } from '../route'
import { refillLandingHref } from '@/app/(clinic-app)/new-prescription/_lib/reprice'
import type { SessionPrescription } from '@/app/(clinic-app)/new-prescription/_context/prescription-session'

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

let orderRows: Record<string, unknown>[] = []
let pharmacyFormulationRows: Record<string, unknown>[] = []

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn().mockImplementation(() => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {}
      const result = () => {
        if (table === 'pharmacy_formulations') return { data: pharmacyFormulationRows, error: null }
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

const CYCLING_SIG = 'Inject 10 units (0.10mL / 0.50mg) subcutaneous once daily, 5 days on / 2 days off, for 30 days then reassess'

function cyclingRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    order_id: SOURCE, patient_id: PATIENT, provider_id: 'prov-1',
    formulation_id: FORM, catalog_item_id: null, pharmacy_id: PHARMACY,
    sig_text: CYCLING_SIG, sig_mode: 'cycling', titration_steps: [],
    cycle_on_days: 5, cycle_off_days: 2,
    quantity: 1, created_at: '2026-09-01T10:00:00.000Z',
    retail_price_snapshot: 240, wholesale_price_snapshot: 120,
    medication_snapshot: {
      medication_name: 'Semaglutide', form: 'Injectable Solution',
      prescribed_dose: '10 units', frequency_code: 'QD', quantity_label: '2.5 mL vial',
      concentration_value: 5, concentration_unit: 'mg/mL',
      route: { name: 'Subcutaneous', sig_prefix: 'Inject' },
    },
    pharmacy_snapshot: { name: 'Strive Pharmacy' },
    package_id: 'pkg-2.5', package_label: '2.5 mL vial', package_count: 1,
    refills: 2, days_supply: 30, dispense_quantity: 2.2, dispense_unit: 'mL',
    ...over,
  }
}

const PKGS = [
  { id: 'pkg-1',   package_label: '1 mL vial',   package_qty: 1,   package_unit: 'mL', wholesale_price: 60,  is_default: false, active: true },
  { id: 'pkg-2.5', package_label: '2.5 mL vial', package_qty: 2.5, package_unit: 'mL', wholesale_price: 120, is_default: false, active: true },
  { id: 'pkg-5',   package_label: '5 mL vial',   package_qty: 5,   package_unit: 'mL', wholesale_price: 200, is_default: true,  active: true },
]

function packagesRow(packages: Record<string, unknown>[]): Record<string, unknown> {
  return {
    pharmacy_id: PHARMACY, formulation_id: FORM, wholesale_price: 200,
    pharmacy_formulation_packages: packages,
    pharmacies: { name: 'Strive Pharmacy', is_active: true, deleted_at: null },
  }
}

const call = async () => {
  const res = await POST({ json: async () => ({ orderIds: [SOURCE] }) } as never)
  return { status: res.status, body: await res.json() as { lines: Record<string, unknown>[] } }
}

beforeEach(() => {
  getUserMock.mockReset()
  getUserMock.mockResolvedValue({ data: { user: { id: 'u1', user_metadata: { clinic_id: CLINIC } } } })
  orderRows = [cyclingRow()]
  pharmacyFormulationRows = [packagesRow(PKGS)]
})

describe('a cycling refill recomputes the same quantity', () => {
  it('stays cycling, keeps the pattern, and dispenses 22 doses — 2.2 mL over 30 days', async () => {
    const { status, body } = await call()
    expect(status).toBe(200)
    const line = body.lines[0]!
    expect(line['sigMode']).toBe('cycling')
    expect(line['cycle']).toEqual({ onDays: 5, offDays: 2, lengthDays: 30 })
    expect(line['cyclePatternRequired']).toBe(false)
    expect(line['sigText']).toBe(CYCLING_SIG)
    const details = line['rxDetails'] as Record<string, unknown>
    expect(details['dispenseQuantity']).toBe(2.2)
    expect(details['daysSupply']).toBe(30)
  })

  it('a package that is gone is re-suggested from the cycling quantity — 2.5 mL, not the daily 5 mL', async () => {
    pharmacyFormulationRows = [packagesRow(PKGS.filter(p => p.id !== 'pkg-2.5').concat([{ ...PKGS[1]!, id: 'pkg-2.5-new' }]))]
    const line = (await call()).body.lines[0]!
    expect(line['packageLabel']).toBe('2.5 mL vial')
    expect(line['packageCount']).toBe(1)
  })
})

describe('an old cycling order with no stored pattern', () => {
  beforeEach(() => {
    // Written before 2026-09-24: pattern only in the sig, quantity sized daily.
    orderRows = [cyclingRow({ cycle_on_days: null, cycle_off_days: null, dispense_quantity: 3, package_id: 'pkg-5', package_label: '5 mL vial', wholesale_price_snapshot: 200, retail_price_snapshot: 400 })]
  })

  it('never refills as daily dosing: it stays cycling, carries no pattern, and says a decision is owed', async () => {
    const line = (await call()).body.lines[0]!
    expect(line['sigMode']).toBe('cycling')
    expect(line['cycle']).toBeNull()
    expect(line['cyclePatternRequired']).toBe(true)
    // The old sig travels for reference; it is not parsed into a pattern.
    expect(line['sigText']).toBe(CYCLING_SIG)
  })

  it('lands on the dose step for that line, before any price step or Review', () => {
    const base = { pharmacyId: PHARMACY, pharmacyName: 'Strive', itemId: null, formulationId: FORM, medicationName: 'Semaglutide', form: 'Injectable Solution', dose: '10 units', wholesaleCents: 20000, retailCents: 40000, sigText: CYCLING_SIG, deaSchedule: null } as Omit<SessionPrescription, 'id'>
    const lines = [
      { ...base, id: 'line-ok', sigMode: 'standard', repriceRequired: true },
      { ...base, id: 'line-old', sigMode: 'cycling', cycle: null, cyclePatternRequired: true, repriceRequired: true },
    ] as SessionPrescription[]
    expect(refillLandingHref(lines)).toBe('/new-prescription/search?editId=line-old')
    // Nothing owed at the dose step: the price step, as before.
    expect(refillLandingHref([lines[0]!])).toMatch(/^\/new-prescription\/margin\?.*editId=line-ok/)
    expect(refillLandingHref([{ ...lines[0]!, repriceRequired: false }])).toBe('/new-prescription/review')
  })
})

// Package units vs dispense units (prod, 2026-09-25): a BPC-157 order
// priced as one 5 mg vial for 30 mL refills as the 6 vials it needs.
describe('a refill of an mg-vial line is re-counted in mL', () => {
  const BPC_PKG = { id: 'pkg-bpc-5', package_label: '5 mg vial', package_qty: 5, package_unit: 'mg', wholesale_price: 62, is_default: true, active: true }
  beforeEach(() => {
    orderRows = [cyclingRow({
      sig_text: 'Inject 1mg (1.00mL) subcutaneous once daily, 5 days on / 2 days off, for 6 weeks then reassess',
      medication_snapshot: {
        medication_name: 'BPC-157 Injectable 5mg', form: 'Injectable Solution',
        prescribed_dose: '1 mg', frequency_code: 'QD', quantity_label: '5 mg vial',
        concentration_value: 1, concentration_unit: 'mg/mL',
      },
      package_id: 'pkg-bpc-5', package_label: '5 mg vial', package_count: 1,
      days_supply: 42, dispense_quantity: 30, wholesale_price_snapshot: 62, retail_price_snapshot: 95.8,
    })]
    pharmacyFormulationRows = [packagesRow([BPC_PKG])]
  })

  it('6 × 5 mg vial, $372 wholesale — the source\'s single vial is not carried forward', async () => {
    const line = (await call()).body.lines[0]!
    expect((line['rxDetails'] as Record<string, unknown>)['dispenseQuantity']).toBe(30)
    expect(line['packageCount']).toBe(6)
    expect(line['wholesaleCents']).toBe(37200)
    // The price moved against the source, so the provider confirms it.
    expect(line['repriceRequired']).toBe(true)
  })
})
