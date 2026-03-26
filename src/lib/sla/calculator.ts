// ============================================================
// SLA Deadline Calculator — WO-24
// ============================================================
//
// Calculates SLA deadline timestamps from a trigger time.
//
// Two deadline modes:
//   Wall-clock  — deadline = triggerTime + N milliseconds, 24/7
//   Business hours — deadline = triggerTime + N business hours (M–F 8 AM–6 PM
//                    in the pharmacy's IANA timezone)
//   Business days  — deadline = triggerTime + N business days (same rules)
//
// REQ-SLM-008: Business hours = Monday–Friday, 08:00–18:00 local pharmacy time.
// No holiday calendar. If trigger is outside business hours, deadline
// calculation begins from the next business-hour window opening.
//
// All SLA deadline values per FRD 5 v2.0:
//   PAYMENT              — 72h wall clock (from AWAITING_PAYMENT)
//   SUBMISSION           — 24h wall clock (SMS reminder, from AWAITING_PAYMENT)
//   STATUS_UPDATE        — 48h wall clock (SMS reminder, from AWAITING_PAYMENT)
//   FAX_DELIVERY         — 30 min wall clock (from FAX_QUEUED)
//   PHARMACY_ACKNOWLEDGE — 4 biz hrs (Tier 4, from FAX_DELIVERED)
//   PHARMACY_CONFIRMATION— 24 biz hrs (from PHARMACY_ACKNOWLEDGED)
//   SHIPPING             — 7 biz days (from PHARMACY_ACKNOWLEDGED)
//   REROUTE_RESOLUTION   — 24h wall clock / tracking update (from SHIPPED)
//   ADAPTER_SUBMISSION_ACK—15 min wall clock Tier 1/3, 30 min Tier 2
//                          (from SUBMISSION_PENDING)
//   PHARMACY_COMPOUNDING_ACK — 2 biz hrs (Tier 1/2/3, from PHARMACY_ACKNOWLEDGED)

// ============================================================
// CONSTANTS
// ============================================================

/** Business day start hour in pharmacy's local timezone (inclusive) */
const BIZ_START_HOUR = 8
/** Business day end hour in pharmacy's local timezone (exclusive, i.e. last minute is 17:59) */
const BIZ_END_HOUR   = 18
/** Business hours per day */
const BIZ_HOURS_PER_DAY = BIZ_END_HOUR - BIZ_START_HOUR   // 10

// ============================================================
// TIMEZONE HELPERS
// ============================================================

interface LocalParts {
  year:    number
  month:   number   // 1-12
  day:     number   // 1-31
  hour:    number   // 0-23
  minute:  number
  second:  number
  weekday: number   // 0 = Sunday, 6 = Saturday
}

/** Returns the local date/time parts for a UTC Date in the given IANA timezone. */
function toLocalParts(utcDate: Date, timezone: string): LocalParts {
  // Use Intl.DateTimeFormat to decompose into local parts (Node.js + modern browsers)
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone:    timezone,
    year:        'numeric',
    month:       '2-digit',
    day:         '2-digit',
    hour:        '2-digit',
    minute:      '2-digit',
    second:      '2-digit',
    hour12:      false,
    weekday:     'short',
  })

  const parts = Object.fromEntries(
    fmt.formatToParts(utcDate).map(p => [p.type, p.value])
  ) as Record<string, string>

  // hour12: false can return '24' for midnight in some environments
  const hour = parseInt(parts['hour']!) % 24

  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  }

  return {
    year:    parseInt(parts['year']!),
    month:   parseInt(parts['month']!),
    day:     parseInt(parts['day']!),
    hour,
    minute:  parseInt(parts['minute']!),
    second:  parseInt(parts['second']!),
    weekday: weekdayMap[parts['weekday']!] ?? 0,
  }
}

/** True if the weekday number is a business day (Mon–Fri). */
function isBusinessWeekday(weekday: number): boolean {
  return weekday >= 1 && weekday <= 5
}

/**
 * Returns the UTC timestamp for a specific local date at a given
 * hour:minute:second in the target timezone.
 *
 * Strategy: construct an ISO string that Intl can interpret, then
 * binary-search for the UTC time whose local representation matches.
 * We use a practical shortcut: iterate from a rough estimate
 * using timezone-offset estimation.
 */
function localToUtc(
  year: number, month: number, day: number,
  hour: number, minute: number, second: number,
  timezone: string
): Date {
  // Construct candidate using Date.UTC and adjust by checking local parts
  // We use a 2-pass approach: first rough estimate, then fine correction.
  // Pass 1: naive UTC (ignores timezone offset)
  let candidate = new Date(Date.UTC(year, month - 1, day, hour, minute, second))

  // Pass 2: compute the offset and correct
  // Offset = local time - UTC time
  const localParts = toLocalParts(candidate, timezone)
  const localMinutes = localParts.hour * 60 + localParts.minute
  const targetMinutes = hour * 60 + minute

  // Check if dates also differ (DST edge case near midnight)
  if (localParts.day !== day || localParts.month !== month || localParts.year !== year) {
    // Shift by a day and re-iterate (handles DST gaps)
    const dayDiff = (new Date(Date.UTC(year, month - 1, day)).getTime() -
                     new Date(Date.UTC(localParts.year, localParts.month - 1, localParts.day)).getTime())
                    / 86400000
    candidate = new Date(candidate.getTime() + dayDiff * 86400000)
  }

  const minuteDiff = targetMinutes - (toLocalParts(candidate, timezone).hour * 60 + toLocalParts(candidate, timezone).minute)
  candidate = new Date(candidate.getTime() - minuteDiff * 60000)

  // Final verification pass (BLK-07: add assertion so DST edge-case drift is detectable)
  const final = toLocalParts(candidate, timezone)
  const secondDiff = (hour * 3600 + minute * 60 + second) -
                     (final.hour * 3600 + final.minute * 60 + final.second)
  const result = new Date(candidate.getTime() - secondDiff * 1000)

  // Assert: local representation of result must match requested time.
  // During DST gap hours (e.g. 02:00→03:00 spring-forward) the requested
  // time does not exist — allow up to 1 hour tolerance for those edge cases.
  const check = toLocalParts(result, timezone)
  const resultSeconds  = check.hour * 3600 + check.minute * 60 + check.second
  const targetSeconds  = hour  * 3600 + minute  * 60 + second
  const drift = Math.abs(resultSeconds - targetSeconds)
  if (drift > 3600) {
    // Drift larger than 1 hour is unexpected — log and return best-effort
    console.warn(
      `[sla-calculator] localToUtc drift ${drift}s for ${year}-${month}-${day} ${hour}:${minute}:${second} ${timezone}`
    )
  }

  return result
}

/** Returns the UTC time for the next business day at BIZ_START_HOUR in the given timezone. */
function nextBizDayStart(fromUtc: Date, timezone: string): Date {
  const local = toLocalParts(fromUtc, timezone)
  // Start from tomorrow using localToUtc (DST-safe — avoids raw ms addition)
  let year  = local.year
  let month = local.month
  let day   = local.day + 1

  // Normalize date (naive day overflow) — use Intl-aware approach
  const normalized = new Date(Date.UTC(year, month - 1, day))
  year  = normalized.getUTCFullYear()
  month = normalized.getUTCMonth() + 1
  day   = normalized.getUTCDate()

  // Advance to next Monday if it's a weekend.
  // BLK-06 fix: always use localToUtc (DST-safe) rather than raw ms addition.
  // Iterate at most 7 days to handle back-to-back weekend/holiday cases.
  for (let i = 0; i < 7; i++) {
    const candidate = localToUtc(year, month, day, BIZ_START_HOUR, 0, 0, timezone)
    const wd = toLocalParts(candidate, timezone).weekday
    if (isBusinessWeekday(wd)) return candidate

    // Weekend — advance one calendar day via Intl-safe date normalization
    const next = new Date(Date.UTC(year, month - 1, day + 1))
    year  = next.getUTCFullYear()
    month = next.getUTCMonth() + 1
    day   = next.getUTCDate()
  }

  // Fallback: should never reach here; return a rough estimate
  return localToUtc(year, month, day, BIZ_START_HOUR, 0, 0, timezone)
}

// ============================================================
// WALL-CLOCK DEADLINE
// ============================================================

/**
 * Returns triggerTime + durationMs (pure wall-clock; no timezone logic needed).
 * Used for: PAYMENT (72h), SUBMISSION (24h), STATUS_UPDATE (48h),
 * FAX_DELIVERY (30 min), REROUTE_RESOLUTION (24h),
 * ADAPTER_SUBMISSION_ACK (15/30 min).
 */
export function addWallClock(triggerTime: Date, durationMs: number): Date {
  return new Date(triggerTime.getTime() + durationMs)
}

// ============================================================
// BUSINESS HOURS DEADLINE
// ============================================================

/**
 * Returns the UTC time after advancing `hours` business hours from `triggerTime`.
 * Business hours = M–F 08:00–18:00 in `timezone`.
 *
 * REQ-SLM-008: If trigger is outside business hours, the clock starts at
 * the next business-hour window (next BIZ_START_HOUR on a weekday).
 */
export function addBusinessHours(
  triggerTime: Date,
  hours:       number,
  timezone:    string
): Date {
  let current    = triggerTime
  let remaining  = hours
  // NB-11: cap iterations to prevent infinite loop on bad timezone or extreme input
  const MAX_ITERATIONS = hours * 3 + 30
  let iterations = 0

  while (remaining > 0) {
    if (++iterations > MAX_ITERATIONS) {
      console.warn(`[sla-calculator] addBusinessHours iteration cap hit (hours=${hours}, timezone=${timezone})`)
      break
    }
    const local = toLocalParts(current, timezone)

    if (!isBusinessWeekday(local.weekday)) {
      // Weekend — jump to Monday 8 AM
      current = nextBizDayStart(current, timezone)
      continue
    }

    if (local.hour < BIZ_START_HOUR) {
      // Before business hours today — jump to 8 AM same day
      current = localToUtc(local.year, local.month, local.day, BIZ_START_HOUR, 0, 0, timezone)
      continue
    }

    if (local.hour >= BIZ_END_HOUR) {
      // After business hours today — jump to 8 AM next business day
      current = nextBizDayStart(current, timezone)
      continue
    }

    // We are within business hours — consume as many as possible today
    const endOfDayUtc = localToUtc(local.year, local.month, local.day, BIZ_END_HOUR, 0, 0, timezone)
    const hoursToEndOfDay = (endOfDayUtc.getTime() - current.getTime()) / 3600000

    if (hoursToEndOfDay >= remaining) {
      // Remaining hours fit within today
      return new Date(current.getTime() + remaining * 3600000)
    }

    // Consume rest of today and continue tomorrow
    remaining -= hoursToEndOfDay
    current    = nextBizDayStart(current, timezone)
  }

  return current
}

// ============================================================
// BUSINESS DAYS DEADLINE
// ============================================================

/**
 * Returns the UTC time after advancing `days` business days from `triggerTime`.
 * Each business day ends at BIZ_END_HOUR (18:00) in `timezone`.
 * Fractional days are not supported — use addBusinessHours for sub-day precision.
 *
 * REQ-SLM-008: Used for SHIPPING SLA (7 business days).
 */
export function addBusinessDays(
  triggerTime: Date,
  days:        number,
  timezone:    string
): Date {
  return addBusinessHours(triggerTime, days * BIZ_HOURS_PER_DAY, timezone)
}
