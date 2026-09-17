/**
 * @jest-environment node
 *
 * WO-105 data loss, second half: what the server does with the body the
 * price step sends, and what comes back when the draft is reopened.
 *
 * The real POST /api/orders handler runs here, and the real
 * builderStateFromOrder reads the row it produced. Only Supabase is
 * faked — it is the one thing a unit test cannot run. The body comes
 * from the shared fixture, which the companion jsdom test asserts is
 * byte-for-byte what the form actually sends.
 */

import { POST } from '@/app/api/orders/route'
import { builderStateFromOrder } from '@/lib/orders/draft-edit'
import { draftBody, STEPS, STANDARD_SIG, CLINIC, PATIENT_ID, PROVIDER_ID } from './wo105-draft-titration-fixture'

let insertedRow: Record<string, unknown> | null = null

const AUTH_USER = { id: 'user-1', user_metadata: { clinic_id: CLINIC, app_role: 'medical_assistant' } }
// POST /api/orders still gates on getSession() (pre-WO-96 code, not
// touched by this fix), so the fake provides both.
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockImplementation(async () => ({
    auth: {
      getUser:    async () => ({ data: { user: AUTH_USER } }),
      getSession: async () => ({ data: { session: { user: AUTH_USER } } }),
    },
  })),
}))

// The rows the route and resolveLine read, shaped like their selects.
function rowFor(table: string): Record<string, unknown> | null {
  switch (table) {
    case 'patients':  return { patient_id: PATIENT_ID, clinic_id: CLINIC, state: 'TX', first_name: 'Alex', last_name: 'Demo' }
    case 'providers': return { provider_id: PROVIDER_ID, clinic_id: CLINIC, npi_number: '1234567890', user_id: 'user-1' }
    // Stripe onboarding complete, or the route blocks intake (422).
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
      free_shipping_threshold: null,
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
      // update(...).eq(...).eq(...).is(...) — chainable and awaitable at
      // any depth, like the real builder.
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

beforeEach(() => { insertedRow = null })

describe('a titration saved as a draft from the price step', () => {
  it('stores the mode and the steps on the order', async () => {
    const res = await post(draftBody())
    expect(res.status).toBe(201)

    expect(insertedRow).not.toBeNull()
    expect(insertedRow!['status']).toBe('DRAFT')
    expect(insertedRow!['sig_mode']).toBe('titration')
    expect(insertedRow!['titration_steps']).toEqual(STEPS)
  })

  it('reopens as a titration with the same steps', async () => {
    await post(draftBody())

    // The same function load-draft-context hands the builder on reopen.
    const reopened = builderStateFromOrder({
      formulation_id:      insertedRow!['formulation_id'] as string,
      pharmacy_id:         insertedRow!['pharmacy_id'] as string,
      sig_text:            insertedRow!['sig_text'] as string,
      refills:             0,
      medication_snapshot: insertedRow!['medication_snapshot'],
      sig_mode:            insertedRow!['sig_mode'] as string,
      titration_steps:     insertedRow!['titration_steps'],
    })

    expect(reopened.sigMode).toBe('titration')
    // Same values, not just the same shape.
    expect(reopened.titrationSteps).toEqual(STEPS)
    expect(reopened.titrationSteps.map(s => `${s.dose}${s.unit}/${s.frequency}/${s.weeks}w`))
      .toEqual(['10units/QW/4w', '20units/QW/4w', '40units/QW/4w'])
  })

  it('without the fields — the body as it was before this fix — the schedule is gone', async () => {
    // What the old hand-written body produced: a titration that reopens
    // as a standard line. This is the regression, pinned.
    const withoutTitration = draftBody()
    delete withoutTitration['sigMode']
    delete withoutTitration['titrationSteps']
    await post(withoutTitration)

    expect(insertedRow!['sig_mode']).toBe('standard')
    expect(insertedRow!['titration_steps']).toEqual([])

    const reopened = builderStateFromOrder({
      formulation_id:      insertedRow!['formulation_id'] as string,
      pharmacy_id:         insertedRow!['pharmacy_id'] as string,
      sig_text:            insertedRow!['sig_text'] as string,
      refills:             0,
      medication_snapshot: insertedRow!['medication_snapshot'],
      sig_mode:            insertedRow!['sig_mode'] as string,
      titration_steps:     insertedRow!['titration_steps'],
    })
    expect(reopened.sigMode).toBe('standard')
    expect(reopened.titrationSteps).toEqual([])
  })

  it('a standard line still saves as standard with no steps', async () => {
    await post(draftBody({ sigMode: 'standard', titrationSteps: [], sigText: STANDARD_SIG }))
    expect(insertedRow!['sig_mode']).toBe('standard')
    expect(insertedRow!['titration_steps']).toEqual([])
  })
})
