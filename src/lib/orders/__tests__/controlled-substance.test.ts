/**
 * @jest-environment node
 *
 * Compliance C6: controlled substances (DEA schedule II-V, e.g.
 * testosterone, ketamine: schedule III) cannot be signed or sent through
 * CompoundIQ. Several states (PA, TX) require them to be prescribed
 * through certified EPCS, which CompoundIQ is not.
 *
 * The schedule lives on ingredients.dea_schedule (V3) and catalog.
 * dea_schedule (legacy). A single-ingredient formulation reaches its
 * ingredient through salt_forms, a combination through
 * formulation_ingredients. resolveLine read only the second, so plain
 * Testosterone Cypionate was snapshotted as schedule 0 and sign and
 * submit treated it as not controlled. Now both paths are read, and a
 * controlled line is refused when the order is created or edited.
 */

import {
  CONTROLLED_LABEL,
  isControlledSchedule,
  scheduleFromFormulationRow,
} from '../controlled-substance'
import { resolveLine } from '../resolve-line'

describe('the rule', () => {
  it('schedules I-V are controlled; null and 0 are not', () => {
    for (const s of [1, 2, 3, 4, 5]) expect(isControlledSchedule(s)).toBe(true)
    for (const s of [0, null, undefined]) expect(isControlledSchedule(s)).toBe(false)
  })

  it('the label prescribers see', () => {
    expect(CONTROLLED_LABEL).toBe('Controlled substance: prescribe through your EPCS system')
  })

  it('a formulation takes the highest schedule of its salt-form ingredient and its combination ingredients', () => {
    expect(scheduleFromFormulationRow({ salt_forms: { ingredients: { dea_schedule: 3 } }, formulation_ingredients: [] })).toBe(3)
    expect(scheduleFromFormulationRow({ salt_forms: null, formulation_ingredients: [{ ingredients: { dea_schedule: null } }, { ingredients: { dea_schedule: 3 } }] })).toBe(3)
    expect(scheduleFromFormulationRow({ salt_forms: { ingredients: { dea_schedule: null } }, formulation_ingredients: [] })).toBeNull()
  })
})

// ── resolveLine: refused when the order is created or edited ───────

const PHARMACY = 'ph000000-0000-4000-8000-000000000001'
const FORM = 'f0000000-0000-4000-8000-000000000001'

function supabaseWith(opts: { saltSchedule?: number | null; comboSchedules?: Array<number | null>; catalogSchedule?: number }) {
  const chain = (result: () => unknown): Record<string, unknown> => {
    const c: Record<string, unknown> = {}
    for (const k of ['select', 'eq', 'is', 'in', 'order', 'limit']) c[k] = () => c
    c['maybeSingle'] = async () => result()
    c['single'] = async () => result()
    c['then'] = (resolve: (r: unknown) => unknown) => Promise.resolve(result()).then(resolve)
    return c
  }
  return {
    from: (table: string) => {
      if (table === 'formulations') {
        return chain(() => ({
          data: {
            formulation_id: FORM, name: 'Testosterone Cypionate 200mg/mL', concentration: '200 mg/mL',
            dosage_forms: { name: 'Injectable Solution' },
            salt_forms: { ingredients: { dea_schedule: opts.saltSchedule ?? null } },
          },
          error: null,
        }))
      }
      if (table === 'formulation_ingredients') {
        return chain(() => ({ data: (opts.comboSchedules ?? []).map(s => ({ ingredients: { dea_schedule: s } })), error: null }))
      }
      if (table === 'pharmacy_formulations') return chain(() => ({ data: { pharmacy_formulation_id: 'pf-1', wholesale_price: 95 }, error: null }))
      if (table === 'pharmacy_formulation_packages') return chain(() => ({ data: [], error: null }))
      if (table === 'catalog') {
        return chain(() => ({ data: { item_id: 'cat-1', medication_name: 'Testosterone Cream', form: 'Cream', dose: '1%', wholesale_price: 40, dea_schedule: opts.catalogSchedule ?? 0 }, error: null }))
      }
      if (table === 'pharmacies') {
        return chain(() => ({ data: { pharmacy_id: PHARMACY, name: 'Strive', integration_tier: 'TIER_4_FAX', fax_number: '+15125550000', is_active: true, deleted_at: null }, error: null }))
      }
      if (table === 'pharmacy_state_licenses') return chain(() => ({ data: { pharmacy_id: PHARMACY }, error: null }))
      return chain(() => ({ data: null, error: null }))
    },
  }
}

const formulationLine = { catalogItemId: null, formulationId: FORM, pharmacyId: PHARMACY, patientState: 'TX' }
const catalogLine = { catalogItemId: 'cat-1', formulationId: null, pharmacyId: PHARMACY, patientState: 'TX' }

describe('resolveLine refuses a controlled line', () => {
  beforeEach(() => { jest.spyOn(console, 'error').mockImplementation(() => {}) })
  afterEach(() => { jest.restoreAllMocks() })

  it('a single-ingredient formulation, controlled through its salt form (plain Testosterone Cypionate)', async () => {
    const result = await resolveLine(supabaseWith({ saltSchedule: 3 }) as never, formulationLine as never)
    expect(result).toMatchObject({ ok: false, status: 422, code: 'CONTROLLED_SUBSTANCE' })
    if (!result.ok) expect(result.error).toContain(CONTROLLED_LABEL)
  })

  it('a combination with a controlled ingredient (Scream Cream: testosterone)', async () => {
    const result = await resolveLine(supabaseWith({ saltSchedule: null, comboSchedules: [null, 3] }) as never, formulationLine as never)
    expect(result).toMatchObject({ ok: false, status: 422, code: 'CONTROLLED_SUBSTANCE' })
  })

  it('a legacy catalog item with a DEA schedule', async () => {
    const result = await resolveLine(supabaseWith({ catalogSchedule: 3 }) as never, catalogLine as never)
    expect(result).toMatchObject({ ok: false, status: 422, code: 'CONTROLLED_SUBSTANCE' })
  })

  it('a non-controlled formulation still resolves, with schedule 0', async () => {
    const result = await resolveLine(supabaseWith({ saltSchedule: null }) as never, formulationLine as never)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.medicationSnapshot['dea_schedule']).toBe(0)
  })
})
