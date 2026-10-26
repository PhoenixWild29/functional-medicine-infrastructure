// ============================================================
// Ops access review (B16): filters, review flags, CSV (pure)
// ============================================================
//
// The weekly review of phi_access_log across every clinic, for ops_admin
// (docs/compliance/audit-log-review-procedure.md). Four flags mark rows
// for a closer look; a flag is a prompt to check, not a finding:
//
//   outside_hours      access before 06:00 or from 22:00 in the clinic's
//                      time zone. Clinics have no time zone column, so the
//                      zone comes from the clinic's state (STATE_TIME_ZONES);
//                      a row with no clinic, or a clinic with no known
//                      state, is read in UTC and says so.
//   bulk_patients      one actor opened more than BULK_VIEW_PATIENTS_PER_HOUR
//                      distinct patients within 60 minutes, counting
//                      single-record views only: a list (LIST_REVIEW_RESOURCES)
//                      logs one row per patient shown, and one dashboard
//                      render is not 30 chart opens.
//   deactivated_actor  the actor's login is deactivated, or no longer exists.
//                      Patient and system actors are not logins, and are
//                      never flagged; a failed lookup is unknown, not flagged.
//   no_relationship    the patient has no order and no treatment proposal
//                      in the clinic the row belongs to.
//
// Pure and client-safe (the page imports the labels), so the route stays
// thin and these are tested on their own.

import type { PhiAction } from './phi-access'

/** phi_access_log.action's values (PHI_ACTIONS; a test keeps them equal). */
export const REVIEW_ACTIONS: readonly PhiAction[] = ['view', 'create', 'update', 'export', 'print', 'sign']

/** More distinct patients than this, viewed by one actor within an hour, is flagged. */
export const BULK_VIEW_PATIENTS_PER_HOUR = 30
/** Local review hours: 06:00 up to 22:00, in the clinic's time zone. */
export const REVIEW_HOURS = { start: 6, end: 22 } as const
/** The zone for a row with no clinic, or a clinic with no known state. */
export const FALLBACK_TIME_ZONE = 'UTC'

/**
 * A clinic's time zone from its state (clinics.state, a USPS code). A state
 * that spans two zones gets the zone most of its people live in, so a
 * clinic in the other part (west Texas, the Florida panhandle, east
 * Tennessee, north Idaho, eastern Oregon, western Kentucky, the Upper
 * Peninsula, parts of the Dakotas, Nebraska and Kansas) is read an hour
 * off. The flag is a prompt to look, so an hour at the edge of the window
 * is accepted until clinics.timezone exists.
 */
export const STATE_TIME_ZONES: Readonly<Record<string, string>> = {
  AL: 'America/Chicago',     AK: 'America/Anchorage',   AZ: 'America/Phoenix',     AR: 'America/Chicago',
  CA: 'America/Los_Angeles', CO: 'America/Denver',      CT: 'America/New_York',    DE: 'America/New_York',
  DC: 'America/New_York',    FL: 'America/New_York',    GA: 'America/New_York',    HI: 'Pacific/Honolulu',
  ID: 'America/Boise',       IL: 'America/Chicago',     IN: 'America/Indiana/Indianapolis', IA: 'America/Chicago',
  KS: 'America/Chicago',     KY: 'America/New_York',    LA: 'America/Chicago',     ME: 'America/New_York',
  MD: 'America/New_York',    MA: 'America/New_York',    MI: 'America/Detroit',     MN: 'America/Chicago',
  MS: 'America/Chicago',     MO: 'America/Chicago',     MT: 'America/Denver',      NE: 'America/Chicago',
  NV: 'America/Los_Angeles', NH: 'America/New_York',    NJ: 'America/New_York',    NM: 'America/Denver',
  NY: 'America/New_York',    NC: 'America/New_York',    ND: 'America/Chicago',     OH: 'America/New_York',
  OK: 'America/Chicago',     OR: 'America/Los_Angeles', PA: 'America/New_York',    RI: 'America/New_York',
  SC: 'America/New_York',    SD: 'America/Chicago',     TN: 'America/Chicago',     TX: 'America/Chicago',
  UT: 'America/Denver',      VT: 'America/New_York',    VA: 'America/New_York',    WA: 'America/Los_Angeles',
  WV: 'America/New_York',    WI: 'America/Chicago',     WY: 'America/Denver',
}

export function timeZoneForState(state: string | null | undefined): string | null {
  if (typeof state !== 'string') return null
  return STATE_TIME_ZONES[state.trim().toUpperCase()] ?? null
}

/** List views: one row per patient shown, so not counted toward bulk_patients. */
export const LIST_REVIEW_RESOURCES: ReadonlySet<string> = new Set([
  'order_list', 'patient_list', 'practice_dashboard', 'patient_import_preview', 'inbound_fax',
])
/** With no dates given: the last 7 days, through today (the weekly review). */
export const REVIEW_DEFAULT_DAYS = 7
/** The longest range one request reads. */
export const REVIEW_MAX_DAYS = 92
/** Most rows one request reads; more is reported as truncated. */
export const ACCESS_REVIEW_ROW_LIMIT = 5000

export const REVIEW_FLAGS = ['outside_hours', 'bulk_patients', 'deactivated_actor', 'no_relationship'] as const
export type ReviewFlag = (typeof REVIEW_FLAGS)[number]

export const REVIEW_FLAG_LABELS: Record<ReviewFlag, string> = {
  outside_hours:     'Outside 6am to 10pm (clinic time)',
  bulk_patients:     `More than ${BULK_VIEW_PATIENTS_PER_HOUR} patients in an hour`,
  deactivated_actor: 'Deactivated user',
  no_relationship:   'No order or proposal in that clinic',
}

export interface AccessReviewRow {
  id:            string
  occurred_at:   string
  actor_user_id: string | null
  actor_role:    string
  clinic_id:     string | null
  patient_id:    string | null
  order_id:      string | null
  action:        string
  resource:      string
  route:         string
}

export interface FlaggedAccessRow extends AccessReviewRow {
  flags:      ReviewFlag[]
  /** The zone the hours were read in (the clinic's, or UTC). */
  time_zone:  string
  /** occurred_at in that zone, YYYY-MM-DD HH:MM. */
  local_time: string
}

export interface AccessReviewFilters {
  /** Field names that were malformed; empty when every filter is usable. */
  errors:         string[]
  from:           string
  to:             string
  fromIso:        string
  toIsoExclusive: string
  clinicId:       string | null
  actorUserId:    string | null
  actorRole:      string | null
  resource:       string | null
  action:         PhiAction | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const CODE_RE = /^[a-z_]{1,40}$/
const DAY_MS = 24 * 60 * 60 * 1000

function validDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false
  const d = new Date(`${s}T00:00:00.000Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** The filters from the query string. A malformed one is an error, never ignored. */
export function parseAccessReviewFilters(q: URLSearchParams, nowMs: number = Date.now()): AccessReviewFilters {
  const errors: string[] = []
  const text = (k: string) => (q.get(k) ?? '').trim()

  const today = dayOf(nowMs)
  const rawFrom = text('from')
  const rawTo = text('to')
  let to = today
  if (rawTo) { if (validDate(rawTo)) to = rawTo; else errors.push('to') }
  let from = dayOf(Date.parse(`${to}T00:00:00.000Z`) - (REVIEW_DEFAULT_DAYS - 1) * DAY_MS)
  if (rawFrom) { if (validDate(rawFrom)) from = rawFrom; else errors.push('from') }
  if (!errors.length) {
    const span = (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS + 1
    if (from > to) errors.push('from')
    else if (span > REVIEW_MAX_DAYS) errors.push('to')
  }

  const uuid = (k: string) => {
    const v = text(k)
    if (!v) return null
    if (!UUID_RE.test(v)) { errors.push(k); return null }
    return v.toLowerCase()
  }
  const code = (k: string) => {
    const v = text(k)
    if (!v) return null
    if (!CODE_RE.test(v)) { errors.push(k); return null }
    return v
  }
  const clinicId = uuid('clinicId')
  const actorUserId = uuid('actorUserId')
  const actorRole = code('actorRole')
  const resource = code('resource')
  let action: PhiAction | null = null
  const rawAction = text('action')
  if (rawAction) {
    if ((REVIEW_ACTIONS as readonly string[]).includes(rawAction)) action = rawAction as PhiAction
    else errors.push('action')
  }

  return {
    errors,
    from,
    to,
    fromIso: `${from}T00:00:00.000Z`,
    toIsoExclusive: new Date(Date.parse(`${to}T00:00:00.000Z`) + DAY_MS).toISOString(),
    clinicId, actorUserId, actorRole, resource, action,
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>()

/** The date, hour and minute of an instant in a zone. */
function localParts(iso: string, timeZone: string): { date: string; hour: number; minute: string } {
  let f = formatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    formatters.set(timeZone, f)
  }
  const p = Object.fromEntries(f.formatToParts(new Date(iso)).map(x => [x.type, x.value]))
  return { date: `${p['year']}-${p['month']}-${p['day']}`, hour: Number(p['hour']), minute: p['minute'] ?? '00' }
}

/** Before 06:00 or from 22:00, in the given zone (UTC by default). */
export function isOutsideReviewHours(iso: string, timeZone: string = FALLBACK_TIME_ZONE): boolean {
  const { hour } = localParts(iso, timeZone)
  return hour < REVIEW_HOURS.start || hour >= REVIEW_HOURS.end
}

/** The row ids where an actor's views reach more than the limit within 60 minutes. */
function bulkViewIds(rows: ReadonlyArray<AccessReviewRow>): Set<string> {
  const flagged = new Set<string>()
  const byActor = new Map<string, { id: string; at: number; patient: string }[]>()
  for (const r of rows) {
    if (r.action !== 'view' || !r.actor_user_id || !r.patient_id || LIST_REVIEW_RESOURCES.has(r.resource)) continue
    const list = byActor.get(r.actor_user_id) ?? []
    list.push({ id: r.id, at: Date.parse(r.occurred_at), patient: r.patient_id })
    byActor.set(r.actor_user_id, list)
  }
  for (const list of byActor.values()) {
    list.sort((a, b) => a.at - b.at)
    const counts = new Map<string, number>()
    let left = 0
    for (let right = 0; right < list.length; right++) {
      const cur = list[right]!
      counts.set(cur.patient, (counts.get(cur.patient) ?? 0) + 1)
      while (cur.at - list[left]!.at > 60 * 60 * 1000) {
        const out = list[left]!.patient
        const n = (counts.get(out) ?? 1) - 1
        if (n === 0) counts.delete(out); else counts.set(out, n)
        left++
      }
      if (counts.size > BULK_VIEW_PATIENTS_PER_HOUR) {
        for (let i = left; i <= right; i++) flagged.add(list[i]!.id)
      }
    }
  }
  return flagged
}

export interface FlagContext {
  /** Actors whose login is deactivated or gone. */
  deactivatedActorIds: ReadonlySet<string>
  /** `${clinicId}:${patientId}` for each patient with an order or a proposal in that clinic. */
  relatedPatients:     ReadonlySet<string>
  /** clinic id -> IANA zone; a clinic not in it is read in UTC. */
  clinicTimeZones?:    ReadonlyMap<string, string>
}

export function flagAccessRows(rows: ReadonlyArray<AccessReviewRow>, ctx: FlagContext): FlaggedAccessRow[] {
  const bulk = bulkViewIds(rows)
  return rows.map(r => {
    const flags: ReviewFlag[] = []
    const timeZone = (r.clinic_id && ctx.clinicTimeZones?.get(r.clinic_id)) || FALLBACK_TIME_ZONE
    const local = localParts(r.occurred_at, timeZone)
    if (local.hour < REVIEW_HOURS.start || local.hour >= REVIEW_HOURS.end) flags.push('outside_hours')
    if (bulk.has(r.id)) flags.push('bulk_patients')
    if (r.actor_user_id && ctx.deactivatedActorIds.has(r.actor_user_id)) flags.push('deactivated_actor')
    if (r.patient_id && r.clinic_id && !ctx.relatedPatients.has(`${r.clinic_id}:${r.patient_id}`)) flags.push('no_relationship')
    return { ...r, flags, time_zone: timeZone, local_time: `${local.date} ${String(local.hour).padStart(2, '0')}:${local.minute}` }
  })
}

export function countFlags(rows: ReadonlyArray<FlaggedAccessRow>): Record<ReviewFlag, number> {
  const out = Object.fromEntries(REVIEW_FLAGS.map(f => [f, 0])) as Record<ReviewFlag, number>
  for (const r of rows) for (const f of r.flags) out[f]++
  return out
}

/** A CSV cell. Text that starts like a formula gets a leading apostrophe. */
function cell(v: string | null): string {
  let s = v ?? ''
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n']/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const CSV_HEADER = ['occurred_at', 'time_zone', 'local_time', 'actor_user_id', 'actor_role', 'clinic_id', 'patient_id', 'order_id', 'action', 'resource', 'route', 'flags']

/** The last line of a cut-off export (C's review D3). */
export function truncatedCsvLine(rowLimit: number): string {
  return `# TRUNCATED: only the newest ${rowLimit} rows are in this file. Narrow the range or the filters and export again.`
}

export function accessReviewCsv(rows: ReadonlyArray<FlaggedAccessRow>, cut?: { truncated: boolean; rowLimit: number }): string {
  const lines = rows.map(r => [
    r.occurred_at, r.time_zone, r.local_time, r.actor_user_id, r.actor_role, r.clinic_id, r.patient_id, r.order_id,
    r.action, r.resource, r.route, r.flags.join(' '),
  ].map(cell).join(','))
  if (cut?.truncated) lines.push(truncatedCsvLine(cut.rowLimit))
  return [CSV_HEADER.join(','), ...lines].join('\n') + '\n'
}
