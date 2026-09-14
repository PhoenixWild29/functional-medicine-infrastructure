/**
 * @jest-environment node
 *
 * WO-96 rx-defaults loader: column values win, unset columns fall back
 * to the seed rule, the DEA schedule is the max across ingredients, and
 * the suggested diagnosis is the clinic's most common prior value.
 */

import { loadRxDefaults, mostCommonDiagnoses } from '../rx-defaults-loader'
import { STANDARD_CLINICAL_DIFFERENCE_OPTIONS } from '../rx-details'

// ── Minimal fake Supabase client ─────────────────────────────

type Result = { data: unknown; error: { message: string } | null }

function fakeClient(results: Record<string, Result>) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = []
  return {
    calls,
    from(table: string) {
      const chain: Record<string, unknown> = {}
      const record = (method: string) => (...args: unknown[]) => {
        calls.push({ table, method, args })
        return chain
      }
      for (const m of ['select', 'in', 'eq', 'is', 'or', 'order', 'limit']) chain[m] = record(m)
      chain['then'] = (resolve: (v: Result) => unknown) =>
        Promise.resolve(results[table] ?? { data: [], error: null }).then(resolve)
      return chain
    },
  }
}

const SEMA = 'f0000000-0000-4000-8000-000000000001'
const TEST = 'f0000000-0000-4000-8000-000000000002'
const NEW  = 'f0000000-0000-4000-8000-000000000003'

describe('loadRxDefaults', () => {
  it('returns column defaults, DEA schedule and the most common diagnosis per formulation', async () => {
    const client = fakeClient({
      formulations: {
        data: [
          {
            formulation_id: SEMA,
            default_syringe_option: 'sc_kit',
            default_shipping_type: 'cold_chain',
            clinical_difference_options: ['Reason A', 'Reason B'],
            requires_clinical_difference: true,
            dosage_forms: { name: 'Injectable Solution', requires_injection_supplies: true },
            routes_of_administration: { name: 'Subcutaneous' },
            salt_forms: { ingredients: { common_name: 'Semaglutide', dea_schedule: null } },
            formulation_ingredients: [],
          },
          {
            formulation_id: TEST,
            default_syringe_option: 'im_kit',
            default_shipping_type: 'standard',
            clinical_difference_options: [],
            requires_clinical_difference: false,
            dosage_forms: { name: 'Injectable Solution', requires_injection_supplies: true },
            routes_of_administration: { name: 'Intramuscular' },
            salt_forms: { ingredients: { common_name: 'Testosterone', dea_schedule: 3 } },
            formulation_ingredients: [],
          },
        ],
        error: null,
      },
      orders: {
        data: [
          { formulation_id: TEST, diagnosis_code: 'E29.1', diagnosis_text: 'Testicular hypofunction' },
          { formulation_id: TEST, diagnosis_code: 'E23.0', diagnosis_text: 'Hypopituitarism' },
          { formulation_id: TEST, diagnosis_code: 'E29.1', diagnosis_text: 'Testicular hypofunction' },
        ],
        error: null,
      },
    })

    const out = await loadRxDefaults(client as never, 'clinic-1', [SEMA, TEST, TEST])

    expect(out[SEMA]).toEqual({
      formulationId: SEMA,
      defaults: {
        default_syringe_option: 'sc_kit',
        default_shipping_type: 'cold_chain',
        clinical_difference_options: ['Reason A', 'Reason B'],
        requires_clinical_difference: true,
      },
      deaSchedule: null,
      suggestedDiagnosis: null,
      // WO-96 fix: what the Review card derives days supply / dispense from
      dispenseInputs: { concentrationValue: null, concentrationUnit: null, dosageFormName: 'Injectable Solution' },
    })
    expect(out[TEST]).toEqual({
      formulationId: TEST,
      defaults: {
        default_syringe_option: 'im_kit',
        default_shipping_type: 'standard',
        clinical_difference_options: [],
        requires_clinical_difference: false,
      },
      deaSchedule: 3,
      suggestedDiagnosis: { code: 'E29.1', text: 'Testicular hypofunction' },
      dispenseInputs: { concentrationValue: null, concentrationUnit: null, dosageFormName: 'Injectable Solution' },
    })

    // Deduplicated ids reach the query, scoped to the clinic.
    const inCall = client.calls.find(c => c.table === 'formulations' && c.method === 'in')
    expect(inCall?.args).toEqual(['formulation_id', [SEMA, TEST]])
    const clinicCall = client.calls.find(c => c.table === 'orders' && c.method === 'eq')
    expect(clinicCall?.args).toEqual(['clinic_id', 'clinic-1'])
  })

  it('falls back to the seed rule when the columns are unset (row inserted after the migration)', async () => {
    const client = fakeClient({
      formulations: {
        data: [{
          formulation_id: NEW,
          default_syringe_option: null,
          default_shipping_type: null,
          clinical_difference_options: [],
          requires_clinical_difference: null,
          dosage_forms: { name: 'Injectable Solution', requires_injection_supplies: true },
          routes_of_administration: { name: 'Subcutaneous' },
          salt_forms: null,
          formulation_ingredients: [
            { ingredients: { common_name: 'Tirzepatide', dea_schedule: null } },
            { ingredients: { common_name: 'Cyanocobalamin', dea_schedule: null } },
          ],
        }],
        error: null,
      },
    })

    const out = await loadRxDefaults(client as never, 'clinic-1', [NEW])
    expect(out[NEW]?.defaults).toEqual({
      default_syringe_option: 'sc_kit',
      default_shipping_type: 'cold_chain',
      clinical_difference_options: [...STANDARD_CLINICAL_DIFFERENCE_OPTIONS],
      requires_clinical_difference: true,
    })
  })

  it('returns an empty map for no ids without querying', async () => {
    const client = fakeClient({})
    expect(await loadRxDefaults(client as never, 'clinic-1', [])).toEqual({})
    expect(client.calls).toEqual([])
  })

  it('throws on a formulation lookup error but only warns on a diagnosis history error', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const failing = fakeClient({ formulations: { data: null, error: { message: 'boom' } } })
    await expect(loadRxDefaults(failing as never, 'clinic-1', [SEMA])).rejects.toThrow(/boom/)

    const softFail = fakeClient({
      formulations: { data: [], error: null },
      orders: { data: null, error: { message: 'history down' } },
    })
    await expect(loadRxDefaults(softFail as never, 'clinic-1', [SEMA])).resolves.toEqual({})
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/diagnosis history/), 'history down')
    warn.mockRestore()
  })
})

describe('mostCommonDiagnoses', () => {
  it('picks the most frequent (code, text) pair per formulation, newest first on ties', () => {
    const out = mostCommonDiagnoses([
      { formulation_id: 'a', diagnosis_code: 'X1', diagnosis_text: 'first seen' },
      { formulation_id: 'a', diagnosis_code: 'X2', diagnosis_text: 'second' },
      { formulation_id: 'b', diagnosis_code: null, diagnosis_text: 'text only' },
      { formulation_id: 'a', diagnosis_code: 'x2', diagnosis_text: 'SECOND' },   // case-insensitive match
      { formulation_id: null, diagnosis_code: 'Z', diagnosis_text: null },     // ignored
      { formulation_id: 'c', diagnosis_code: '', diagnosis_text: '  ' },       // blank → ignored
    ])
    expect(out).toEqual({
      a: { code: 'X2', text: 'second' },
      b: { code: null, text: 'text only' },
    })
  })
})
