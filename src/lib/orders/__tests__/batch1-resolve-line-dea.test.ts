/**
 * @jest-environment node
 *
 * Batch 1, finding 2: a failed ingredient lookup must not produce a
 * schedule.
 *
 * resolveLine read the ingredient rows as `{ data }` with the error
 * discarded, so a failed lookup left deaSchedule null and the order
 * snapshot stored `dea_schedule: 0`. sign-and-send reads that snapshot,
 * so a Schedule II compound could be recorded as non-controlled: the
 * "Schedule 2+ must go to a TIER_4_FAX pharmacy" gate passes, and the
 * diagnosis requirement is skipped.
 *
 * The fix is not a safer default. A lookup that failed has no answer, so
 * line creation fails instead.
 */

import { resolveLine } from '../resolve-line'

const PHARMACY = 'ph000000-0000-4000-8000-000000000001'
const FORM     = 'f0000000-0000-4000-8000-000000000001'

let ingredientResult: { data: unknown; error: unknown } = { data: [], error: null }

/** Minimal shape of the chains resolveLine builds, per table. */
function makeSupabase() {
  const chain = (result: () => unknown): Record<string, unknown> => {
    const c: Record<string, unknown> = {}
    for (const k of ['select', 'eq', 'is', 'in', 'order', 'limit']) c[k] = () => c
    c['maybeSingle'] = async () => result()
    c['then'] = (resolve: (r: unknown) => unknown) => Promise.resolve(result()).then(resolve)
    return c
  }
  return {
    from: (table: string) => {
      if (table === 'formulations') {
        return chain(() => ({
          data: {
            formulation_id: FORM, name: 'Semaglutide 5mg/mL', concentration: '5 mg/mL',
            dosage_forms: { name: 'Injectable Solution' },
          },
          error: null,
        }))
      }
      if (table === 'pharmacy_formulations') {
        return chain(() => ({ data: { pharmacy_formulation_id: 'pf-1', wholesale_price: 95 }, error: null }))
      }
      if (table === 'formulation_ingredients') {
        return chain(() => ingredientResult)
      }
      if (table === 'pharmacy_formulation_packages') {
        return chain(() => ({ data: [], error: null }))
      }
      if (table === 'pharmacies') {
        return chain(() => ({
          data: { pharmacy_id: PHARMACY, name: 'Strive Pharmacy', integration_tier: 'TIER_4_FAX', fax_number: '+15125550000' },
          error: null,
        }))
      }
      if (table === 'pharmacy_state_licenses') {
        return chain(() => ({ data: { pharmacy_id: PHARMACY }, error: null }))
      }
      return chain(() => ({ data: null, error: null }))
    },
  }
}

const input = {
  catalogItemId: null,
  formulationId: FORM,
  pharmacyId:    PHARMACY,
  patientState:  'TX',
}

beforeEach(() => {
  ingredientResult = { data: [], error: null }
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { jest.restoreAllMocks() })

describe('resolveLine when the ingredient lookup fails', () => {
  it('refuses the line instead of recording Schedule 0', async () => {
    ingredientResult = { data: null, error: { message: 'connection reset', code: '08006' } }

    const result = await resolveLine(makeSupabase() as never, input as never)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBeGreaterThanOrEqual(500)
      expect(result.error).toMatch(/controlled|schedule/i)
    }
  })

  it('logs the failure with the [orders] prefix so it is findable', async () => {
    const errorSpy = jest.spyOn(console, 'error')
    ingredientResult = { data: null, error: { message: 'connection reset', code: '08006' } }

    await resolveLine(makeSupabase() as never, input as never)

    expect(errorSpy.mock.calls.some(c => String(c[0]).includes('[orders]'))).toBe(true)
  })

  it('a formulation with no controlled ingredient still resolves, with schedule 0', async () => {
    ingredientResult = { data: [{ ingredients: { dea_schedule: null } }], error: null }

    const result = await resolveLine(makeSupabase() as never, input as never)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.medicationSnapshot['dea_schedule']).toBe(0)
  })

  it('a Schedule II ingredient resolves as Schedule II', async () => {
    ingredientResult = { data: [{ ingredients: { dea_schedule: 2 } }], error: null }

    const result = await resolveLine(makeSupabase() as never, input as never)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.medicationSnapshot['dea_schedule']).toBe(2)
  })
})
