// ============================================================
// WO-106: refilling an order (pure)
// ============================================================
//
// Gina Rooks, 2026-09-11
// (docs/practitioner-feedback/2026-09-11-product-run-thru-transcript.md,
// 00:32:29): "from a specific patient perspective, like reordering, you
// want it to be as fast as possible, you know, not re-entering it every
// time."
//
// A refill is a NEW order that points at its source through
// orders.refill_of_order_id. Orders are append-only snapshots, and the
// audit trail and pharmacy submissions key off order_id, so reusing the
// source would rewrite the history of the fill the patient already had.
//
// Three decisions live here, all of them about not lying to a
// prescriber:
//
//   1. Refills used is COUNTED, never stored. A cancelled or refunded
//      refill frees the authorization again, which a decrement on the
//      signed source cannot do.
//   2. A titration refills at its MAINTENANCE dose, not by repeating the
//      ramp. Repeating it re-prescribes weeks the patient has already
//      completed and under-dispenses — the WO-105 overshoot in reverse.
//   3. A package is a snapshot. On refill it is re-suggested against
//      today's active packages, and a price change is shown rather than
//      applied quietly.
//
// No React, no I/O.

import { titrationTotalDays, type TitrationStep } from '@/lib/orders/titration'
import { FREQUENCY_OPTIONS } from '@/app/(clinic-app)/new-prescription/_components/structured-sig-builder.types'

// ── Refill authorization ────────────────────────────────────

/**
 * Statuses that do not consume an authorized refill. The patient never
 * received these, so the authorization is still theirs to use.
 */
export const REFILL_VOID_STATUSES: ReadonlySet<string> = new Set([
  'CANCELLED',
  'REFUNDED',
  'PAYMENT_EXPIRED',
])

export interface RefillCountRow {
  status: string
}

/** Refills of one source that actually consumed an authorization. */
export function refillsUsed(rows: ReadonlyArray<RefillCountRow>): number {
  return rows.filter(r => !REFILL_VOID_STATUSES.has(r.status)).length
}

export interface RefillAllowance {
  allowed:    boolean
  used:       number
  authorized: number
  /** Provider-facing, and only when blocked. Says what to do instead. */
  message?:   string
}

/**
 * Whether one more refill may be written against this order. `refills`
 * is what the prescriber authorized on the source; `used` is counted
 * from orders.refill_of_order_id.
 */
export function refillAllowance(authorizedRefills: number | null | undefined, used: number): RefillAllowance {
  const authorized = typeof authorizedRefills === 'number' && authorizedRefills > 0 ? Math.floor(authorizedRefills) : 0
  if (used >= authorized) {
    return {
      allowed: false,
      used,
      authorized,
      message: authorized === 0
        ? 'This prescription authorized no refills. Write a new prescription.'
        : `All ${authorized} authorized refill${authorized === 1 ? ' has' : 's have'} been used. Write a new prescription.`,
    }
  }
  return { allowed: true, used, authorized }
}

// ── Titration → maintenance dose ────────────────────────────

export interface MaintenanceDose {
  dose:         string
  unit:         string
  frequency:    string
  /** The last step's length, as the refill's duration. */
  durationDays: number
  /** Shown to the provider. The refill is a decision, so it is stated. */
  note:         string
}

function frequencyWords(code: string): string {
  return FREQUENCY_OPTIONS.find(f => f.code === code)?.sig ?? code
}

/**
 * The dose a completed titration refills at: its final step.
 *
 * A patient who finished 10 → 20 → 40 units needs 40 units, not the
 * ramp again. Refilling the schedule would dispense 2.8 mL where they
 * need 4.8 mL, and would tell the pharmacy to start them over.
 *
 * Returns null when the steps are unusable, which reads as "not a
 * titration" — the caller then refills the line as it stands.
 */
export function maintenanceFromTitration(steps: ReadonlyArray<TitrationStep>): MaintenanceDose | null {
  if (steps.length === 0) return null
  const last = steps[steps.length - 1]!
  if (!last.dose || !last.unit || !last.frequency || !(last.weeks > 0)) return null

  const durationDays = Math.max(7, Math.floor(last.weeks) * 7)
  return {
    dose:      last.dose,
    unit:      last.unit,
    frequency: last.frequency,
    durationDays,
    note:
      `Refilling at the maintenance dose, ${last.dose} ${last.unit} ${frequencyWords(last.frequency)}. ` +
      'Change it if the patient is still titrating.',
  }
}

/** Total days the source titration covered — for the "was" line on screen. */
export function titrationSourceDays(steps: ReadonlyArray<TitrationStep>): number {
  return titrationTotalDays(steps)
}

// ── Package re-pricing ──────────────────────────────────────

export interface RefillPackageChange {
  /** null when the source had no package, or the pharmacy prices none today. */
  packageId:     string | null
  packageLabel:  string | null
  packageCount:  number
  /** Cents for the whole line as priced today (package price x count). */
  currentCents:  number
  /** What the source order was priced at, for the "was" line. */
  previousCents: number | null
  /** ISO date of the source order, so the "was" reads "was $285 on 12 Aug". */
  previousAt:    string | null
  /** True when the source's package is no longer one the pharmacy prices. */
  packageChanged: boolean
}

/**
 * The sentence shown when a refill costs a different amount than the
 * order it came from. Null when nothing moved — silence is correct then,
 * and a delta shown for an unchanged price trains people to ignore it.
 */
export function priceDeltaMessage(change: RefillPackageChange): string | null {
  const { currentCents, previousCents, previousAt, packageLabel, packageCount, packageChanged } = change
  if (previousCents == null) return null
  if (!packageChanged && currentCents === previousCents) return null

  const money = (cents: number) => `$${(cents / 100).toFixed(2)}`
  const size = packageLabel ? `${packageCount > 1 ? `${packageCount} × ` : ''}${packageLabel}, ` : ''
  const when = previousAt ? ` on ${formatShortDate(previousAt)}` : ''

  if (packageChanged) {
    return `${size}${money(currentCents)}. The pharmacy no longer prices the size on the original order (${money(previousCents)}${when}).`
  }
  return `${size}${money(currentCents)}, was ${money(previousCents)}${when}.`
}

function formatShortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getUTCDate()} ${d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })}`
}
