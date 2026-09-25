/**
 * @jest-environment node
 *
 * Cycling dose math, the order round-trip: what POST /api/orders stores
 * for a cycling line, and what the reopen path (WO-98) gets back. The
 * real handler and the real builderStateFromOrder run; only Supabase is
 * faked.
 */

import { POST } from '@/app/api/orders/route'
import { builderStateFromOrder } from '@/lib/orders/draft-edit'
import { draftBody, CLINIC, PATIENT_ID, PROVIDER_ID } from './wo105-draft-titration-fixture'

let insertedRow: Record<string, unknown> | null = null

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
    case 'formulations': return {
      formulation_id: 'formulation-sema', name: 'Semaglutide 5mg/mL Injectable',
      concentration: '5mg/mL', dosage_forms: { name: 'Injectable Solution' },
    }
    case 'pharmacy_formulations': return { pharmacy_formulation_id: 'pf-1', wholesale_price: 95 }
    case 'pharmacies': return {
      pharmacy_id: 'pharmacy-strive', name: 'Strive Pharmacy', slug: 'strive',
      integration_tier: 'TIER_4_FAX', shipping_fee_standard: 9, shipping_fee_cold_chain: 22,
      free_shipping_threshold: null, is_active: true, deleted_at: null,
    }
    case 'pharmacy_formulation_packages': return { id: 'pkg-1', package_label: '1 mL vial', wholesale_price: 95 }
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

const CYCLING_SIG = 'Inject 10 units (0.10mL / 0.50mg) subcutaneous once daily, 5 days on / 2 days off, for 30 days then reassess'

const cyclingBody = (over: Record<string, unknown> = {}) => draftBody({
  sigText: CYCLING_SIG,
  frequencyCode: 'QD',
  sigMode: 'cycling',
  titrationSteps: [],
  cycleOnDays: 5,
  cycleOffDays: 2,
  rxDetails: { ...(draftBody()['rxDetails'] as object), daysSupply: 30, dispenseQuantity: 2.2 },
  ...over,
})

const post = (body: Record<string, unknown>) => POST({ json: async () => body } as never)

beforeEach(() => { insertedRow = null })

describe('a cycling line saved as an order', () => {
  it('stores the pattern beside the mode', async () => {
    const res = await post(cyclingBody())
    expect(res.status).toBe(201)
    expect(insertedRow!['sig_mode']).toBe('cycling')
    expect(insertedRow!['cycle_on_days']).toBe(5)
    expect(insertedRow!['cycle_off_days']).toBe(2)
    expect(insertedRow!['days_supply']).toBe(30)
    expect(insertedRow!['dispense_quantity']).toBe(2.2)
  })

  it('reopens as cycling with the same pattern and length', async () => {
    await post(cyclingBody())
    const reopened = builderStateFromOrder({
      formulation_id:      insertedRow!['formulation_id'] as string,
      pharmacy_id:         insertedRow!['pharmacy_id'] as string,
      sig_text:            insertedRow!['sig_text'] as string,
      refills:             0,
      medication_snapshot: insertedRow!['medication_snapshot'],
      sig_mode:            insertedRow!['sig_mode'] as string,
      titration_steps:     insertedRow!['titration_steps'],
      cycle_on_days:       insertedRow!['cycle_on_days'] as number,
      cycle_off_days:      insertedRow!['cycle_off_days'] as number,
      days_supply:         insertedRow!['days_supply'] as number,
    })
    expect(reopened.sigMode).toBe('cycling')
    expect(reopened.cycle).toEqual({ onDays: 5, offDays: 2, lengthDays: 30 })
  })

  it('a pattern on a line that is not cycling is dropped, never stored', async () => {
    await post(cyclingBody({ sigMode: 'standard' }))
    expect(insertedRow!['sig_mode']).toBe('standard')
    expect(insertedRow!['cycle_on_days']).toBeNull()
    expect(insertedRow!['cycle_off_days']).toBeNull()
  })

  it('a malformed pattern is refused: a cycling line is never stored as if it were daily', async () => {
    const res = await post(cyclingBody({ cycleOnDays: 0 }))
    expect(res.status).toBe(400)
    expect(insertedRow).toBeNull()
  })

  it('titration and standard bodies store exactly what they did', async () => {
    await post(draftBody())
    expect(insertedRow!['sig_mode']).toBe('titration')
    expect(insertedRow!['cycle_on_days']).toBeNull()
    await post(draftBody({ sigMode: 'standard', titrationSteps: [] }))
    expect(insertedRow!['sig_mode']).toBe('standard')
    expect(insertedRow!['cycle_off_days']).toBeNull()
  })
})
