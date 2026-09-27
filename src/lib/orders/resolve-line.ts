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
//
// WO-101: a formulation line may name a package (vial size). The package
// must be an active package of THIS pharmacy's formulation, and its price
// — never the client's — becomes the wholesale price. No package → the
// pharmacy_formulations price, which is the default package's price.
//
// WO-101a: and how many of it. packageCount (1..MAX_PACKAGE_COUNT, default
// 1) multiplies the package price; it is meaningless without a package.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database.types'
import {
  MAX_PACKAGE_COUNT,
  formatPackageCount,
  packageOptionsFromRows,
  packageQtyInUnit,
  packageUnitMismatchMessage,
  suggestPackageForDispense,
} from './rx-details'
import { isLivePharmacy, pharmacyInactiveMessage } from '@/lib/pharmacies/live'

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
  // WO-101: label of the package the line was priced from.
  package_label?:   string | null
  // WO-101a: how many of that package.
  package_count?:   number
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
  /** WO-101: pharmacy_formulation_packages.id the provider sent (formulation lines only). */
  packageId?:      string | null | undefined
  /** WO-101a: how many of the package (integer 1..MAX_PACKAGE_COUNT; absent → 1). */
  packageCount?:   number | null | undefined
  /**
   * The line's dispense (rxDetails). With a package, the package must be
   * expressible in this unit (directly, or mg / mcg ↔ mL through the
   * formulation's mg/mL concentration); otherwise the line is refused
   * (422 PACKAGE_UNIT_MISMATCH) rather than priced as one package.
   */
  dispense?:       { quantity: number | null; unit: string | null } | null | undefined
}

/** WO-101: the package an order was priced from (orders.package_id / package_label). */
export interface LinePackage {
  package_id:    string | null
  package_label: string | null
  package_count: number
}

export type ResolveLineResult =
  | { ok: true; medicationItem: MedicationItem; wholesaleCents: number; medicationSnapshot: MedicationSnapshot; pharmacySnapshot: PharmacySnapshot; package: LinePackage }
  | { ok: false; status: 400 | 404 | 422 | 500 | 503; error: string; code?: string }

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
  let linePackage: LinePackage = { package_id: null, package_label: null, package_count: 1 }
  const requestedPackageId = typeof input.packageId === 'string' && input.packageId.trim() ? input.packageId.trim() : null
  if (requestedPackageId && kind !== 'formulation') {
    return { ok: false, status: 400, error: 'packageId applies to formulation lines only' }
  }
  const requestedCount = input.packageCount ?? 1
  if (typeof requestedCount !== 'number' || !Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > MAX_PACKAGE_COUNT) {
    return { ok: false, status: 400, error: `packageCount must be an integer between 1 and ${MAX_PACKAGE_COUNT}` }
  }
  if (requestedCount > 1 && !requestedPackageId) {
    return { ok: false, status: 400, error: 'packageCount requires packageId' }
  }

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
        .select('formulation_id, name, concentration, concentration_value, concentration_unit, dosage_forms(name)')
        .eq('formulation_id', formulationId)
        .eq('is_active', true)
        .is('deleted_at', null)
        .maybeSingle(),
      supabase
        .from('pharmacy_formulations')
        .select('pharmacy_formulation_id, wholesale_price')
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
    //
    // Batch 1, finding 2: this error used to be discarded, and the
    // snapshot below defaults a null schedule to 0. A failed lookup
    // therefore recorded a Schedule II compound as non-controlled, and
    // sign-and-send reads that snapshot: the fax-only gate passed and
    // the diagnosis requirement was skipped. A lookup that failed has
    // no answer, so the line is refused rather than guessed.
    const { data: ingredientRows, error: ingredientError } = await supabase
      .from('formulation_ingredients')
      .select('ingredients(dea_schedule)')
      .eq('formulation_id', formulationId)

    if (ingredientError) {
      console.error('[orders] ingredient dea_schedule lookup failed:', ingredientError.message, '| formulation=', formulationId)
      return {
        ok: false,
        status: 503,
        error: 'Could not determine whether this medication is a controlled substance. Nothing was created — try again.',
      }
    }

    let deaSchedule: number | null = null
    for (const row of ingredientRows ?? []) {
      const ing = row.ingredients as { dea_schedule: number | null } | null
      if (ing?.dea_schedule != null && (deaSchedule == null || ing.dea_schedule > deaSchedule)) {
        deaSchedule = ing.dea_schedule
      }
    }

    // WO-101: price from the chosen package when one is named.
    let wholesalePrice = priceResult.data.wholesale_price
    if (requestedPackageId) {
      const { data: pkg, error: pkgError } = await supabase
        .from('pharmacy_formulation_packages')
        .select('id, package_label, package_qty, package_unit, wholesale_price')
        .eq('id', requestedPackageId)
        .eq('pharmacy_formulation_id', priceResult.data.pharmacy_formulation_id)
        .eq('active', true)
        .maybeSingle()
      if (pkgError) {
        console.error('[orders] package fetch failed:', pkgError.message)
        return { ok: false, status: 500, error: 'Package lookup failed' }
      }
      if (!pkg) {
        return { ok: false, status: 400, error: 'Package is not offered by this pharmacy for this formulation' }
      }
      // The package must be sizable against the dispense. A 5 mg vial for
      // 30 mL at no known concentration has no honest count, so the line
      // is refused rather than stored as one package (prod, 2026-09-25).
      const d = input.dispense
      const pkgRow = pkg as { package_qty?: number | string | null; package_unit?: string | null }
      if (d && typeof d.quantity === 'number' && d.quantity > 0 && d.unit && pkgRow.package_unit && pkgRow.package_qty != null) {
        const form = formResult.data as { concentration_value?: number | null; concentration_unit?: string | null; dosage_forms?: unknown }
        const sized = packageQtyInUnit(
          { qty: Number(pkgRow.package_qty), unit: pkgRow.package_unit },
          d.unit,
          {
            dosageFormName:     (form.dosage_forms as { name?: string } | null)?.name ?? null,
            concentrationValue: form.concentration_value ?? null,
            concentrationUnit:  form.concentration_unit ?? null,
          },
        )
        if (sized == null) {
          return {
            ok: false, status: 422, code: 'PACKAGE_UNIT_MISMATCH',
            error: packageUnitMismatchMessage({ label: pkg.package_label }, d.unit),
          }
        }
      }
      // WO-101a: package price × count, in cents.
      wholesalePrice = (Math.round(Number(pkg.wholesale_price) * 100) * requestedCount) / 100
      linePackage = { package_id: pkg.id, package_label: pkg.package_label, package_count: requestedCount }
    }

    // No package chosen (a protocol line, which never passes the price
    // step): it would be priced as the pharmacy's default package, once,
    // whatever it dispenses. Size it the way the price step does. One
    // default package that covers the dispense is exactly that price, as
    // before. Anything else — another package, more than one, or a
    // package that cannot be sized — is refused, never priced as one.
    const dispenseIn = input.dispense
    if (!requestedPackageId && dispenseIn && typeof dispenseIn.quantity === 'number' && dispenseIn.quantity > 0 && dispenseIn.unit) {
      const { data: pkgRows, error: pkgListError } = await supabase
        .from('pharmacy_formulation_packages')
        .select('id, package_label, package_qty, package_unit, wholesale_price, is_default, active')
        .eq('pharmacy_formulation_id', priceResult.data.pharmacy_formulation_id)
        .eq('active', true)
      if (pkgListError) {
        console.error('[orders] package list fetch failed:', pkgListError.message)
        return { ok: false, status: 500, error: 'Package lookup failed' }
      }
      const offered = packageOptionsFromRows(
        ((pkgRows ?? []) as Array<Record<string, unknown>>)
          .filter(r => r['package_qty'] != null && typeof r['package_unit'] === 'string' && typeof r['id'] === 'string')
          .map(r => ({
            id:              r['id'] as string,
            package_label:   String(r['package_label'] ?? ''),
            package_qty:     r['package_qty'] as number | string,
            package_unit:    r['package_unit'] as string,
            wholesale_price: r['wholesale_price'] as number | string,
            is_default:      r['is_default'] === true,
            active:          r['active'] !== false,
          })),
      )
      if (offered.length > 0) {
        const form = formResult.data as { concentration_value?: number | null; concentration_unit?: string | null; dosage_forms?: unknown }
        const s = suggestPackageForDispense(
          offered,
          { dispenseQuantity: dispenseIn.quantity, dispenseUnit: dispenseIn.unit },
          (form.dosage_forms as { name?: string } | null)?.name ?? null,
          { concentrationValue: form.concentration_value ?? null, concentrationUnit: form.concentration_unit ?? null },
        )
        if (s?.reason === 'unconvertible') {
          return { ok: false, status: 422, code: 'PACKAGE_UNIT_MISMATCH', error: packageUnitMismatchMessage(s.package, dispenseIn.unit) }
        }
        if (s && s.reason !== 'default' && !(s.count === 1 && s.package.isDefault)) {
          const dflt = offered.find(p => p.isDefault) ?? offered[0]!
          return {
            ok: false, status: 422, code: 'PACKAGE_REQUIRED',
            error: `This prescription needs ${formatPackageCount(s.package.label, s.count)} for its ${dispenseIn.quantity} ${dispenseIn.unit} dispense, ` +
              `but no package was chosen, so it would be priced as one ${dflt.label}. Edit the line to choose the package and confirm the price.`,
          }
        }
      }
    }

    const df = formResult.data.dosage_forms as { name: string } | null
    medicationItem = {
      medication_name: formResult.data.name,
      form:            df?.name ?? '',
      dose:            formResult.data.concentration ?? '',
      wholesale_price: wholesalePrice,
      dea_schedule:    deaSchedule,
    }
  }

  const wholesaleCents = Math.round(medicationItem.wholesale_price * 100)

  // Fetch pharmacy (for snapshot). Read whatever its state, then refuse a
  // pharmacy that is not live with a reason — a stale session or a deep
  // link must not create an order on it, and "not found" told nobody why.
  const { data: pharmacy, error: pharmacyError } = await supabase
    .from('pharmacies')
    .select('pharmacy_id, name, integration_tier, fax_number, is_active, deleted_at')
    .eq('pharmacy_id', pharmacyId)
    .maybeSingle()

  if (pharmacyError) {
    console.error('[orders] pharmacy fetch failed:', pharmacyError.message)
    return { ok: false, status: 500, error: 'Pharmacy lookup failed' }
  }
  if (!pharmacy) {
    return { ok: false, status: 404, error: 'Pharmacy not found' }
  }
  if (!isLivePharmacy(pharmacy)) {
    console.warn(`[orders] refused: pharmacy is not live | pharmacy=${pharmacyId}`)
    return { ok: false, status: 422, code: 'PHARMACY_INACTIVE', error: pharmacyInactiveMessage(pharmacy.name) }
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
  // WO-101: the package IS the quantity dispensed — the stored quantity
  // follows it whatever label the client sent.
  if (linePackage.package_label) {
    medicationSnapshot.quantity_label = linePackage.package_label
    medicationSnapshot.package_label  = linePackage.package_label
    medicationSnapshot.package_count  = linePackage.package_count
  }

  const pharmacySnapshot: PharmacySnapshot = {
    pharmacy_id:      pharmacy.pharmacy_id,
    name:             pharmacy.name,
    integration_tier: pharmacy.integration_tier,
    fax_number:       pharmacy.fax_number ?? null,
  }

  return { ok: true, medicationItem, wholesaleCents, medicationSnapshot, pharmacySnapshot, package: linePackage }
}
