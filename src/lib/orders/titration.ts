// ============================================================
// WO-105: titration as structured steps (pure)
// ============================================================
//
// A titration is a list of steps — "do this for the first four weeks, do
// this for the next four weeks" — not a sentence. Gina Rooks, 2026-09-11
// (docs/practitioner-feedback/2026-09-11-product-run-thru-transcript.md,
// 00:57:56): "I would see the titration as like at least a different box
// for like each next step... some pharmacies don't really like you to
// send things like free text written like this because it's like too
// vague for them with titrations."
//
// Everything WO-96 / WO-101 / WO-101a / WO-102 derives assumes one dose
// for the whole duration: computeDispense takes a single dose, frequency
// and duration; suggestPackage covers a single product. A titration has
// no single dose, so its quantity is the sum over steps:
//
//   Semaglutide 5 mg/mL weekly, 10u x 4w, 20u x 4w, 40u x 4w
//     = 0.4 + 0.8 + 1.6 mL = 2.8 mL over 84 days
//
// The single-dose math at the target dose returns 12 x 0.4 = 4.8 mL — a
// 71% overshoot, which is the "script through for like the maximum"
// workaround (transcript, 00:59:00) written into our own arithmetic.
//
// Cycling is deliberately untouched here. It shares computeDispense with
// standard lines, its on/off-day quantity math is wrong today, and it
// gets its own work order; nothing in this module runs for a cycling
// line.
//
// No React, no I/O.

import {
  dosesInDays,
  perDoseInDispenseUnit,
  dispenseUnitFor,
  type DispenseInput,
} from '@/lib/orders/rx-details'
import { FREQUENCY_OPTIONS } from '@/app/(clinic-app)/new-prescription/_components/structured-sig-builder.types'

/** One step of a titration. `dose` is held as the builder holds it: text. */
export interface TitrationStep {
  dose:      string
  unit:      string
  frequency: string
  weeks:     number
}

/** The formulation a titration is filled from. */
export interface TitrationFormulation {
  concentrationValue: number | null | undefined
  concentrationUnit:  string | null | undefined
  dosageFormName:     string | null | undefined
}

export interface TitrationStepDispense {
  step:        TitrationStep
  /** 1-based week the step starts and ends on: weeks 1-4, then 5-8. */
  weekFrom:    number
  weekTo:      number
  days:        number
  /** Doses taken during the step; null when the frequency is PRN. */
  doses:       number | null
  /** Quantity for the step in the dispense unit; null when not derivable. */
  quantity:    number | null
}

export interface TitrationDispense {
  totalDays:     number
  totalQuantity: number
  dispenseUnit:  string
  steps:         TitrationStepDispense[]
}

export const MAX_TITRATION_STEPS = 12
export const MAX_TITRATION_WEEKS = 52

const COUNT_FORMS = new Set(['capsule', 'tablet', 'troche'])
const round2 = (n: number): number => Math.round(n * 100) / 100

function stepDose(step: TitrationStep): number | null {
  const n = parseFloat(String(step.dose ?? ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

/** A step's dose expressed in mg, when the units allow it. */
function stepDoseMg(step: TitrationStep): number | null {
  const dose = stepDose(step)
  if (dose == null) return null
  const unit = (step.unit ?? '').toLowerCase()
  if (unit === 'mg')  return dose
  if (unit === 'mcg') return dose / 1000
  return null
}

// ── Validation ──────────────────────────────────────────────

export type TitrationProblem =
  | 'no_steps'
  | 'incomplete_step'
  | 'too_many_steps'
  | 'too_many_weeks'
  | 'mixed_units'
  | 'crosses_formulations'
  | 'not_derivable'

export interface TitrationValidation {
  ok:       boolean
  problem?: TitrationProblem
  /** Provider-facing message. Says what to do, not what went wrong. */
  message?: string
}

const OK: TitrationValidation = { ok: true }

/**
 * Whether these steps can be filled as ONE line of this formulation.
 *
 * The case this exists for: a ketotifen titration of 0.1 mg then 0.5 mg
 * capsules is two compounded products at two prices, not one line with a
 * bigger number on it. WO-105 keeps multi-strength titrations out of
 * scope, but they must fail loudly — a silent single quantity here is a
 * wrong prescription, and the provider cannot see that it is wrong.
 *
 * Liquids are not affected: one vial strength fills 10, 20 and 40 units,
 * so a varying dose is exactly what a titration of an injectable is.
 */
export function validateTitrationSteps(
  steps: ReadonlyArray<TitrationStep>,
  formulation: TitrationFormulation,
): TitrationValidation {
  if (steps.length === 0) {
    return { ok: false, problem: 'no_steps', message: 'Add at least one titration step.' }
  }
  if (steps.length > MAX_TITRATION_STEPS) {
    return {
      ok: false,
      problem: 'too_many_steps',
      message: `A titration can have at most ${MAX_TITRATION_STEPS} steps. Write the rest as a second prescription.`,
    }
  }

  for (const step of steps) {
    if (stepDose(step) == null || !step.unit || !step.frequency || !(step.weeks > 0)) {
      return {
        ok: false,
        problem: 'incomplete_step',
        message: 'Every step needs a dose, a unit, a frequency and a number of weeks.',
      }
    }
  }

  const totalWeeks = steps.reduce((sum, s) => sum + s.weeks, 0)
  if (totalWeeks > MAX_TITRATION_WEEKS) {
    return {
      ok: false,
      problem: 'too_many_weeks',
      message: `A titration can run at most ${MAX_TITRATION_WEEKS} weeks. Write the rest as a second prescription.`,
    }
  }

  const units = new Set(steps.map(s => (s.unit ?? '').toLowerCase()))
  if (units.size > 1) {
    return {
      ok: false,
      problem: 'mixed_units',
      message: 'Every step must use the same unit. Convert the steps to one unit, or write a second prescription.',
    }
  }

  // Count forms: each strength is its own compounded product.
  const form = (formulation.dosageFormName ?? '').toLowerCase()
  const dispenseUnit = dispenseUnitFor(formulation.dosageFormName, steps[0]!.unit)
  if (COUNT_FORMS.has(dispenseUnit) || [...COUNT_FORMS].some(f => form.includes(f))) {
    const strengths = new Set(steps.map(s => stepDoseMg(s)).filter((mg): mg is number => mg != null))
    if (strengths.size > 1) {
      return {
        ok: false,
        problem: 'crosses_formulations',
        message:
          'These steps use more than one capsule strength, which is more than one compounded product. ' +
          'Add one line per strength — this line can hold the steps at a single strength.',
      }
    }
  }

  if (computeTitrationDispense(steps, formulation) == null) {
    return {
      ok: false,
      problem: 'not_derivable',
      message:
        'The quantity for these steps cannot be computed from this formulation. ' +
        'Check the dose unit, or write the schedule as separate prescriptions.',
    }
  }

  return OK
}

// ── Derivation ──────────────────────────────────────────────

/**
 * Days supply, dispense quantity and the per-step breakdown for a
 * titration: the sum over steps of doses(step) x dose(step).
 *
 * Returns null when no step's quantity is derivable (PRN, "clicks", a
 * dose unit this formulation cannot express). Days supply is the whole
 * schedule either way — the provider still prescribed those weeks — so
 * callers that only need the duration can read `totalDays` from
 * titrationTotalDays.
 */
export function computeTitrationDispense(
  steps: ReadonlyArray<TitrationStep>,
  formulation: TitrationFormulation,
): TitrationDispense | null {
  if (steps.length === 0) return null

  const dispenseUnit = dispenseUnitFor(formulation.dosageFormName, steps[0]!.unit)
  const out: TitrationStepDispense[] = []
  let totalQuantity = 0
  let totalDays = 0
  let derivedAny = false
  let week = 1

  for (const step of steps) {
    const weeks = Number.isFinite(step.weeks) ? Math.floor(step.weeks) : 0
    if (weeks <= 0) return null
    const days = weeks * 7
    const doses = dosesInDays(days, step.frequency)

    const input: DispenseInput = {
      doseAmount:         step.dose,
      doseUnit:           step.unit,
      frequencyCode:      step.frequency,
      quantityLabel:      null,
      concentrationValue: formulation.concentrationValue,
      concentrationUnit:  formulation.concentrationUnit,
      dosageFormName:     formulation.dosageFormName,
    }
    const perDose = perDoseInDispenseUnit(input, { value: 1, unit: dispenseUnit, isContainer: false })
    const quantity = perDose != null && perDose > 0 && doses != null ? round2(doses * perDose) : null

    if (quantity != null) {
      // DELIBERATE: each step is rounded BEFORE it is added, not summed
      // at full precision and rounded once at the end. The per-step rows
      // a pharmacist reads have to add up to the total printed under
      // them; a total that is a cent-equivalent off from its own rows is
      // a total nobody trusts. Do not "fix" this into round2(sum).
      totalQuantity += quantity
      derivedAny = true
    }
    out.push({ step, weekFrom: week, weekTo: week + weeks - 1, days, doses, quantity })
    totalDays += days
    week += weeks
  }

  if (!derivedAny) return null
  // round2 here only clears floating-point dust from adding already-
  // rounded steps (0.4 + 0.8 + 1.6); it is not a second rounding of the
  // raw arithmetic. See the note at the summation above.
  return { totalDays, totalQuantity: round2(totalQuantity), dispenseUnit, steps: out }
}

/** Total days the schedule runs, derivable or not. */
export function titrationTotalDays(steps: ReadonlyArray<TitrationStep>): number {
  return steps.reduce((sum, s) => sum + (Number.isFinite(s.weeks) ? Math.max(0, Math.floor(s.weeks)) * 7 : 0), 0)
}

// ── Rendering ───────────────────────────────────────────────

function frequencySig(code: string): string {
  return FREQUENCY_OPTIONS.find(f => f.code === code)?.sig ?? code
}

/** "Weeks 1–4" — or "Week 1" for a single-week step. */
export function stepWeekLabel(step: Pick<TitrationStepDispense, 'weekFrom' | 'weekTo'>): string {
  return step.weekFrom === step.weekTo ? `Week ${step.weekFrom}` : `Weeks ${step.weekFrom}–${step.weekTo}`
}

export function formatStepQuantity(step: TitrationStepDispense, dispenseUnit: string): string {
  return step.quantity == null ? '—' : `${step.quantity} ${dispenseUnit}`
}

/**
 * The sig sentence a titration still carries. Tier 4 is a fax, so text
 * is the transport and the steps have to read as a sentence there — but
 * it is generated FROM the steps, and the structured steps travel beside
 * it in the Tier 1/2/3 payloads and as a table on the Rx PDF. This is no
 * longer "Titrate up by 0.1mL every 3-4 days as tolerated", which is the
 * free text pharmacies push back on.
 */
export function titrationSigSummary(
  steps: ReadonlyArray<TitrationStep>,
  formulation: TitrationFormulation,
  opts: { prefix?: string; routeName?: string | null; timingSig?: string | null } = {},
): string {
  const derived = computeTitrationDispense(steps, formulation)
  if (!derived) return ''

  const prefix = opts.prefix ?? 'Take'
  const route = opts.routeName ? ` ${opts.routeName.toLowerCase()}` : ''
  const timing = opts.timingSig ? ` ${opts.timingSig}` : ''

  const sentences = derived.steps.map(s => {
    const dose = `${s.step.dose}${s.step.unit ? ` ${s.step.unit}` : ''}`
    return `${stepWeekLabel(s)}: ${prefix.toLowerCase()} ${dose}${route} ${frequencySig(s.step.frequency)}${timing}.`
  })

  const total = `Total dispense ${derived.totalQuantity} ${derived.dispenseUnit} over ${derived.totalDays} days.`
  return `${sentences.join(' ')} ${total}`
}

/**
 * The same schedule in plain language for the patient at checkout, with
 * the total restated at the end — Lauren Perkins, 2026-09-11 (00:59:49):
 * "this is the total amount, here's like the titration schedule and just
 * recapping it. So it's like for both the patient and the pharmacy."
 */
export function titrationPatientSchedule(
  steps: ReadonlyArray<TitrationStep>,
  formulation: TitrationFormulation,
): { lines: string[]; total: string } | null {
  const derived = computeTitrationDispense(steps, formulation)
  if (!derived) return null

  const lines = derived.steps.map(s => {
    const weeks = s.days / 7
    const span = weeks === 1 ? '1 week' : `${weeks} weeks`
    return `${stepWeekLabel(s)} (${span}): ${s.step.dose} ${s.step.unit} ${frequencySig(s.step.frequency)}`
  })

  const weeksTotal = derived.totalDays / 7
  return {
    lines,
    total: `That is ${derived.totalQuantity} ${derived.dispenseUnit} in total, covering ${derived.totalDays} days (${weeksTotal} weeks). It is dispensed once, at the start.`,
  }
}

// ── Storage shape ───────────────────────────────────────────

/**
 * Read steps back off an order / favorite row (orders.titration_steps).
 * Anything that is not a well-formed step list reads as no titration —
 * a malformed row must never become a quantity.
 */
export function parseTitrationSteps(raw: unknown): TitrationStep[] {
  if (!Array.isArray(raw)) return []
  const steps: TitrationStep[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item == null) return []
    const r = item as Record<string, unknown>
    const dose = typeof r['dose'] === 'string' ? r['dose'] : typeof r['dose'] === 'number' ? String(r['dose']) : null
    const unit = typeof r['unit'] === 'string' ? r['unit'] : null
    const frequency = typeof r['frequency'] === 'string' ? r['frequency'] : null
    const weeksRaw = r['weeks']
    const weeks = typeof weeksRaw === 'number' ? weeksRaw : parseInt(String(weeksRaw ?? ''), 10)
    if (!dose || !unit || !frequency || !Number.isFinite(weeks) || weeks <= 0) return []
    steps.push({ dose, unit, frequency, weeks: Math.floor(weeks) })
  }
  return steps.length > MAX_TITRATION_STEPS ? [] : steps
}

export type SigMode = 'standard' | 'titration' | 'cycling'

export function isSigMode(v: unknown): v is SigMode {
  return v === 'standard' || v === 'titration' || v === 'cycling'
}
