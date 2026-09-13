// ============================================================
// Prescription line resolution — shared by POST /api/orders and
// PATCH /api/orders/[orderId] (WO-98)
// ============================================================
//
// Turns the client's (catalogItemId | formulationId) + pharmacyId into
// the medication + pharmacy snapshots an order row stores, with the
// same guards the create path has always applied: the item must be
// orderable at that pharmacy, the pharmacy must be active, and it must
// hold an ACTIVE license in the patient's shipping state.
//
// Extracted verbatim from src/app/api/orders/route.ts so editing a draft
// re-validates a changed medication/pharmacy exactly like creating one.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database.types'

type ServiceClient = SupabaseClient<Database>

export interface MedicationItem {
  medication_name: string
  form:            string
  dose:            string
  wholesale_price: number
  dea_schedule:    number | null
}

export interface MedicationSnapshot {
  [key: string]: Json | undefined
  item_id:         string | null
  formulation_id:  string | null
  medication_name: string
  form:            string
  dose:            string
  wholesale_price: number
  dea_schedule:    number
  // WO-98: the structured inputs the sig was built from, so a draft can
  // be reopened in the builder with its current values. Optional — set
  // only when the client sends them.
  prescribed_dose?: string | null
  frequency_code?:  string | null
  quantity_label?:  string | null
}

export interface PharmacySnapshot {
  [key: string]: Json | undefined
  pharmacy_id:      string
  name:             string
  integration_tier: string
  fax_number:       string | null
}

export interface ResolveLineInput {
  catalogItemId?: string | null | undefined
  formulationId?: string | null | undefined
  pharmacyId:     string
  patientState:   string
  /** WO-98 builder inputs carried into medication_snapshot. */
  prescribedDose?: string | null | undefined
  frequencyCode?:  string | null | undefined
  quantityLabel?:  string | null | undefined
}

export type ResolveLineResult =
  | { ok: true; medicationItem: MedicationItem; wholesaleCents: number; medicationSnapshot: MedicationSnapshot; pharmacySnapshot: PharmacySnapshot }
  | { ok: false; status: 400 | 404 | 500; error: string }

/** Exactly one of catalogItemId / formulationId must be set. */
export function lineSourceKind(input: { catalogItemId?: string | null | undefined; formulationId?: string | null | undefined }): 'catalog' | 'formulation' | null {
  const hasCatalog     = typeof input.catalogItemId === 'string' && input.catalogItemId.length > 0
  const hasFormulation = typeof input.formulationId === 'string' && input.formulationId.length > 0
  if (hasCatalog === hasFormulation) return null
  return hasCatalog ? 'catalog' : 'formulation'
}

export async function resolveLine(supabase: ServiceClient, input: ResolveLineInput): Promise<ResolveLineResult> {
  const kind = lineSourceKind(input)
  if (!kind) {
    return { ok: false, status: 400, error: 'Exactly one of catalogItemId or formulationId is required' }
  }
  const { pharmacyId, patientState } = input

  let medicationItem: MedicationItem | null = null

  if (kind === 'catalog') {
    // Legacy flat catalog — scoped to the pharmacy to prevent spoofing
    const { data, error } = await supabase
      .from('catalog')
      .select('item_id, medication_name, form, dose, wholesale_price, dea_schedule')
      .eq('item_id', input.catalogItemId as string)
      .eq('pharmacy_id', pharmacyId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .maybeSingle()

    if (error || !data) {
      console.error('[orders] catalog fetch failed:', error?.message)
      return { ok: false, status: 404, error: 'Catalog item not found' }
    }
    medicationItem = data
  } else {
    // V3.0 hierarchical catalog — formulations + pharmacy_formulations
    const formulationId = input.formulationId as string
    const [formResult, priceResult] = await Promise.all([
      supabase
        .from('formulations')
        .select('formulation_id, name, concentration, dosage_forms(name)')
        .eq('formulation_id', formulationId)
        .eq('is_active', true)
        .is('deleted_at', null)
        .maybeSingle(),
      supabase
        .from('pharmacy_formulations')
        .select('wholesale_price')
        .eq('formulation_id', formulationId)
        .eq('pharmacy_id', pharmacyId)
        .eq('is_available', true)
        .eq('is_active', true)
        .is('deleted_at', null)
        .maybeSingle(),
    ])

    if (formResult.error || !formResult.data || priceResult.error || !priceResult.data) {
      console.error(
        '[orders] formulation fetch failed:',
        formResult.error?.message ?? priceResult.error?.message ?? 'not found'
      )
      return { ok: false, status: 404, error: 'Formulation not found for this pharmacy' }
    }

    // Pull dea_schedule from the most prevalent ingredient (highest among any).
    const { data: ingredientRows } = await supabase
      .from('formulation_ingredients')
      .select('ingredients(dea_schedule)')
      .eq('formulation_id', formulationId)

    let deaSchedule: number | null = null
    for (const row of ingredientRows ?? []) {
      const ing = row.ingredients as { dea_schedule: number | null } | null
      if (ing?.dea_schedule != null && (deaSchedule == null || ing.dea_schedule > deaSchedule)) {
        deaSchedule = ing.dea_schedule
      }
    }

    const df = formResult.data.dosage_forms as { name: string } | null
    medicationItem = {
      medication_name: formResult.data.name,
      form:            df?.name ?? '',
      dose:            formResult.data.concentration ?? '',
      wholesale_price: priceResult.data.wholesale_price,
      dea_schedule:    deaSchedule,
    }
  }

  const wholesaleCents = Math.round(medicationItem.wholesale_price * 100)

  // Fetch pharmacy (for snapshot)
  const { data: pharmacy, error: pharmacyError } = await supabase
    .from('pharmacies')
    .select('pharmacy_id, name, integration_tier, fax_number')
    .eq('pharmacy_id', pharmacyId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .maybeSingle()

  if (pharmacyError || !pharmacy) {
    console.error('[orders] pharmacy fetch failed:', pharmacyError?.message)
    return { ok: false, status: 404, error: 'Pharmacy not found' }
  }

  // Compliance (defense in depth): the pharmacy must hold an ACTIVE
  // license in the patient's shipping state.
  const { data: stateLicense, error: licenseError } = await supabase
    .from('pharmacy_state_licenses')
    .select('pharmacy_id')
    .eq('pharmacy_id', pharmacyId)
    .eq('state_code', patientState)
    .eq('is_active', true)
    .maybeSingle()

  if (licenseError) {
    console.error('[orders] state license fetch failed:', licenseError.message)
    return { ok: false, status: 500, error: 'Pharmacy license lookup failed' }
  }

  if (!stateLicense) {
    return { ok: false, status: 400, error: `Pharmacy ${pharmacy.name} is not licensed in ${patientState}` }
  }

  const medicationSnapshot: MedicationSnapshot = {
    item_id:         kind === 'catalog' ? (input.catalogItemId as string) : null,
    formulation_id:  kind === 'formulation' ? (input.formulationId as string) : null,
    medication_name: medicationItem.medication_name,
    form:            medicationItem.form,
    dose:            medicationItem.dose,
    wholesale_price: wholesaleCents / 100,
    dea_schedule:    medicationItem.dea_schedule ?? 0,
  }
  // WO-98: only add the builder inputs when the client sent them so the
  // snapshot shape of pre-WO-98 clients is byte-for-byte unchanged.
  if (typeof input.prescribedDose === 'string' && input.prescribedDose.trim()) medicationSnapshot.prescribed_dose = input.prescribedDose.trim()
  if (typeof input.frequencyCode === 'string' && input.frequencyCode.trim())   medicationSnapshot.frequency_code  = input.frequencyCode.trim()
  if (typeof input.quantityLabel === 'string' && input.quantityLabel.trim())   medicationSnapshot.quantity_label  = input.quantityLabel.trim()

  const pharmacySnapshot: PharmacySnapshot = {
    pharmacy_id:      pharmacy.pharmacy_id,
    name:             pharmacy.name,
    integration_tier: pharmacy.integration_tier,
    fax_number:       pharmacy.fax_number ?? null,
  }

  return { ok: true, medicationItem, wholesaleCents, medicationSnapshot, pharmacySnapshot }
}
