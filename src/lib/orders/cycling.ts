// ============================================================
// Cycling dose math — count the days a patient actually doses
// ============================================================
//
// A cycling line ("5 days on / 2 days off") was sized as if the patient
// dosed every day of the span. The patient doses on the on-days only.
//
// The rule, stated once and used everywhere a cycling quantity is
// computed (builder, price step, Review, refill, pharmacy payloads):
//
//   dosing days = full cycles × on-days
//               + the on-days in the final partial cycle
//
// The course is ASSUMED TO START ON AN ON-DAY. That gives the most
// dosing days a span can hold, so the patient is never under-supplied.
// Days supply stays the calendar span. 5 on / 2 off for 30 days = 22.
//
// Mon-Fri is the same rule with a 5 / 2 week (MON_FRI): 30 days → 22,
// 28 → 20.
//
// The pattern is stored structured (orders / provider_favorites /
// protocol_items .cycle_on_days, .cycle_off_days; migration
// 20260924000001), never read back out of the sig. An order written
// before that has no pattern and is never assumed to dose daily: it
// stops at the dose step and asks.
//
// Pure: no React, no I/O.

export interface CyclePattern {
  onDays:  number
  offDays: number
}

/**
 * The pattern plus the course length the builder carries: the cycle
 * length the provider entered, a favorite's cycle_duration_days, or an
 * order's days supply. null = ongoing (sized from the package, like
 * Standard mode's Ongoing).
 */
export interface CycleSchedule extends CyclePattern {
  lengthDays: number | null
}

/** Bounds match the CHECK constraints on the three tables. */
export const MAX_CYCLE_DAYS = 365
export const MAX_CYCLE_LENGTH_DAYS = 3650

/** Mon-Fri (weekends off): a 5 on / 2 off week, starting on Monday. */
export const MON_FRI: CyclePattern = { onDays: 5, offDays: 2 }

function wholeDays(v: unknown, max: number): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? parseInt(v, 10) : NaN
  return Number.isInteger(n) && n >= 1 && n <= max ? n : null
}

/** A pattern only when both halves are whole days in 1–365; otherwise null. */
export function cyclePatternFrom(onDays: unknown, offDays: unknown): CyclePattern | null {
  const on = wholeDays(onDays, MAX_CYCLE_DAYS)
  const off = wholeDays(offDays, MAX_CYCLE_DAYS)
  return on != null && off != null ? { onDays: on, offDays: off } : null
}

/** A course length in whole days (1–3650), or null. */
export function cycleLengthFrom(v: unknown): number | null {
  return wholeDays(v, MAX_CYCLE_LENGTH_DAYS)
}

/** The stored pattern of a row — only on a cycling row, only when both halves are valid. */
export function cyclePatternFromRow(row: {
  sig_mode?:       string | null
  cycle_on_days?:  number | null
  cycle_off_days?: number | null
}): CyclePattern | null {
  if (row.sig_mode !== 'cycling') return null
  return cyclePatternFrom(row.cycle_on_days, row.cycle_off_days)
}

/** Dosing days in `days` calendar days, starting on an on-day. */
export function dosingDaysIn(days: number, p: CyclePattern): number {
  const span = Math.max(0, Math.floor(days))
  const cycle = p.onDays + p.offDays
  return Math.floor(span / cycle) * p.onDays + Math.min(span % cycle, p.onDays)
}

/**
 * The calendar days `dosingDays` doses cover, starting on an on-day: the
 * inverse of dosingDaysIn. A package that ends on the last on-day of a
 * cycle lasts through that cycle's off-days (the next dose is due at the
 * start of the next cycle).
 */
export function calendarDaysForDosingDays(dosingDays: number, p: CyclePattern): number {
  const n = Math.max(0, Math.floor(dosingDays))
  const full = Math.floor(n / p.onDays)
  const rest = n % p.onDays
  return full * (p.onDays + p.offDays) + rest
}

/** The builder's "Cycle for N days | weeks | months" → days (a month is 30 days). Ongoing / blank → null. */
export function cycleLengthDays(value: string, unit: string): number | null {
  if (unit === 'ongoing') return null
  const n = parseInt(value, 10)
  if (!Number.isFinite(n) || n <= 0 || !/^\s*\d+\s*$/.test(value)) return null
  const days = unit === 'weeks' ? n * 7 : unit === 'months' ? n * 30 : n
  return days <= MAX_CYCLE_LENGTH_DAYS ? days : null
}

/** The reverse, for opening the builder: 42 → 6 weeks, 30 → 30 days, null → ongoing. */
export function cycleLengthFromDays(days: number | null | undefined): { value: string; unit: 'days' | 'weeks' | 'ongoing' } {
  if (typeof days !== 'number' || !Number.isFinite(days) || days <= 0) return { value: '', unit: 'ongoing' }
  const d = Math.round(days)
  return d % 7 === 0 ? { value: String(d / 7), unit: 'weeks' } : { value: String(d), unit: 'days' }
}

/** "5 days on / 2 days off" */
export function cyclePatternText(p: CyclePattern): string {
  return `${p.onDays} day${p.onDays === 1 ? '' : 's'} on / ${p.offDays} day${p.offDays === 1 ? '' : 's'} off`
}

/** The count and the assumption, as the dose step and price step show it. */
export function dosingDaysSummary(days: number, p: CyclePattern): string {
  const n = dosingDaysIn(days, p)
  return `${n} dosing day${n === 1 ? '' : 's'} in ${days} days (${cyclePatternText(p)}, starting on an on-day)`
}
