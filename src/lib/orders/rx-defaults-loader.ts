// ============================================================
// WO-96: Rx defaults loader (server)
// ============================================================
//
// Resolves, for a set of formulation ids, everything the builder and
// the Review card need to pre-fill an Rx details row:
//
//   - the formulation-level defaults (syringe kit, shipping, clinical
//     difference picklist + required flag) — read from the columns
//     added in 20260912000001, computed by formulationRxDefaults when a
//     row inserted after that migration still has them unset
//   - the DEA schedule (max across ingredients) → controlled rule
//   - the clinic's most common prior diagnosis for the formulation
//     (rule 2: a required field is pre-filled with the most common
//     value and the provider confirms)
//
// Used by the margin page (server component) and by
// GET /api/formulations?level=rx_defaults for lines that entered the
// session without passing through the margin page (protocol quick-load,
// sessions persisted before WO-96).

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import {
  formulationRxDefaults,
  isShippingType,
  isSyringeOption,
  type FormulationRxDefaults,
} from './rx-details'

type ServiceClient = SupabaseClient<Database>

export interface SuggestedDiagnosis {
  code: string | null
  text: string | null
}

export interface RxFormulationDefaults {
  formulationId:      string
  defaults:           FormulationRxDefaults
  deaSchedule:        number | null
  suggestedDiagnosis: SuggestedDiagnosis | null
}

interface IngredientRow {
  common_name:  string
  dea_schedule: number | null
}

interface FormulationRow {
  formulation_id:               string
  default_syringe_option:       string | null
  default_shipping_type:        string | null
  clinical_difference_options:  string[] | null
  requires_clinical_difference: boolean | null
  dosage_forms:                 { name: string; requires_injection_supplies: boolean } | null
  routes_of_administration:     { name: string } | null
  salt_forms:                   { ingredients: IngredientRow | null } | null
  formulation_ingredients:      Array<{ ingredients: IngredientRow | null }> | null
}

interface DiagnosisRow {
  formulation_id: string | null
  diagnosis_code: string | null
  diagnosis_text: string | null
}

/** How many recent diagnosed orders to sample per clinic when picking the most common. */
const DIAGNOSIS_SAMPLE = 200

export async function loadRxDefaults(
  supabase: ServiceClient,
  clinicId: string,
  formulationIds: ReadonlyArray<string>,
): Promise<Record<string, RxFormulationDefaults>> {
  const ids = [...new Set(formulationIds.filter(id => typeof id === 'string' && id.length > 0))]
  if (ids.length === 0) return {}

  const [formulationsResult, diagnosisResult] = await Promise.all([
    supabase
      .from('formulations')
      .select(`
        formulation_id,
        default_syringe_option, default_shipping_type,
        clinical_difference_options, requires_clinical_difference,
        dosage_forms(name, requires_injection_supplies),
        routes_of_administration(name),
        salt_forms(ingredients(common_name, dea_schedule)),
        formulation_ingredients(ingredients(common_name, dea_schedule))
      `)
      .in('formulation_id', ids),
    supabase
      .from('orders')
      .select('formulation_id, diagnosis_code, diagnosis_text')
      .eq('clinic_id', clinicId)
      .in('formulation_id', ids)
      .is('deleted_at', null)
      .or('diagnosis_code.not.is.null,diagnosis_text.not.is.null')
      .order('created_at', { ascending: false })
      .limit(DIAGNOSIS_SAMPLE),
  ])

  if (formulationsResult.error) {
    throw new Error(`[rx-defaults] formulation lookup failed: ${formulationsResult.error.message}`)
  }
  // Diagnosis history is a convenience; a failure here must never block prescribing.
  if (diagnosisResult.error) {
    console.warn('[rx-defaults] diagnosis history lookup failed (non-fatal):', diagnosisResult.error.message)
  }

  const suggestions = mostCommonDiagnoses((diagnosisResult.data ?? []) as DiagnosisRow[])

  const out: Record<string, RxFormulationDefaults> = {}
  for (const raw of (formulationsResult.data ?? []) as unknown as FormulationRow[]) {
    const ingredients: IngredientRow[] = []
    if (raw.salt_forms?.ingredients) ingredients.push(raw.salt_forms.ingredients)
    for (const fi of raw.formulation_ingredients ?? []) {
      if (fi.ingredients) ingredients.push(fi.ingredients)
    }

    let deaSchedule: number | null = null
    for (const ing of ingredients) {
      if (ing.dea_schedule != null && (deaSchedule == null || ing.dea_schedule > deaSchedule)) {
        deaSchedule = ing.dea_schedule
      }
    }

    out[raw.formulation_id] = {
      formulationId:      raw.formulation_id,
      defaults:           resolveDefaults(raw, ingredients.map(i => i.common_name)),
      deaSchedule,
      suggestedDiagnosis: suggestions[raw.formulation_id] ?? null,
    }
  }
  return out
}

/**
 * Column values win; anything unset falls back to the seed rule so a
 * formulation inserted after the migration still gets sane defaults.
 */
function resolveDefaults(row: FormulationRow, ingredientNames: string[]): FormulationRxDefaults {
  const computed = formulationRxDefaults({
    dosageFormName:            row.dosage_forms?.name ?? null,
    routeName:                 row.routes_of_administration?.name ?? null,
    requiresInjectionSupplies: row.dosage_forms?.requires_injection_supplies ?? null,
    ingredientNames,
  })

  const requires = row.requires_clinical_difference ?? computed.requires_clinical_difference
  const columnOptions = row.clinical_difference_options ?? []

  return {
    default_syringe_option:       isSyringeOption(row.default_syringe_option) ? row.default_syringe_option : computed.default_syringe_option,
    default_shipping_type:        isShippingType(row.default_shipping_type) ? row.default_shipping_type : computed.default_shipping_type,
    requires_clinical_difference: requires,
    clinical_difference_options:  columnOptions.length > 0
      ? columnOptions
      : (requires ? computed.clinical_difference_options : []),
  }
}

/**
 * Most common (code, text) pair per formulation from the sampled rows.
 * Ties resolve to the most recent (rows arrive newest first).
 */
export function mostCommonDiagnoses(rows: ReadonlyArray<DiagnosisRow>): Record<string, SuggestedDiagnosis> {
  const counts = new Map<string, Map<string, { n: number; order: number; value: SuggestedDiagnosis }>>()
  let order = 0
  for (const row of rows) {
    if (!row.formulation_id) continue
    const code = blank(row.diagnosis_code)
    const text = blank(row.diagnosis_text)
    if (!code && !text) continue
    const key = `${(code ?? '').toLowerCase()}|${(text ?? '').toLowerCase()}`
    let byKey = counts.get(row.formulation_id)
    if (!byKey) {
      byKey = new Map()
      counts.set(row.formulation_id, byKey)
    }
    const entry = byKey.get(key)
    if (entry) entry.n += 1
    else byKey.set(key, { n: 1, order: order++, value: { code, text } })
  }

  const out: Record<string, SuggestedDiagnosis> = {}
  for (const [formulationId, byKey] of counts) {
    let best: { n: number; order: number; value: SuggestedDiagnosis } | null = null
    for (const entry of byKey.values()) {
      if (!best || entry.n > best.n || (entry.n === best.n && entry.order < best.order)) best = entry
    }
    if (best) out[formulationId] = best.value
  }
  return out
}

function blank(v: string | null | undefined): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length > 0 ? t : null
}
