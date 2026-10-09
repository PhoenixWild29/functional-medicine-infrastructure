/**
 * @jest-environment node
 *
 * Compliance C8 at order creation (resolveLine, behind POST /api/orders):
 *
 *   - a formulation with an ingredient that may not be compounded is
 *     refused, 422 NOT_COMPOUNDABLE, naming the ingredient and why;
 *   - (owner decision) one pending FDA evaluation resolves;
 *   - one with an unverified ingredient is refused too, 422
 *     COMPOUNDING_STATUS_UNKNOWN;
 *   - both the salt-form ingredient and every combination ingredient
 *     count;
 *   - an older catalog line that is RECALLED or DISCONTINUED is refused,
 *     422 NOT_COMPOUNDABLE.
 */

import { resolveLine } from '../resolve-line'

const PHARMACY = 'a4000000-0000-4000-8000-000000000001'
const FORM     = 'f0000000-0000-4000-8000-000000000001'
const ITEM     = 'c0000000-0000-4000-8000-000000000001'

const ok = (name: string, over: Record<string, unknown> = {}) => ({
  common_name: name, dea_schedule: null, compounding_status: 'approved_drug_component',
  commercial_equivalent: false, on_fda_shortage: false, ...over,
})

let saltIngredient: Record<string, unknown> | null = ok('Semaglutide')
let comboIngredients: Array<Record<string, unknown>> = []
let catalogStatus = 'ACTIVE'
const selects: Record<string, string[]> = {}

function makeSupabase() {
  const chain = (table: string, result: () => unknown): Record<string, unknown> => {
    const c: Record<string, unknown> = {}
    c['select'] = (cols: string) => { (selects[table] ??= []).push(cols); return c }
    for (const k of ['eq', 'is', 'in', 'order', 'limit']) c[k] = () => c
    c['maybeSingle'] = async () => result()
    c['then'] = (resolve: (r: unknown) => unknown) => Promise.resolve(result()).then(resolve)
    return c
  }
  return {
    from: (table: string) => {
      if (table === 'formulations') {
        return chain(table, () => ({
          data: {
            formulation_id: FORM, name: 'BPC-157 5mg/mL Injectable', concentration: '5 mg/mL',
            dosage_forms: { name: 'Injectable Solution', is_sterile: true },
            salt_forms: saltIngredient ? { ingredients: saltIngredient } : null,
          },
          error: null,
        }))
      }
      if (table === 'catalog') {
        return chain(table, () => ({
          data: { item_id: ITEM, medication_name: 'Old Cream 2%', form: 'Cream', dose: '2%', wholesale_price: 20, dea_schedule: 0, regulatory_status: catalogStatus },
          error: null,
        }))
      }
      if (table === 'pharmacy_formulations') return chain(table, () => ({ data: { pharmacy_formulation_id: 'pf-1', wholesale_price: 95 }, error: null }))
      if (table === 'formulation_ingredients') return chain(table, () => ({ data: comboIngredients.map(i => ({ ingredients: i })), error: null }))
      if (table === 'pharmacy_formulation_packages') return chain(table, () => ({ data: [], error: null }))
      if (table === 'pharmacies') {
        return chain(table, () => ({
          data: { pharmacy_id: PHARMACY, name: 'Strive Pharmacy', integration_tier: 'TIER_4_FAX', fax_number: '+15125550000', is_active: true, deleted_at: null, facility_type: '503A' },
          error: null,
        }))
      }
      if (table === 'pharmacy_state_licenses') {
        return chain(table, () => ({ data: [{ pharmacy_id: PHARMACY, state_code: 'TX', expiration_date: '2099-12-31', is_active: true, deleted_at: null, sterile_compounding: true }], error: null }))
      }
      return chain(table, () => ({ data: null, error: null }))
    },
  }
}

const formulationLine = { catalogItemId: null, formulationId: FORM, pharmacyId: PHARMACY, patientState: 'TX' }
const catalogLine = { catalogItemId: ITEM, formulationId: null, pharmacyId: PHARMACY, patientState: 'TX' }

beforeEach(() => {
  saltIngredient = ok('Semaglutide')
  comboIngredients = []
  catalogStatus = 'ACTIVE'
  for (const k of Object.keys(selects)) delete selects[k]
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('a formulation line', () => {
  it('every ingredient compoundable: resolves', async () => {
    expect((await resolveLine(makeSupabase() as never, formulationLine as never)).ok).toBe(true)
  })

  it('an ingredient in Category 2: 422 NOT_COMPOUNDABLE, naming it', async () => {
    saltIngredient = ok('BPC-157', { compounding_status: 'category_2' })
    const res = await resolveLine(makeSupabase() as never, formulationLine as never)
    expect(res).toMatchObject({ ok: false, status: 422, code: 'NOT_COMPOUNDABLE' })
    if (!res.ok) expect(res.error).toBe('BPC-157 5mg/mL Injectable: BPC-157 is 503A Category 2 (significant safety risks), so it cannot be compounded or ordered through CompoundIQ.')
  })

  // CHANGED (owner decision): pending FDA evaluation is orderable.
  it('an ingredient pending FDA evaluation resolves (orderable, with a warning shown elsewhere)', async () => {
    saltIngredient = ok('BPC-157', { compounding_status: 'pending_evaluation' })
    expect((await resolveLine(makeSupabase() as never, formulationLine as never)).ok).toBe(true)
  })

  it.each(['category_2', 'category_3', 'withdrawn_removed', 'not_eligible'])('%s: 422 NOT_COMPOUNDABLE', async status => {
    saltIngredient = ok('X', { compounding_status: status })
    expect(await resolveLine(makeSupabase() as never, formulationLine as never)).toMatchObject({ ok: false, status: 422, code: 'NOT_COMPOUNDABLE' })
  })

  it('an unverified ingredient: 422 COMPOUNDING_STATUS_UNKNOWN', async () => {
    saltIngredient = ok('NAD+', { compounding_status: 'unverified' })
    const res = await resolveLine(makeSupabase() as never, formulationLine as never)
    expect(res).toMatchObject({ ok: false, status: 422, code: 'COMPOUNDING_STATUS_UNKNOWN' })
    if (!res.ok) expect(res.error).toContain('the compounding status of NAD+ has not been verified')
  })

  it('a combination: any combination ingredient blocks it', async () => {
    saltIngredient = null
    comboIngredients = [ok('Cyanocobalamin'), ok('Peptide X', { compounding_status: 'category_2' })]
    expect(await resolveLine(makeSupabase() as never, formulationLine as never)).toMatchObject({ ok: false, status: 422, code: 'NOT_COMPOUNDABLE' })
  })

  it('no ingredient found at all: unknown, refused', async () => {
    saltIngredient = null
    comboIngredients = []
    expect(await resolveLine(makeSupabase() as never, formulationLine as never)).toMatchObject({ ok: false, status: 422, code: 'COMPOUNDING_STATUS_UNKNOWN' })
  })

  it('reads the compounding fields from both paths', async () => {
    await resolveLine(makeSupabase() as never, formulationLine as never)
    expect(selects['formulations']!.join()).toMatch(/salt_forms\(ingredients\([^)]*compounding_status/)
    expect(selects['formulation_ingredients']!.join()).toMatch(/ingredients\([^)]*compounding_status/)
  })
})

describe('an older catalog line', () => {
  it.each(['RECALLED', 'DISCONTINUED'])('%s: 422 NOT_COMPOUNDABLE', async status => {
    catalogStatus = status
    const res = await resolveLine(makeSupabase() as never, catalogLine as never)
    expect(res).toMatchObject({ ok: false, status: 422, code: 'NOT_COMPOUNDABLE' })
    if (!res.ok) expect(res.error).toBe(`Old Cream 2%: this catalog item is ${status.toLowerCase()}, so it cannot be ordered.`)
  })

  it('ACTIVE: resolves', async () => {
    expect((await resolveLine(makeSupabase() as never, catalogLine as never)).ok).toBe(true)
  })
})
