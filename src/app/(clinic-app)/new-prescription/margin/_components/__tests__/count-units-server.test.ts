/**
 * @jest-environment node
 *
 * The server sizes suppository packs the way the price step does (#181
 * audit, group 3): a 10-pack against 30 suppositories is 3 packs, and a
 * line with no pack chosen is refused rather than priced as one.
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
    case 'pharmacy_formulation_packages': return { id: 'pkg-oxy-10', package_label: '10 supp', package_qty: 10, package_unit: 'supp', wholesale_price: 28, is_default: true, active: true }
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

const oxytocin = (over: Record<string, unknown>) => draftBody({
  formulationId: 'formulation-oxytocin', sigMode: 'standard', titrationSteps: [],
  sigText: 'Insert 400 units intravaginal once daily for 30 days', dose: '400 units', frequencyCode: 'QD',
  quantityLabel: '10 supp', retailCents: 15000,
  rxDetails: { ...(draftBody()['rxDetails'] as object), daysSupply: 30, dispenseQuantity: 30, dispenseUnit: 'suppository' },
  ...over,
})

beforeEach(() => {
  insertedRow = null
  formulationRow = {
    formulation_id: 'formulation-oxytocin', name: 'Oxytocin Vaginal Suppository 400IU', concentration: '400IU',
    concentration_value: 400, concentration_unit: 'units', dosage_forms: { name: 'Suppository' },
  }
})

describe('POST /api/orders counts suppository packs', () => {
  it('3 × 10 supp for 30 suppositories is priced as sent: $84', async () => {
    const res = await post(oxytocin({ packageId: 'pkg-oxy-10', packageCount: 3 }))
    expect(res.status).toBe(201)
    expect(insertedRow!['wholesale_price_snapshot']).toBe(84)
  })

  it('no pack chosen for 30 suppositories: refused — it needs 3 × 10 supp', async () => {
    const res = await post(oxytocin({ packageId: null, packageCount: null }))
    expect(res.status).toBe(422)
    const json = await res.json() as { code?: string; error?: string }
    expect(json.code).toBe('PACKAGE_REQUIRED')
    expect(json.error).toContain('3 × 10 supp')
  })
})
