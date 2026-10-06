// ============================================================
// A titration that lives only in a protocol sig (pure)
// ============================================================
//
// Protocol items have no structured titration steps: protocol_items
// carries sig_mode and a sentence, "Take 0.1mL by mouth at bedtime.
// Titrate up by 0.1mL every 3-4 days as tolerated up to 0.5mL". Sized as
// a standard line, that is the starting dose every day: Mold/MCAS LDN
// dispensed 0.1 × 56 = 5.6 mL for a schedule that needs 25 mL (prod,
// 2026-10-05).
//
// This is the legacy-data exception to "structured fields first": the
// starting dose and the frequency are the line's structured values; only
// the step, the interval and the ceiling are read from the sentence,
// because the line has nowhere else to carry them. A line WITH structured
// steps (WO-105) never comes here — computeTitrationDispense sizes it.
//
// Assumptions, stated on screen with the quantity (`note`):
//   - an interval written as a range ("every 3-4 days") is sized at its
//     faster end, so the patient never runs short;
//   - once the ceiling is reached it is held to the end of the length;
//   - the length is the protocol's (the sig states none).
//
// No React, no I/O.

import { dispenseUnitFor, dosesPerDay, perDoseInDispenseUnit } from '@/lib/orders/rx-details'

export interface LegacyTitration {
  startDose:    number
  increment:    number
  maxDose:      number
  /** The dose unit, as the line's structured dose writes it ("mL", "mg"). */
  unit:         string
  /** Days between steps, at the faster end of a range. */
  intervalDays: number
  /** The interval as the sig wrote it, for the note. */
  interval:     { from: number; to: number | null; unit: 'days' | 'weeks' }
}

export interface LegacyTitrationInputs {
  frequencyCode:      string | null | undefined
  durationDays:       number | null | undefined
  concentrationValue: number | null | undefined
  concentrationUnit:  string | null | undefined
  dosageFormName:     string | null | undefined
}

export interface LegacyTitrationDispense {
  daysSupply:       number
  dispenseQuantity: number
  dispenseUnit:     string
  /** True when the ceiling is reached inside the length. */
  reachesMax:       boolean
  /** The assumption the quantity rests on, for the provider. */
  note:             string
}

const NUM = String.raw`(\d+(?:\.\d+)?)`
const TITRATION_RE = new RegExp(
  String.raw`\btitrat\w*\s+up\s+by\s+${NUM}\s*([a-z]+)\s+every\s+(\d+)(?:\s*(?:-|–|to)\s*(\d+))?\s*(days?|weeks?)\b[^.]*?\bup\s+to\s+${NUM}\s*([a-z]+)`,
  'i',
)

function normUnit(u: string): string {
  const l = u.trim().toLowerCase()
  if (l === 'ml') return 'ml'
  if (l === 'unit' || l === 'units' || l === 'u') return 'units'
  return l
}

const round2 = (n: number): number => Math.round(n * 100) / 100
const round6 = (n: number): number => Math.round(n * 1e6) / 1e6

/**
 * The titration a protocol sig describes, from the line's structured
 * starting dose. null when the sig describes none this can read, or its
 * units are not the dose's: nothing is guessed.
 */
export function legacyTitrationFromSig(
  sig: string | null | undefined,
  start: { amount: string; unit: string },
): LegacyTitration | null {
  const m = TITRATION_RE.exec(sig ?? '')
  if (!m) return null
  const startDose = parseFloat(start.amount)
  const increment = parseFloat(m[1]!)
  const from = parseInt(m[3]!, 10)
  const to = m[4] ? parseInt(m[4], 10) : null
  const maxDose = parseFloat(m[6]!)
  const unit = normUnit(start.unit)
  if (!unit || normUnit(m[2]!) !== unit || normUnit(m[7]!) !== unit) return null
  if (!(startDose > 0) || !(increment > 0) || !(from > 0) || !(maxDose > startDose)) return null
  const weeks = /^week/i.test(m[5]!)
  const fastest = to != null ? Math.min(from, to) : from
  return {
    startDose, increment, maxDose, unit: start.unit.trim(),
    intervalDays: weeks ? fastest * 7 : fastest,
    interval: { from, to, unit: weeks ? 'weeks' : 'days' },
  }
}

/** Doses taken in the first `day` days, dosing from day 0. */
function dosesBy(day: number, perDay: number): number {
  return Math.ceil(day * perDay - 1e-9)
}

/**
 * Days supply and dispense for the titration over `durationDays`: each
 * interval at its dose, rising by the increment, held at the ceiling.
 * null with no length, a frequency that cannot be counted (PRN), or a
 * dose the formulation cannot express in its dispense unit.
 */
export function legacyTitrationDispense(t: LegacyTitration, input: LegacyTitrationInputs): LegacyTitrationDispense | null {
  const days = typeof input.durationDays === 'number' && input.durationDays > 0 ? Math.floor(input.durationDays) : null
  const perDay = dosesPerDay(input.frequencyCode)
  if (days == null || perDay == null || perDay <= 0) return null
  const dispenseUnit = dispenseUnitFor(input.dosageFormName, t.unit)

  let total = 0
  let day = 0
  let dose = t.startDose
  while (day < days) {
    const atMax = dose >= t.maxDose - 1e-9
    const end = atMax ? days : Math.min(days, day + t.intervalDays)
    const perDose = perDoseInDispenseUnit(
      {
        doseAmount: dose, doseUnit: t.unit, frequencyCode: input.frequencyCode, quantityLabel: null,
        concentrationValue: input.concentrationValue, concentrationUnit: input.concentrationUnit, dosageFormName: input.dosageFormName,
      },
      { value: 1, unit: dispenseUnit, isContainer: false },
    )
    if (perDose == null || !(perDose > 0)) return null
    total += (dosesBy(end, perDay) - dosesBy(day, perDay)) * perDose
    day = end
    dose = Math.min(t.maxDose, round6(dose + t.increment))
  }
  const reachesMax = dose >= t.maxDose - 1e-9
  const dispenseQuantity = round2(total)

  const u = t.unit
  const every = `every ${t.intervalDays % 7 === 0 && t.interval.unit === 'weeks' ? `${t.intervalDays / 7} weeks` : `${t.intervalDays} days`}`
  const schedule = reachesMax
    ? `${t.startDose} ${u}, up ${t.increment} ${u} ${every} to ${t.maxDose} ${u}, then ${t.maxDose} ${u} to day ${days}`
    : `${t.startDose} ${u}, up ${t.increment} ${u} ${every} toward ${t.maxDose} ${u}, over ${days} days`
  const range = t.interval.to != null
    ? ` Every ${t.interval.from}-${t.interval.to} ${t.interval.unit} is counted as ${every}, so the patient does not run short.`
    : ''
  return {
    daysSupply: days,
    dispenseQuantity,
    dispenseUnit,
    reachesMax,
    note: `Quantity sized for the titration in the directions: ${schedule}: ${dispenseQuantity} ${dispenseUnit}.${range} Edit the line to change it.`,
  }
}
