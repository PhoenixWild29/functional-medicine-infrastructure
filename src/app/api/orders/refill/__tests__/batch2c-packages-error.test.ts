/**
 * @jest-environment node
 *
 * Batch 2, PR C: the WO-108 price interrupt cannot be skipped by a
 * failed read.
 *
 * /api/orders/refill read today's package prices as `{ data }` with the
 * error discarded. On failure there were no packages, the line fell back
 * to the source order's wholesale, repriceRequired came out FALSE — and
 * the refill went straight to Review as if the price had not moved. The
 * interrupt WO-108 exists for was skipped exactly when we could not see
 * the price.
 *
 * A read that fails now refuses the refill (503) instead of guessing.
 */

import { POST } from '../route'

const CLINIC  = 'c0000000-0000-4000-8000-000000000001'
const SOURCE  = '45e03578-e208-468d-a35b-ab9bc82320ae'

const getUserMock = jest.fn()
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockImplementation(async () => ({ auth: { getUser: () => getUserMock() } })),
}))

let packagesResult: { data: unknown; error: unknown } = { data: [], error: null }

const SOURCE_ROW = {
  order_id: SOURCE, patient_id: 'p-1', provider_id: 'prov-1',
  formulation_id: 'f-1', catalog_item_id: null, pharmacy_id: 'ph-1',
  sig_text: 'Inject 10 units subcutaneous once weekly', sig_mode: 'standard', titration_steps: [],
  quantity: 1, created_at: '2026-08-12T10:00:00.000Z',
  retail_price_snapshot: 150, wholesale_price_snapshot: 100,
  medication_snapshot: {
    medication_name: 'Semaglutide', form: 'Injectable Solution',
    prescribed_dose: '10 units', frequency_code: 'QW', quantity_label: '5 mL vial',
    concentration_value: 5, concentration_unit: 'mg/mL',
  },
  pharmacy_snapshot: { name: 'Strive Pharmacy' },
  package_id: 'pkg-5ml', package_label: '5 mL vial', package_count: 1,
  refills: 2, days_supply: 28, dispense_quantity: 0.4, dispense_unit: 'mL',
}

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn().mockImplementation(() => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {}
      const result = () => {
        if (table === 'pharmacy_formulations') return packagesResult
        return { data: chain['__refillCount'] ? [] : [SOURCE_ROW], error: null }
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

const call = () => POST({ json: async () => ({ orderIds: [SOURCE] }) } as never)

const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

beforeEach(() => {
  getUserMock.mockReset().mockResolvedValue({ data: { user: { id: 'u1', user_metadata: { clinic_id: CLINIC } } } })
  errorSpy.mockClear()
})

describe('refill — today\'s package prices cannot be read', () => {
  it('refuses the refill (503) instead of treating the price as unchanged', async () => {
    packagesResult = { data: null, error: { message: 'connection reset', code: '08006' } }

    const res = await call()
    const body = await res.json() as { lines?: unknown[]; error?: string }

    expect(res.status).toBe(503)
    expect(body.lines).toBeUndefined()
    expect(body.error).toMatch(/price/i)
  })

  it('logs it with the [refill] prefix', async () => {
    packagesResult = { data: null, error: { message: 'connection reset', code: '08006' } }

    await call()

    expect(errorSpy.mock.calls.some(c => String(c[0]).includes('[refill]'))).toBe(true)
  })

  it('still refills when the prices read cleanly', async () => {
    packagesResult = {
      data: [{
        pharmacy_id: 'ph-1', formulation_id: 'f-1', wholesale_price: 120,
        pharmacies: { name: 'Strive Pharmacy', is_active: true, deleted_at: null },
        pharmacy_formulation_packages: [
          { id: 'pkg-5ml', package_label: '5 mL vial', package_qty: 5, package_unit: 'mL', wholesale_price: 120, is_default: true, active: true },
        ],
      }],
      error: null,
    }

    const res = await call()
    const body = await res.json() as { lines: { repriceRequired: boolean }[] }

    expect(res.status).toBe(200)
    // $100 then, $120 now: the interrupt fires, as WO-108 intends.
    expect(body.lines[0]!.repriceRequired).toBe(true)
  })
})
