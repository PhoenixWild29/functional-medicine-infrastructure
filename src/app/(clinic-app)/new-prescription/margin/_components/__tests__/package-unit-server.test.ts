/**
 * @jest-environment node
 *
 * The server refuses a package it cannot size (found on prod,
 * 2026-09-25). The client sends the package and a count; if the
 * package's unit cannot be converted to the line's dispense unit through
 * the formulation's concentration, POST /api/orders refuses the line
 * (422 PACKAGE_UNIT_MISMATCH) instead of storing a price for one package.
 */

import { POST } from '@/app/api/orders/route'
import { draftBody, CLINIC, PATIENT_ID, PROVIDER_ID } from './wo105-draft-titration-fixture'

let insertedRow: Record<string, unknown> | null = null
let formulationRow: Record<string, unknown> = {}

const AUTH_USER = { id: 'user-1', user_metadata: { clinic_id: CLINIC, app_role: 'medical_assistant' } }
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockImplementation(async () => ({
    auth: {
      getUser:    async () => ({ data: { user: AUTH_USER } }),
      getSession: async () => ({ data: { session: { user: AUTH_USER } } }),
    },
  })),
}))

function rowFor(table: string): Record<string, unknown> | null {
  switch (table) {
    case 'patients':  return { patient_id: PATIENT_ID, clinic_id: CLINIC, state: 'TX', first_name: 'Alex', last_name: 'Demo' }
    case 'providers': return { provider_id: PROVIDER_ID, clinic_id: CLINIC, npi_number: '1234567890', user_id: 'user-1' }
    case 'clinics':   return {
      clinic_id: CLINIC, markup_percentage: 100, name: 'Demo Clinic',
      stripe_connect_status: 'ACTIVE', stripe_connect_account_id: 'acct_test', absorb_shipping: false,
    }
    case 'formulations': return formulationRow
    case 'pharmacy_formulations': return { pharmacy_formulation_id: 'pf-1', wholesale_price: 95 }
    case 'pharmacies': return {
      pharmacy_id: 'pharmacy-strive', name: 'Strive Pharmacy', slug: 'strive',
      integration_tier: 'TIER_4_FAX', shipping_fee_standard: 9, shipping_fee_cold_chain: 22,
      free_shipping_threshold: null, is_active: true, deleted_at: null,
    }
    case 'pharmacy_formulation_packages': return { id: 'pkg-bpc-5', package_label: '5 mg vial', package_qty: 5, package_unit: 'mg', wholesale_price: 62, is_default: true, active: true }
    case 'pharmacy_state_licenses': return { pharmacy_id: 'pharmacy-strive' }
    default: return null
  }
}

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn().mockImplementation(() => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {}
      chain['select'] = () => chain
      chain['eq']     = () => chain
      chain['in']     = () => chain
      chain['is']     = () => chain
      chain['order']  = () => chain
      chain['limit']  = () => chain
      chain['maybeSingle'] = async () => ({ data: rowFor(table), error: null })
      chain['single']      = async () => ({ data: rowFor(table), error: null })
      chain['insert'] = (row: Record<string, unknown>) => {
        if (table === 'orders') insertedRow = row
        return { select: () => ({ single: async () => ({ data: { order_id: 'new-draft-1' }, error: null }) }) }
      }
      chain['update'] = () => chain
      chain['then'] = (resolve: (r: unknown) => unknown) => {
        const row = rowFor(table)
        return Promise.resolve({ data: row ? [row] : [], error: null }).then(resolve)
      }
      return chain
    },
  })),
}))

const post = (body: Record<string, unknown>) => POST({ json: async () => body } as never)

const bpcBody = (count: number) => draftBody({
  formulationId: 'formulation-bpc', sigMode: 'standard', titrationSteps: [],
  sigText: 'Inject 1mg (1.00mL) subcutaneous once daily for 30 days', dose: '1 mg', frequencyCode: 'QD',
  quantityLabel: '5 mg vial', packageId: 'pkg-bpc-5', packageCount: count, retailCents: 60000,
  rxDetails: { ...(draftBody()['rxDetails'] as object), daysSupply: 30, dispenseQuantity: 30, dispenseUnit: 'mL' },
})

beforeEach(() => {
  insertedRow = null
  formulationRow = {
    formulation_id: 'formulation-bpc', name: 'BPC-157 Injectable 5mg', concentration: '1mg/mL',
    concentration_value: 1, concentration_unit: 'mg/mL', dosage_forms: { name: 'Injectable Solution' },
  }
})

describe('POST /api/orders sizes the package against the dispense', () => {
  it('an mg vial with a concentration to convert with is priced as sent: 6 × $62', async () => {
    const res = await post(bpcBody(6))
    expect(res.status).toBe(201)
    expect(insertedRow!['wholesale_price_snapshot']).toBe(372)
    expect(insertedRow!['package_count']).toBe(6)
  })

  it('an mg vial with no concentration cannot be sized: refused, nothing stored', async () => {
    formulationRow = { ...formulationRow, concentration: null, concentration_value: null, concentration_unit: null }
    const res = await post(bpcBody(1))
    expect(res.status).toBe(422)
    const json = await res.json() as { code?: string; error?: string }
    expect(json.code).toBe('PACKAGE_UNIT_MISMATCH')
    expect(json.error).toContain('The 5 mg vial package is not measured in mL')
    expect(insertedRow).toBeNull()
  })
})

// A line that reaches Review with no package chosen (a protocol load)
// used to be priced as the pharmacy's default package, once, whatever
// its dispense. The server sizes it the same way the price step does.
describe('POST /api/orders with no package chosen', () => {
  const noPackage = (dispense: number) => draftBody({
    formulationId: 'formulation-bpc', sigMode: 'standard', titrationSteps: [],
    sigText: 'Inject 1mg (1.00mL) subcutaneous once daily for 30 days', dose: '1 mg', frequencyCode: 'QD',
    quantityLabel: null, packageId: null, packageCount: null, retailCents: 9580,
    rxDetails: { ...(draftBody()['rxDetails'] as object), daysSupply: 30, dispenseQuantity: dispense, dispenseUnit: 'mL' },
  })

  it('30 mL needs 6 × 5 mg vial: refused, not priced as one — the package must be chosen', async () => {
    const res = await post(noPackage(30))
    expect(res.status).toBe(422)
    const json = await res.json() as { code?: string; error?: string }
    expect(json.code).toBe('PACKAGE_REQUIRED')
    expect(json.error).toContain('6 × 5 mg vials')
    expect(insertedRow).toBeNull()
  })

  it('a package that cannot be sized: the same refusal as with a package', async () => {
    formulationRow = { ...formulationRow, concentration_value: null, concentration_unit: null }
    const res = await post(noPackage(30))
    expect(res.status).toBe(422)
    expect((await res.json() as { code?: string }).code).toBe('PACKAGE_UNIT_MISMATCH')
    expect(insertedRow).toBeNull()
  })

  it('one default vial that covers the dispense is priced as before', async () => {
    const res = await post(noPackage(5))
    expect(res.status).toBe(201)
    expect(insertedRow!['wholesale_price_snapshot']).toBe(95)   // pharmacy_formulations price, unchanged
  })
})
