// ============================================================
// WO-96: Rx Detail Fields — derivation, defaults, validation
// ============================================================
//
// Pure functions shared by the prescription builder (client), the
// order-creation API, sign-and-send, the pharmacy payload builders,
// and the catalog seed scripts. No React, no Supabase, no I/O.
//
// Phase 21 rules this module exists to satisfy:
//   2. No new required field without a default — every field here has
//      one, taken from the formulation (syringe kit, shipping, clinical
//      difference) or a fixed value (refills 0, substitution allowed).
//   3. Nothing on screen the app could have computed — days supply and
//      dispense are derived from dose × frequency × quantity.
//   4. Store once, attach everywhere — formulation-level defaults are
//      computed by `formulationRxDefaults` and written to
//      `formulations.default_*` (migration 20260912000001 + seeds).

// ── Enumerations ────────────────────────────────────────────

export const SYRINGE_OPTIONS = [
  { value: 'sc_kit',          label: 'SubQ syringe kit' },
  { value: 'im_kit',          label: 'IM syringe kit' },
  { value: 'insulin_syringe', label: 'Insulin syringes' },
  { value: 'none',            label: 'None' },
] as const

export type SyringeOption = (typeof SYRINGE_OPTIONS)[number]['value']

export const SHIPPING_TYPES = [
  { value: 'standard',   label: 'Standard' },
  { value: 'cold_chain', label: 'Cold chain (refrigerated)' },
] as const

export type ShippingType = (typeof SHIPPING_TYPES)[number]['value']

export const MAX_REFILLS = 12

export function isSyringeOption(v: unknown): v is SyringeOption {
  return SYRINGE_OPTIONS.some(o => o.value === v)
}

export function isShippingType(v: unknown): v is ShippingType {
  return SHIPPING_TYPES.some(o => o.value === v)
}

// ── Formulation-level defaults ──────────────────────────────

/** Ingredients treated as GLP-1 receptor agonists (cold chain + 503A statement). */
export const GLP1_INGREDIENTS = ['Semaglutide', 'Tirzepatide', 'Liraglutide', 'Retatrutide'] as const

/**
 * Standard 503A "not essentially a copy of a commercial product" reasons.
 * First entry is the pre-selected default. Mirrored verbatim in
 * supabase/migrations/20260912000001_wo96_rx_detail_fields.sql — the
 * rx-details unit test asserts the two stay in sync.
 */
export const STANDARD_CLINICAL_DIFFERENCE_OPTIONS = [
  'Patient requires a dose or strength not commercially available',
  'Patient has a documented allergy or intolerance to an excipient in the commercial product',
  'Commercial product is unavailable or on national shortage',
  'Patient requires an alternative dosage form or route of administration',
  'Combination therapy not available as a commercial product',
] as const

export interface FormulationRxDefaults {
  default_syringe_option:       SyringeOption
  default_shipping_type:        ShippingType
  clinical_difference_options:  string[]
  requires_clinical_difference: boolean
}

export interface FormulationRxDefaultsInput {
  dosageFormName:             string | null | undefined
  routeName?:                 string | null | undefined
  requiresInjectionSupplies?: boolean | null | undefined
  ingredientNames:            ReadonlyArray<string>
}

export function isInjectableForm(input: Pick<FormulationRxDefaultsInput, 'dosageFormName' | 'requiresInjectionSupplies'>): boolean {
  if (input.requiresInjectionSupplies) return true
  return /injectable/i.test(input.dosageFormName ?? '')
}

export function isGlp1(ingredientNames: ReadonlyArray<string>): boolean {
  const wanted = new Set<string>(GLP1_INGREDIENTS.map(n => n.toLowerCase()))
  return ingredientNames.some(n => wanted.has(n.trim().toLowerCase()))
}

/**
 * The seed rule from the work order:
 *   injectables → sc_kit (im_kit when the route is Intramuscular)
 *   GLP-1s      → cold_chain + requires_clinical_difference + standard options
 *   else        → none / standard
 */
export function formulationRxDefaults(input: FormulationRxDefaultsInput): FormulationRxDefaults {
  const injectable = isInjectableForm(input)
  const glp1 = isGlp1(input.ingredientNames)
  const im = /intramuscular/i.test(input.routeName ?? '')

  return {
    default_syringe_option:       injectable ? (im ? 'im_kit' : 'sc_kit') : 'none',
    default_shipping_type:        glp1 ? 'cold_chain' : 'standard',
    clinical_difference_options:  glp1 ? [...STANDARD_CLINICAL_DIFFERENCE_OPTIONS] : [],
    requires_clinical_difference: glp1,
  }
}

// ── Per-Rx detail fields ────────────────────────────────────

export interface RxDetails {
  daysSupply:          number | null
  dispenseQuantity:    number | null
  dispenseUnit:        string | null
  refills:             number
  substitutionAllowed: boolean
  syringeOption:       SyringeOption
  shippingType:        ShippingType
  clinicalDifference:  string | null
  diagnosisCode:       string | null
  diagnosisText:       string | null
  specialInstructions: string | null
}

/**
 * What the Review card needs to know about an Rx line beyond the
 * details themselves: which fields a rule makes required, and the
 * picklist to offer.
 */
export interface RxRules {
  /** DEA schedule ≥ 2 → a diagnosis (code or text) is required at sign time. */
  isControlled:               boolean
  /** formulations.requires_clinical_difference */
  requiresClinicalDifference: boolean
  /** formulations.clinical_difference_options (first entry = default) */
  clinicalDifferenceOptions:  string[]
}

export type RxDetailsSource = Partial<Pick<FormulationRxDefaults,
  'default_syringe_option' | 'default_shipping_type' | 'clinical_difference_options' | 'requires_clinical_difference'
>> | null | undefined

export interface RxDetailsSeed {
  refills?:            number | null
  diagnosisCode?:      string | null
  diagnosisText?:      string | null
  derived?:            DerivedDispense | null
}

/**
 * Build the pre-filled details for a new Rx line. Everything has a value
 * (rule 2). `seed.diagnosis*` is the clinic's most common prior diagnosis
 * for this formulation when one exists — see loadRxDefaults.
 */
export function defaultRxDetails(formulation: RxDetailsSource, seed: RxDetailsSeed = {}): RxDetails {
  const requires = formulation?.requires_clinical_difference === true
  const options = formulation?.clinical_difference_options ?? []
  const syringe = formulation?.default_syringe_option
  const shipping = formulation?.default_shipping_type

  return {
    daysSupply:          seed.derived?.daysSupply ?? null,
    dispenseQuantity:    seed.derived?.dispenseQuantity ?? null,
    dispenseUnit:        seed.derived?.dispenseUnit ?? null,
    refills:             clampRefills(seed.refills),
    substitutionAllowed: true,
    syringeOption:       isSyringeOption(syringe) ? syringe : 'none',
    shippingType:        isShippingType(shipping) ? shipping : 'standard',
    clinicalDifference:  requires && options.length > 0 ? (options[0] ?? null) : null,
    diagnosisCode:       blankToNull(seed.diagnosisCode),
    diagnosisText:       blankToNull(seed.diagnosisText),
    specialInstructions: null,
  }
}

export function rulesFromFormulation(formulation: RxDetailsSource, deaSchedule: number | null | undefined): RxRules {
  return {
    isControlled:               typeof deaSchedule === 'number' && deaSchedule >= 2,
    requiresClinicalDifference: formulation?.requires_clinical_difference === true,
    clinicalDifferenceOptions:  [...(formulation?.clinical_difference_options ?? [])],
  }
}

export type MissingRxDetail = 'diagnosis' | 'clinical_difference'

/**
 * Fields a rule requires that are still empty. The Review card blocks
 * Sign & Send while this is non-empty and auto-expands the Rx details
 * row; sign-and-send re-checks server-side.
 */
export function missingRxDetails(details: RxDetails | null | undefined, rules: RxRules): MissingRxDetail[] {
  const missing: MissingRxDetail[] = []
  const hasDiagnosis = !!(blankToNull(details?.diagnosisCode) || blankToNull(details?.diagnosisText))
  if (rules.isControlled && !hasDiagnosis) missing.push('diagnosis')
  if (rules.requiresClinicalDifference && !blankToNull(details?.clinicalDifference)) {
    missing.push('clinical_difference')
  }
  return missing
}

/** True when the Rx details row should start expanded (rule requires confirmation). */
export function rxDetailsNeedConfirmation(rules: RxRules): boolean {
  return rules.isControlled || rules.requiresClinicalDifference
}

export const MISSING_RX_DETAIL_LABEL: Record<MissingRxDetail, string> = {
  diagnosis:           'a diagnosis (controlled substance)',
  clinical_difference: 'a clinical difference statement',
}

// ── Derived: days supply + dispense ─────────────────────────

/** Doses per day for each structured-sig frequency code. PRN cannot be derived. */
export const DOSES_PER_DAY: Record<string, number | null> = {
  QD:  1,
  BID: 2,
  TID: 3,
  QID: 4,
  QHS: 1,
  QW:  1 / 7,
  Q2W: 1 / 14,
  QOD: 1 / 2,
  MF:  5 / 7,
  TIW: 2.5 / 7,
  PRN: null,
}

export function dosesPerDay(frequencyCode: string | null | undefined): number | null {
  if (!frequencyCode) return null
  const v = DOSES_PER_DAY[frequencyCode.toUpperCase()]
  return typeof v === 'number' ? v : null
}

export interface ParsedQuantity {
  value:      number
  /** Normalised unit: mL | g | mg | capsule | tablet | troche | vial | bottle | tube | unit */
  unit:       string
  /** True when the label only names containers (e.g. "1 vial") with no volume. */
  isContainer: boolean
}

const UNIT_ALIASES: Array<[RegExp, string, boolean]> = [
  [/^ml$/i,                'mL',     false],
  [/^mg$/i,                'mg',     false],
  [/^g$|^gm$|^grams?$/i,   'g',      false],
  [/^caps?(ules?)?$/i,     'capsule', false],
  [/^tabs?(lets?)?$/i,     'tablet', false],
  [/^troches?$/i,          'troche', false],
  [/^units?$/i,            'unit',   false],
  [/^vials?$/i,            'vial',   true],
  [/^bottles?$/i,          'bottle', true],
  [/^tubes?$/i,            'tube',   true],
  [/^pens?$/i,             'pen',    true],
  [/^kits?$/i,             'kit',    true],
]

/**
 * Parse a pharmacy quantity label such as "5mL vial", "2.5 mL vial",
 * "30 capsules", "60mL bottle", "30mL multi-dose vial", "1 vial", "30".
 * Returns null when no leading number is present.
 */
export function parseQuantityLabel(label: string | null | undefined, dosageFormName?: string | null): ParsedQuantity | null {
  if (!label) return null
  const m = /^\s*(\d+(?:\.\d+)?)\s*([A-Za-z]+)?/.exec(label)
  if (!m) return null
  const value = parseFloat(m[1]!)
  if (!isFinite(value) || value <= 0) return null

  const token = m[2] ?? ''
  for (const [re, unit, isContainer] of UNIT_ALIASES) {
    if (re.test(token)) return { value, unit, isContainer }
  }

  // No recognised unit token — infer from the dosage form.
  const form = (dosageFormName ?? '').toLowerCase()
  if (/capsule/.test(form)) return { value, unit: 'capsule', isContainer: false }
  if (/tablet|rdt/.test(form)) return { value, unit: 'tablet', isContainer: false }
  if (/troche/.test(form)) return { value, unit: 'troche', isContainer: false }
  if (/injectable|solution|spray/.test(form)) return { value, unit: 'mL', isContainer: false }
  if (/cream|gel/.test(form)) return { value, unit: 'g', isContainer: false }
  return { value, unit: token || 'unit', isContainer: false }
}

export interface DispenseInput {
  doseAmount:         string | number | null | undefined
  doseUnit:           string | null | undefined   // mg | mL | units | mcg | tablet | capsule | click
  frequencyCode:      string | null | undefined
  quantityLabel:      string | null | undefined   // selected pharmacy quantity, e.g. "5mL vial"
  concentrationValue: number | null | undefined
  concentrationUnit:  string | null | undefined   // "mg/mL" enables mg/mcg ↔ mL
  dosageFormName:     string | null | undefined
  /**
   * Duration the provider picked on the dose step ("For 30 days" → 30).
   * When set it IS the days supply and dispense is computed from it;
   * null/absent ("Ongoing", "(no duration)") falls back to deriving days
   * supply from the quantity. See durationDaysFromSig.
   */
  durationDays?:      number | null | undefined
}

export interface DerivedDispense {
  daysSupply:       number | null
  dispenseQuantity: number
  dispenseUnit:     string
}

/**
 * Per-dose amount expressed in the dispense unit, or null when the two
 * cannot be reconciled (e.g. dose in mg against a container-only label).
 */
function perDoseInDispenseUnit(input: DispenseInput, qty: ParsedQuantity): number | null {
  const dose = typeof input.doseAmount === 'number' ? input.doseAmount : parseFloat(String(input.doseAmount ?? ''))
  if (!isFinite(dose) || dose <= 0) return null
  const unit = (input.doseUnit ?? '').toLowerCase()
  const conc = input.concentrationValue ?? null
  const concIsMgPerMl = (input.concentrationUnit ?? '').toLowerCase() === 'mg/ml'

  if (qty.unit === 'mL') {
    if (unit === 'ml') return dose
    if (unit === 'units') return dose / 100            // U-100 insulin syringe: 100 units = 1 mL
    if (unit === 'mg' && conc && concIsMgPerMl) return dose / conc
    if (unit === 'mcg' && conc && concIsMgPerMl) return dose / 1000 / conc
    return null
  }
  if (qty.unit === 'capsule' || qty.unit === 'tablet' || qty.unit === 'troche') {
    if (unit === 'capsule' || unit === 'tablet' || unit === 'troche') return dose
    // "1 mg" of a 1 mg capsule → 1 capsule when the strength is known.
    if ((unit === 'mg' || unit === 'mcg') && conc && !concIsMgPerMl) {
      const mg = unit === 'mcg' ? dose / 1000 : dose
      return mg / conc
    }
    return null
  }
  if (qty.unit === 'g') {
    if (unit === 'g') return dose
    if (unit === 'mg' && conc && /mg\/g/i.test(input.concentrationUnit ?? '')) return dose / conc
    return null
  }
  return null
}

/**
 * The unit a line is dispensed in, from its dosage form and dose unit:
 * count doses (capsule / tablet / troche) dispense as that count;
 * injectables, solutions and sprays in mL; creams and gels in g.
 */
export function dispenseUnitFor(dosageFormName: string | null | undefined, doseUnit: string | null | undefined): string {
  const unit = (doseUnit ?? '').toLowerCase()
  if (unit === 'capsule' || unit === 'tablet' || unit === 'troche') return unit
  const form = (dosageFormName ?? '').toLowerCase()
  if (/capsule/.test(form)) return 'capsule'
  if (/tablet|rdt/.test(form)) return 'tablet'
  if (/troche/.test(form)) return 'troche'
  if (/injectable|solution|spray/.test(form)) return 'mL'
  if (/cream|gel/.test(form)) return 'g'
  return unit === 'ml' ? 'mL' : (unit || 'unit')
}

/**
 * The duration the structured sig builder wrote into the sig: "for 30
 * days" → 30 (the Duration dropdown and "Custom..." both produce this
 * form). "ongoing", no duration, and titration / cycling sigs ("for 6
 * weeks then reassess") → null. The sig is the one place the duration
 * travels on every path (URL, session line, draft sig_text, favorites),
 * which is how WO-98's edit path already recovers it.
 */
export function durationDaysFromSig(sig: string | null | undefined): number | null {
  const lower = (sig ?? '').toLowerCase()
  if (!lower || /titrate/.test(lower)) return null
  const m = /\bfor (\d{1,4}) days?\b(?! then)/.exec(lower)
  if (!m) return null
  const days = parseInt(m[1]!, 10)
  return days > 0 ? days : null
}

/**
 * WO-104: the duration a price-step (margin page) link carries.
 *
 * Every path into the price step now sends the duration as a structured
 * value: the builder's Continue (WO-101) and — since WO-104 — favorites,
 * whose dose presets land on the builder's dose step instead of jumping
 * to the price step with a sig. The sig fallback remains ONLY for a
 * legacy saved link that predates the structured parameter, and it reads
 * the sig that link carried, once — never sig text edited on the page.
 */
export function durationDaysForLink(
  structuredDays: number | null | undefined,
  legacyLinkSig: string | null | undefined,
): number | null {
  if (structuredDays !== undefined) return structuredDays
  return durationDaysFromSig(legacyLinkSig)
}

/** Number of doses taken over `days` at `frequencyCode`; null when not computable (PRN). */
export function dosesInDays(days: number, frequencyCode: string | null | undefined): number | null {
  const perDay = dosesPerDay(frequencyCode)
  if (perDay == null || days <= 0) return null
  return Math.max(1, Math.floor(days * perDay + 1e-9))
}

/**
 * Days supply and dispense quantity.
 *
 * Duration set (WO-96 fix): days supply = the duration; dispense =
 * doses in that many days × dose, in the formulation's dispense unit —
 * 10 units weekly for 30 days at 5 mg/mL → 4 doses → 0.4 mL.
 *
 * No duration: days supply from dose × frequency × quantity, dispense =
 * the quantity. Returns null only when there is neither a duration nor a
 * quantity with a number in it. Days supply is null when the frequency
 * is PRN or the dose cannot be expressed in the dispense unit.
 */
export function computeDispense(input: DispenseInput): DerivedDispense | null {
  const qty = parseQuantityLabel(input.quantityLabel, input.dosageFormName)
  const duration = typeof input.durationDays === 'number' && input.durationDays > 0 ? Math.floor(input.durationDays) : null

  if (duration != null) {
    const unit = dispenseUnitFor(input.dosageFormName, input.doseUnit)
    const perDose = perDoseInDispenseUnit(input, { value: 1, unit, isContainer: false })
    const doses = dosesInDays(duration, input.frequencyCode)
    if (perDose != null && perDose > 0 && doses != null) {
      return { daysSupply: duration, dispenseQuantity: round2(doses * perDose), dispenseUnit: unit }
    }
    // Duration known but the dose can't be converted (PRN, clicks, …):
    // the days supply is still the duration; dispense is the package.
    return {
      daysSupply:       duration,
      dispenseQuantity: qty ? round2(qty.value) : 1,
      dispenseUnit:     qty ? qty.unit : unit,
    }
  }

  if (!qty) return null

  const result: DerivedDispense = {
    daysSupply:       null,
    dispenseQuantity: round2(qty.value),
    dispenseUnit:     qty.unit,
  }
  if (qty.isContainer) return result

  const perDay = dosesPerDay(input.frequencyCode)
  const perDose = perDoseInDispenseUnit(input, qty)
  if (perDay == null || perDose == null || perDose <= 0) return result

  const dailyUse = perDose * perDay
  if (dailyUse <= 0) return result
  result.daysSupply = Math.max(1, Math.floor(qty.value / dailyUse + 1e-9))
  return result
}

/**
 * Default quantity for the Quantity dropdown (WO-96 fix, rule 2 — no
 * required field without a default). From the labels the selected
 * pharmacy already lists ("2.5mL vial", "5mL vial"):
 *   - with a computed dispense quantity: the smallest package in the same
 *     unit that covers it; if none covers it, the largest such package
 *   - without one: the smallest package in the dispense unit
 *   - labels that name only containers ("1 vial"): the smallest count
 *   - no usable label at all: the first label, or "1" when the pharmacy
 *     lists nothing
 * This reads the existing available_quantities strings only. Formulations
 * a pharmacy sells in more than one priced package use suggestPackage
 * (WO-101) instead.
 */
export function defaultQuantityLabel(
  labels: ReadonlyArray<string> | null | undefined,
  dispense: { quantity: number | null | undefined; unit: string | null | undefined } | null,
  dosageFormName: string | null | undefined,
): string {
  const list = (labels ?? []).filter(l => typeof l === 'string' && l.trim())
  if (list.length === 0) return '1'

  const parsed = list
    .map(label => ({ label, q: parseQuantityLabel(label, dosageFormName) }))
    .filter((x): x is { label: string; q: ParsedQuantity } => x.q != null)

  const unit = dispense?.unit ?? null
  const measured = parsed
    .filter(x => !x.q.isContainer && (unit == null || x.q.unit === unit))
    .sort((a, b) => a.q.value - b.q.value)

  if (measured.length > 0) {
    const need = dispense?.quantity
    if (typeof need === 'number' && need > 0) {
      const covering = measured.find(x => x.q.value + 1e-9 >= need)
      return (covering ?? measured[measured.length - 1]!).label
    }
    return measured[0]!.label
  }

  const containers = parsed.filter(x => x.q.isContainer).sort((a, b) => a.q.value - b.q.value)
  if (containers.length > 0) return containers[0]!.label
  return list[0]!
}

// ── WO-101: package (vial size) suggestion ──────────────────

/** An active pharmacy_formulation_packages row, as the builder and margin page use it. */
export interface PackageOption {
  id:             string
  label:          string
  qty:            number
  unit:           string
  wholesalePrice: number
  isDefault:      boolean
}

/** WO-101a: most packages one order line may carry (orders.package_count CHECK). */
export const MAX_PACKAGE_COUNT = 20

/**
 * A suggested package and how many of it.
 *   covers   — one package holds the dispense quantity (count 1)
 *   multiple — none does; `count` of this package do (count > 1)
 *   capped   — even MAX_PACKAGE_COUNT of the best package fall short;
 *              count is MAX_PACKAGE_COUNT and the UI says it does not cover
 *   default  — nothing to size from (no duration, uncountable dose); count 1
 */
export interface PackageSuggestion {
  package:          PackageOption
  count:            number
  reason:           'covers' | 'multiple' | 'capped' | 'default'
  daysSupply:       number | null
  /** The dispense quantity sized against (package unit); null for 'default'. */
  dispenseQuantity: number | null
}

/**
 * Whole packages of `pkg` needed for `dispenseQuantity`, between 1 and
 * MAX_PACKAGE_COUNT. Unknown quantity → 1.
 */
export function packageCountFor(pkg: Pick<PackageOption, 'qty'>, dispenseQuantity: number | null | undefined): number {
  if (typeof dispenseQuantity !== 'number' || !(dispenseQuantity > 0) || !(pkg.qty > 0)) return 1
  const needed = Math.ceil(dispenseQuantity / pkg.qty - 1e-9)
  return Math.min(MAX_PACKAGE_COUNT, Math.max(1, needed))
}

/** "5 mL vial" × 1 → "5 mL vial"; × 2 → "2 × 5 mL vials". */
export function formatPackageCount(label: string, count: number | null | undefined): string {
  const n = typeof count === 'number' && count > 1 ? Math.trunc(count) : 1
  if (n === 1) return label
  const plural = /\b(vial|bottle|tube|pen|kit|syringe|jar|pump|cartridge)$/i.test(label.trim()) ? `${label.trim()}s` : label.trim()
  return `${n} × ${plural}`
}

/**
 * Dispense line with the packaging a pharmacy fills it from:
 * "9.6 mL (2 × 5 mL vials)", "0.4 mL (1 × 1 mL vial)". No package → the
 * plain dispense ("0.4 mL"), exactly as before WO-101a.
 */
export function formatDispenseWithPackage(
  quantity: number | null | undefined,
  unit: string | null | undefined,
  packageLabel: string | null | undefined,
  packageCount: number | null | undefined,
): string | null {
  const base = formatDispense(quantity, unit)
  const label = typeof packageLabel === 'string' && packageLabel.trim() ? packageLabel.trim() : null
  if (!label) return base
  const n = typeof packageCount === 'number' && packageCount > 1 ? Math.trunc(packageCount) : 1
  const packaging = n === 1 ? `1 × ${label}` : formatPackageCount(label, n)
  return base ? `${base} (${packaging})` : packaging
}

/** Snake-case package rows (API / Supabase) → PackageOption, active only, smallest first. */
export function packageOptionsFromRows(rows: ReadonlyArray<{
  id: string
  package_label: string
  package_qty: number | string
  package_unit: string
  wholesale_price: number | string
  is_default: boolean
  active: boolean
}> | null | undefined): PackageOption[] {
  return (rows ?? [])
    .filter(r => r.active)
    .map(r => ({
      id:             r.id,
      label:          r.package_label,
      qty:            Number(r.package_qty),
      unit:           r.package_unit,
      wholesalePrice: Number(r.wholesale_price),
      isDefault:      r.is_default,
    }))
    .sort((a, b) => a.qty - b.qty || a.label.localeCompare(b.label))
}

/**
 * Which package to suggest, and how many (Gina Rooks 2026-09-11 item 3;
 * WO-101, WO-101a).
 *
 * The dispense quantity comes from computeDispense — the WO-96 fix
 * derivation (doses in the selected duration × dose, in the dispense
 * unit). In order:
 *   1. the smallest active package, in that unit, whose package_qty is ≥
 *      the dispense quantity → that package, count 1;
 *   2. otherwise the package needing the fewest whole units to reach it,
 *      ties broken by lower total wholesale, then the smaller package;
 *      count = ceil(dispense / package_qty), at most MAX_PACKAGE_COUNT;
 *   3. no duration, or a dose that can't be counted (PRN, unmatched
 *      units) → the pharmacy's default package, count 1.
 */
export function suggestPackage(
  packages: ReadonlyArray<PackageOption>,
  input: Omit<DispenseInput, 'quantityLabel'>,
): PackageSuggestion | null {
  if (packages.length === 0) return null
  const fallbackPackage = packages.find(p => p.isDefault) ?? packages[0]!
  const fallback: PackageSuggestion = { package: fallbackPackage, count: 1, reason: 'default', daysSupply: null, dispenseQuantity: null }

  const duration = typeof input.durationDays === 'number' && input.durationDays > 0 ? input.durationDays : null
  if (duration == null || dosesInDays(duration, input.frequencyCode) == null) return fallback
  // Only a dose computeDispense can count (it otherwise falls back to
  // "one package", which says nothing about size).
  const unit = dispenseUnitFor(input.dosageFormName, input.doseUnit)
  const perDose = perDoseInDispenseUnit({ ...input, quantityLabel: null }, { value: 1, unit, isContainer: false })
  if (perDose == null || perDose <= 0) return fallback
  const dispense = computeDispense({ ...input, quantityLabel: null })
  if (!dispense) return fallback
  return suggestPackageForDispense(packages, dispense, input.dosageFormName)
}

/**
 * The sizing half of suggestPackage, from a dispense quantity already
 * known (WO-102 re-route prices a Review line at another pharmacy from the
 * line's stored dispense). Same rule: smallest covering package, else the
 * fewest whole units / cheapest total / smaller package, capped.
 */
export function suggestPackageForDispense(
  packages: ReadonlyArray<PackageOption>,
  dispense: Pick<DerivedDispense, 'dispenseQuantity' | 'dispenseUnit'> & { daysSupply?: number | null },
  dosageFormName: string | null | undefined,
): PackageSuggestion | null {
  if (packages.length === 0) return null
  const fallbackPackage = packages.find(p => p.isDefault) ?? packages[0]!
  const fallback: PackageSuggestion = { package: fallbackPackage, count: 1, reason: 'default', daysSupply: null, dispenseQuantity: null }
  if (!(dispense.dispenseQuantity > 0)) return fallback

  // Compare in the dispense unit: "1 mL" packages against mL, "30 count"
  // capsule packages against capsules (parseQuantityLabel infers the unit
  // from the dosage form when the label's token isn't one it knows).
  const sameUnit = packages
    .filter(p => parseQuantityLabel(`${p.qty} ${p.unit}`, dosageFormName)?.unit === dispense.dispenseUnit)
    .sort((a, b) => a.qty - b.qty)
  if (sameUnit.length === 0) return fallback

  const need = dispense.dispenseQuantity
  const base = { daysSupply: dispense.daysSupply ?? null, dispenseQuantity: need }

  const covering = sameUnit.find(p => p.qty + 1e-9 >= need)
  if (covering) return { ...base, package: covering, count: 1, reason: 'covers' }

  // No single package holds it: fewest whole units, then cheapest total,
  // then the smaller package.
  const ranked = sameUnit
    .map(p => {
      const units = Math.max(1, Math.ceil(need / p.qty - 1e-9))
      return { p, units, totalCents: Math.round(p.wholesalePrice * 100) * units }
    })
    .sort((a, b) => a.units - b.units || a.totalCents - b.totalCents || a.p.qty - b.p.qty)
  const best = ranked[0]!
  if (best.units > MAX_PACKAGE_COUNT) {
    return { ...base, package: best.p, count: MAX_PACKAGE_COUNT, reason: 'capped' }
  }
  return { ...base, package: best.p, count: best.units, reason: 'multiple' }
}

// ── API body validation + column mapping ────────────────────

export type RxDetailsValidation =
  | { ok: true;  details: RxDetails }
  | { ok: false; error: string }

/**
 * Validate the `rxDetails` object POST /api/orders receives. Missing
 * object → defaults (older clients keep working). Unknown enum values
 * and out-of-range numbers are rejected rather than coerced.
 */
export function validateRxDetailsBody(raw: unknown): RxDetailsValidation {
  if (raw == null) return { ok: true, details: defaultRxDetails(null) }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'rxDetails must be an object' }
  }
  const r = raw as Record<string, unknown>

  const daysSupply = optionalPositiveInt(r['daysSupply'])
  if (daysSupply === false) return { ok: false, error: 'rxDetails.daysSupply must be a positive integer' }

  const dispenseQuantity = optionalPositiveNumber(r['dispenseQuantity'])
  if (dispenseQuantity === false) return { ok: false, error: 'rxDetails.dispenseQuantity must be a positive number' }

  const dispenseUnit = optionalText(r['dispenseUnit'], 32)
  if (dispenseUnit === false) return { ok: false, error: 'rxDetails.dispenseUnit must be a short string' }

  let refills = 0
  if (r['refills'] != null) {
    const n = r['refills']
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > MAX_REFILLS) {
      return { ok: false, error: `rxDetails.refills must be an integer between 0 and ${MAX_REFILLS}` }
    }
    refills = n
  }

  let substitutionAllowed = true
  if (r['substitutionAllowed'] != null) {
    if (typeof r['substitutionAllowed'] !== 'boolean') {
      return { ok: false, error: 'rxDetails.substitutionAllowed must be a boolean' }
    }
    substitutionAllowed = r['substitutionAllowed']
  }

  let syringeOption: SyringeOption = 'none'
  if (r['syringeOption'] != null) {
    if (!isSyringeOption(r['syringeOption'])) {
      return { ok: false, error: 'rxDetails.syringeOption must be one of sc_kit | im_kit | insulin_syringe | none' }
    }
    syringeOption = r['syringeOption']
  }

  let shippingType: ShippingType = 'standard'
  if (r['shippingType'] != null) {
    if (!isShippingType(r['shippingType'])) {
      return { ok: false, error: 'rxDetails.shippingType must be one of standard | cold_chain' }
    }
    shippingType = r['shippingType']
  }

  const clinicalDifference = optionalText(r['clinicalDifference'], 500)
  if (clinicalDifference === false) return { ok: false, error: 'rxDetails.clinicalDifference must be a string of at most 500 characters' }
  const diagnosisCode = optionalText(r['diagnosisCode'], 16)
  if (diagnosisCode === false) return { ok: false, error: 'rxDetails.diagnosisCode must be a string of at most 16 characters' }
  const diagnosisText = optionalText(r['diagnosisText'], 200)
  if (diagnosisText === false) return { ok: false, error: 'rxDetails.diagnosisText must be a string of at most 200 characters' }
  const specialInstructions = optionalText(r['specialInstructions'], 1000)
  if (specialInstructions === false) return { ok: false, error: 'rxDetails.specialInstructions must be a string of at most 1000 characters' }

  return {
    ok: true,
    details: {
      daysSupply,
      dispenseQuantity,
      dispenseUnit,
      refills,
      substitutionAllowed,
      syringeOption,
      shippingType,
      clinicalDifference,
      diagnosisCode,
      diagnosisText,
      specialInstructions,
    },
  }
}

/** snake_case column values for the `orders` insert. */
export interface RxDetailColumns {
  days_supply:          number | null
  dispense_quantity:    number | null
  dispense_unit:        string | null
  refills:              number
  substitution_allowed: boolean
  syringe_option:       SyringeOption
  shipping_type:        ShippingType
  clinical_difference:  string | null
  diagnosis_code:       string | null
  diagnosis_text:       string | null
  special_instructions: string | null
}

export const RX_DETAIL_COLUMN_LIST =
  'days_supply, dispense_quantity, dispense_unit, refills, substitution_allowed, syringe_option, shipping_type, clinical_difference, diagnosis_code, diagnosis_text, special_instructions'

export function rxDetailsToColumns(d: RxDetails): RxDetailColumns {
  return {
    days_supply:          d.daysSupply,
    dispense_quantity:    d.dispenseQuantity,
    dispense_unit:        d.dispenseUnit,
    refills:              d.refills,
    substitution_allowed: d.substitutionAllowed,
    syringe_option:       d.syringeOption,
    shipping_type:        d.shippingType,
    clinical_difference:  d.clinicalDifference,
    diagnosis_code:       d.diagnosisCode,
    diagnosis_text:       d.diagnosisText,
    special_instructions: d.specialInstructions,
  }
}

/** Read the columns back off an `orders` row (any missing column → default). */
export function rxDetailsFromRow(row: Partial<Record<keyof RxDetailColumns, unknown>> | null | undefined): RxDetails {
  const r = row ?? {}
  const syringe = r.syringe_option
  const shipping = r.shipping_type
  return {
    daysSupply:          numOrNull(r.days_supply),
    dispenseQuantity:    numOrNull(r.dispense_quantity),
    dispenseUnit:        strOrNull(r.dispense_unit),
    refills:             clampRefills(numOrNull(r.refills)),
    substitutionAllowed: r.substitution_allowed !== false,
    syringeOption:       isSyringeOption(syringe) ? syringe : 'none',
    shippingType:        isShippingType(shipping) ? shipping : 'standard',
    clinicalDifference:  strOrNull(r.clinical_difference),
    diagnosisCode:       strOrNull(r.diagnosis_code),
    diagnosisText:       strOrNull(r.diagnosis_text),
    specialInstructions: strOrNull(r.special_instructions),
  }
}

// ── Display helpers (shared by PDF + UI) ────────────────────

export function syringeOptionLabel(v: SyringeOption | string | null | undefined): string {
  return SYRINGE_OPTIONS.find(o => o.value === v)?.label ?? 'None'
}

export function shippingTypeLabel(v: ShippingType | string | null | undefined): string {
  return SHIPPING_TYPES.find(o => o.value === v)?.label ?? 'Standard'
}

export function formatDispense(quantity: number | null | undefined, unit: string | null | undefined): string | null {
  if (quantity == null) return null
  const q = Number.isInteger(quantity) ? String(quantity) : String(round2(quantity))
  if (!unit) return q
  const plural = quantity !== 1 && /^(capsule|tablet|troche|vial|bottle|tube|pen|kit|unit)$/.test(unit)
  return `${q} ${unit}${plural ? 's' : ''}`
}

export function formatDiagnosis(code: string | null | undefined, text: string | null | undefined): string | null {
  const c = blankToNull(code)
  const t = blankToNull(text)
  if (c && t) return `${c} — ${t}`
  return c ?? t ?? null
}

// ── Internal helpers ────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function clampRefills(n: number | null | undefined): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0
  return Math.min(MAX_REFILLS, Math.max(0, Math.trunc(n)))
}

function blankToNull(v: string | null | undefined): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length > 0 ? t : null
}

function numOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' ? blankToNull(v) : null
}

/** null → null; positive integer → itself; anything else → false. */
function optionalPositiveInt(v: unknown): number | null | false {
  if (v == null) return null
  if (typeof v === 'number' && Number.isInteger(v) && v > 0) return v
  return false
}

function optionalPositiveNumber(v: unknown): number | null | false {
  if (v == null) return null
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return round2(v)
  return false
}

function optionalText(v: unknown, max: number): string | null | false {
  if (v == null) return null
  if (typeof v !== 'string') return false
  const t = v.trim()
  if (t.length === 0) return null
  if (t.length > max) return false
  return t
}
