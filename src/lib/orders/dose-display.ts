// ============================================================
// WO-103: Dose display — units ↔ mL ↔ mg conversion (pure)
// ============================================================
//
// One place for the syringe-units / mL / mg arithmetic the app shows
// next to a dose. Used by the structured sig builder (sig text), the
// margin page and Review card (dose line), the Favorites panel (list
// items: "10 units (0.5 mg) weekly") and the favorite edit form (sig
// regeneration). No React, no I/O.
//
// Conventions (shared with computeDispense in rx-details.ts):
//   - 100 syringe units = 1 mL (U-100 insulin syringe)
//   - mg = mL × concentration_value when concentration_unit is mg/mL
//   - mcg = mg / 1000
//
// Phase 21 rule 3: the mg equivalent is always computed, never typed.

import { FREQUENCY_OPTIONS, TIMING_OPTIONS } from '@/app/(clinic-app)/new-prescription/_components/structured-sig-builder.types'

export interface ConcentrationSource {
  concentration_value: number | null | undefined
  concentration_unit:  string | null | undefined
}

export interface DoseDisplayFormulation extends ConcentrationSource {
  dosage_forms: { name: string } | null | undefined
}

export const UNITS_PER_ML = 100

function parseDose(doseAmount: string | number | null | undefined): number | null {
  const n = typeof doseAmount === 'number' ? doseAmount : parseFloat(String(doseAmount ?? ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

export function isMgPerMl(concentrationUnit: string | null | undefined): boolean {
  return (concentrationUnit ?? '').trim().toLowerCase() === 'mg/ml'
}

/**
 * Per-dose amount in mg, or null when it cannot be derived (unknown
 * unit, no mg/mL concentration, tablet/capsule doses, blank dose).
 *
 *   10 units of a 5 mg/mL vial → 0.1 mL → 0.5 mg
 *   0.5 mL of a 5 mg/mL vial   → 2.5 mg
 *   2 mg                       → 2 mg (no concentration needed)
 *   500 mcg                    → 0.5 mg
 */
export function computeDoseMg(
  doseAmount: string | number | null | undefined,
  doseUnit: string | null | undefined,
  concentration: ConcentrationSource | null | undefined,
): number | null {
  const dose = parseDose(doseAmount)
  if (dose == null) return null
  const unit = (doseUnit ?? '').trim().toLowerCase()
  if (unit === 'mg') return dose
  if (unit === 'mcg') return dose / 1000

  const conc = concentration?.concentration_value ?? null
  if (!conc || conc <= 0 || !isMgPerMl(concentration?.concentration_unit)) return null
  if (unit === 'units' || unit === 'unit') return (dose / UNITS_PER_ML) * conc
  if (unit === 'ml') return dose * conc
  return null
}

/**
 * "0.5 mg", "1.0 mg", "0.25 mg", "12.5 mg". Always at least one decimal
 * so 1 mg reads "1.0 mg" (the AC string), never more than two.
 */
export function formatMg(mg: number): string {
  const fixed = (Math.round(mg * 100) / 100).toFixed(2)
  return `${fixed.endsWith('0') ? fixed.slice(0, -1) : fixed} mg`
}

/** "10 units" / "0.5 mL" / "2 mg" / "1 tablet" / "2 tablets" — no conversion. */
export function formatPlainDose(doseAmount: string | number | null | undefined, doseUnit: string | null | undefined): string {
  const amount = String(doseAmount ?? '').trim()
  const unit = (doseUnit ?? '').trim()
  if (!amount) return unit
  const n = parseDose(amount)
  const plural = n != null && n !== 1
  const label =
    unit === 'tablet'  ? (plural ? 'tablets'  : 'tablet')  :
    unit === 'capsule' ? (plural ? 'capsules' : 'capsule') :
    unit === 'click'   ? (plural ? 'clicks'   : 'click')   :
    unit
  return `${amount} ${label}`.trim()
}

/**
 * The dose with its mg equivalent in parentheses when one can be
 * derived and the dose is not already in mg: "10 units (0.5 mg)",
 * "0.1 mL (0.5 mg)", "2 mg", "1 tablet".
 */
export function formatDoseWithMg(
  doseAmount: string | number | null | undefined,
  doseUnit: string | null | undefined,
  concentration: ConcentrationSource | null | undefined,
): string {
  const plain = formatPlainDose(doseAmount, doseUnit)
  const unit = (doseUnit ?? '').trim().toLowerCase()
  if (unit === 'mg') return plain
  const mg = computeDoseMg(doseAmount, doseUnit, concentration)
  return mg == null ? plain : `${plain} (${formatMg(mg)})`
}

// ── Frequency words ─────────────────────────────────────────

/** Short frequency word for list items and favorite names: QW → "weekly". */
export const FREQUENCY_SHORT_LABEL: Record<string, string> = {
  QD:  'daily',
  BID: 'twice daily',
  TID: 'three times daily',
  QID: 'four times daily',
  QHS: 'at bedtime',
  QW:  'weekly',
  Q2W: 'every 2 weeks',
  QOD: 'every other day',
  MF:  'Mon–Fri',
  TIW: '2-3× weekly',
  PRN: 'as needed',
}

export function frequencyShortLabel(frequencyCode: string | null | undefined): string {
  const code = (frequencyCode ?? '').trim().toUpperCase()
  if (!code) return ''
  return FREQUENCY_SHORT_LABEL[code] ?? FREQUENCY_OPTIONS.find(f => f.code === code)?.sig ?? code.toLowerCase()
}

export interface FavoriteDoseInput {
  doseAmount:    string | number | null | undefined
  doseUnit:      string | null | undefined
  frequencyCode: string | null | undefined
  concentration: ConcentrationSource | null | undefined
}

/** Favorites list line: "10 units (0.5 mg) weekly". Empty string when no dose. */
export function formatFavoriteDose(input: FavoriteDoseInput): string {
  const dose = formatDoseWithMg(input.doseAmount, input.doseUnit, input.concentration)
  const freq = frequencyShortLabel(input.frequencyCode)
  return [dose, freq].filter(Boolean).join(' ').trim()
}

/** Default favorite name: "<Drug> <dose> <freq>" → "Semaglutide 10 units weekly". */
export function defaultFavoriteName(
  drugName: string | null | undefined,
  doseAmount: string | number | null | undefined,
  doseUnit: string | null | undefined,
  frequencyCode: string | null | undefined,
): string {
  const dose = formatPlainDose(doseAmount, doseUnit)
  const freq = frequencyShortLabel(frequencyCode)
  return [(drugName ?? '').trim(), dose, freq].filter(Boolean).join(' ').trim()
}

// ── Sig dose display (moved from structured-sig-builder.tsx) ─

/**
 * The dose phrase inside a generated sig. Injectables with an mg/mL
 * concentration show all three units — "10 units (0.10mL / 0.50mg)";
 * oral solutions show mL (mg); everything else is the plain dose.
 * Behaviour is unchanged from the WO-84 builder.
 */
export function computeDoseDisplay(
  doseAmount: string,
  doseUnit: string,
  formulation: DoseDisplayFormulation,
): string {
  const doseNum = parseFloat(doseAmount)
  if (!doseAmount || isNaN(doseNum)) return `${doseAmount} ${doseUnit}`.trim()

  const concVal = formulation.concentration_value
  const concUnit = formulation.concentration_unit
  const isInjectable = formulation.dosage_forms?.name?.includes('Injectable') ?? false
  const isOralSolution = (formulation.dosage_forms?.name?.includes('Solution') ?? false) && !isInjectable

  if (concVal && concUnit === 'mg/mL') {
    if (isInjectable) {
      if (doseUnit === 'mg') {
        const mL = doseNum / concVal
        const units = Math.round(mL * UNITS_PER_ML)
        return `${units} units (${mL.toFixed(2)}mL / ${doseNum}mg)`
      } else if (doseUnit === 'units') {
        const mL = doseNum / UNITS_PER_ML
        const mg = mL * concVal
        return `${doseNum} units (${mL.toFixed(2)}mL / ${mg.toFixed(2)}mg)`
      } else if (doseUnit === 'mL') {
        const mg = doseNum * concVal
        const units = Math.round(doseNum * UNITS_PER_ML)
        return `${units} units (${doseNum}mL / ${mg.toFixed(2)}mg)`
      }
    } else if (isOralSolution) {
      if (doseUnit === 'mg') {
        const mL = doseNum / concVal
        return `${mL.toFixed(1)}mL (${doseNum}mg)`
      } else if (doseUnit === 'mL') {
        const mg = doseNum * concVal
        return `${doseNum}mL (${mg.toFixed(2)}mg)`
      }
    }
  }

  return formatPlainDose(doseAmount, doseUnit)
}

export interface StandardSigInput {
  doseAmount:    string
  doseUnit:      string
  frequencyCode: string | null | undefined
  timingCode?:   string | null | undefined
  formulation:   DoseDisplayFormulation & {
    routes_of_administration: { name: string; sig_prefix: string } | null | undefined
  }
}

/**
 * The standard (non-titration, non-cycling) sig the builder would
 * generate for these inputs: "Inject 10 units (0.10mL / 0.50mg)
 * subcutaneously once weekly". Used when a favorite's dose is edited so
 * the stored sig follows the dose instead of going stale.
 */
export function buildStandardSig(input: StandardSigInput): string {
  if (!input.doseAmount || !input.frequencyCode) return ''
  const route = input.formulation.routes_of_administration
  const prefix = route?.sig_prefix ?? 'Take'
  const freq = FREQUENCY_OPTIONS.find(f => f.code === input.frequencyCode)
  const timing = TIMING_OPTIONS.find(t => t.code === (input.timingCode ?? ''))
  const doseDisplay = computeDoseDisplay(input.doseAmount, input.doseUnit, input.formulation)
  const routeText = route?.name ? ` ${route.name.toLowerCase()}` : ''
  let sig = `${prefix} ${doseDisplay}${routeText} ${freq?.sig ?? input.frequencyCode}`.trim()
  // QHS already says "at bedtime".
  if (timing?.sig && !(input.frequencyCode === 'QHS' && input.timingCode === 'BEDTIME')) sig += ` ${timing.sig}`
  return sig
}

/** Dose units a favorite may be edited to. Mirrors the builder's unit select. */
export const DOSE_UNITS = ['mg', 'mL', 'units', 'mcg', 'tablet', 'capsule', 'click'] as const
export type DoseUnit = (typeof DOSE_UNITS)[number]

export function isDoseUnit(v: unknown): v is DoseUnit {
  return typeof v === 'string' && (DOSE_UNITS as ReadonlyArray<string>).includes(v)
}
