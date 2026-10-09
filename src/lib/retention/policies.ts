// ============================================================
// Retention policies and the dry-run runner (Compliance C10, PR 1)
// ============================================================
//
// What each retention job will act on, how old a row must be, and why.
// /api/cron/retention runs these daily. In PR 1 every policy is a dry
// run: it COUNTS what the policy would act on and records the count in
// retention_runs (append-only). Nothing is deleted, nulled or removed,
// whatever RETENTION_ENABLED says; a policy goes live in a later PR, one
// at a time, after its counts have been reviewed.
//
// Guarantees, pinned by __tests__/retention-runner:
//   - a policy names only a table in RETENTION_TABLES; the tables in
//     NEVER_RETENTION_TARGETS (the PHI access log, the EPCS audit log,
//     the retention records themselves, legal holds, the status history,
//     patients) are never a target;
//   - an orders policy matches only unsigned drafts (status DRAFT,
//     locked_at null). A signed order cannot be deleted at all (the
//     orders_no_delete_signed trigger);
//   - anything under a legal hold (a clinic or a patient, legal_holds) is
//     left out. Holds that cannot be read stop the run: a run never acts
//     as if there were none;
//   - the runner reads; its one write is the retention_runs insert.
//
// Counts only, never row contents: retention_runs holds the policy, the
// cutoff, how many rows matched, the oldest and newest matching times.

import type { SupabaseClient } from '@supabase/supabase-js'

/** Tables a retention policy may name. */
export const RETENTION_TABLES = [
  'orders',
  'webhook_events',
  'pharmacy_webhook_events',
  'adapter_submissions',
  'sms_log',
  'ops_alert_queue',
  'clinic_notifications',
  'sla_notifications_log',
] as const
export type RetentionTable = (typeof RETENTION_TABLES)[number]

/** Never a retention target, whatever a policy says. */
export const NEVER_RETENTION_TARGETS = [
  'phi_access_log',        // HIPAA audit trail: 6 years minimum, append-only by trigger
  'epcs_audit_log',        // DEA / HIPAA audit trail, append-only by trigger
  'retention_runs',        // the record of what retention did
  'legal_holds',           // what retention must not touch
  'order_status_history',  // part of the order record
  'patients',              // the clinic's record, kept per the BAA
] as const

export type RetentionAction = 'delete' | 'null_columns' | 'storage_remove'

export type RetentionFilter =
  | { op: 'eq'; column: string; value: string }
  | { op: 'is'; column: string; value: null }
  | { op: 'not_is'; column: string; value: null }

export interface RetentionPolicy {
  /** retention_runs.policy */
  key:        string
  table:      RetentionTable
  action:     RetentionAction
  /** For null_columns: what is nulled. The row (ids, status) stays. */
  columns?:   string[]
  /** A row is past retention when this is older than keepDays. */
  ageColumn:  string
  keepDays:   number
  filters:    RetentionFilter[]
  /** The columns that tie a row to a clinic, a patient or an order, for legal holds. */
  holds:      { clinic?: string; patient?: string; order?: string }
  /** PR 1: no policy is live. A later PR turns them on one at a time. */
  live:       false
  /** Why this period. */
  source:     string
}

const DAY_MS = 24 * 60 * 60 * 1000

export const RETENTION_POLICIES: ReadonlyArray<RetentionPolicy> = [
  {
    key: 'abandoned_drafts', table: 'orders', action: 'delete',
    ageColumn: 'updated_at', keepDays: 90,
    filters: [{ op: 'eq', column: 'status', value: 'DRAFT' }, { op: 'is', column: 'locked_at', value: null }],
    holds: { clinic: 'clinic_id', patient: 'patient_id' },
    live: false,
    source: 'Never signed, so not a prescription or a record anyone must keep; flagged stale at 48 hours.',
  },
  {
    key: 'webhook_payloads', table: 'webhook_events', action: 'null_columns', columns: ['payload'],
    ageColumn: 'processed_at', keepDays: 30,
    filters: [{ op: 'not_is', column: 'payload', value: null }],
    holds: { order: 'order_id' },
    live: false,
    source: 'Minimum necessary (45 CFR 164.502(b)): raw Stripe and Documo bodies; the row (ids, status, external_event_id) stays for dedup.',
  },
  {
    key: 'pharmacy_webhook_payloads', table: 'pharmacy_webhook_events', action: 'null_columns', columns: ['payload'],
    ageColumn: 'processed_at', keepDays: 30,
    filters: [{ op: 'not_is', column: 'payload', value: null }],
    holds: { order: 'order_id' },
    live: false,
    source: 'Minimum necessary (45 CFR 164.502(b)): raw pharmacy bodies; the row stays.',
  },
  {
    key: 'adapter_response_payloads', table: 'adapter_submissions', action: 'null_columns', columns: ['response_payload'],
    ageColumn: 'created_at', keepDays: 30,
    filters: [{ op: 'not_is', column: 'response_payload', value: null }],
    holds: { order: 'order_id' },
    live: false,
    source: 'Minimum necessary: unredacted pharmacy responses; status, reference id and times stay.',
  },
  {
    key: 'prescription_pdfs', table: 'adapter_submissions', action: 'storage_remove',
    ageColumn: 'completed_at', keepDays: 90,
    filters: [{ op: 'not_is', column: 'request_payload->>storage_path', value: null }, { op: 'not_is', column: 'completed_at', value: null }],
    holds: { order: 'order_id' },
    live: false,
    source: 'A transmission copy (prescription-pdfs bucket); the order is the record and the submission row the proof of sending.',
  },
  {
    key: 'sms_log', table: 'sms_log', action: 'delete',
    ageColumn: 'created_at', keepDays: 1826,
    filters: [],
    holds: { patient: 'patient_id', order: 'order_id' },
    live: false,
    source: 'TCPA claims: 4-year limitation (28 USC 1658(a)), plus one year. Consent stays on the patient.',
  },
  {
    key: 'ops_alert_queue_sent', table: 'ops_alert_queue', action: 'delete',
    ageColumn: 'sent_at', keepDays: 365,
    filters: [{ op: 'not_is', column: 'sent_at', value: null }],
    holds: {},
    live: false,
    source: 'Operational alerts already sent to Slack; ids and codes only.',
  },
  {
    key: 'clinic_notifications_acknowledged', table: 'clinic_notifications', action: 'delete',
    ageColumn: 'acknowledged_at', keepDays: 365,
    filters: [{ op: 'not_is', column: 'acknowledged_at', value: null }],
    holds: { clinic: 'clinic_id', order: 'order_id' },
    live: false,
    source: 'In-app notices the clinic has acknowledged; operational only.',
  },
  {
    key: 'sla_notifications_log', table: 'sla_notifications_log', action: 'delete',
    ageColumn: 'sent_at', keepDays: 365,
    filters: [],
    holds: { order: 'order_id' },
    live: false,
    source: 'Record of SLA alerts sent; operational only.',
  },
]

// ── The runner ────────────────────────────────────────────────

/** Held order ids are read at most this many; more and order-linked policies stop. */
const MAX_HELD_ORDERS = 5000

export interface RetentionRunRow {
  run_id:        string
  policy:        string
  mode:          'dry_run' | 'live'
  cutoff:        string
  rows_matched:  number
  rows_affected: number
  oldest_at:     string | null
  newest_at:     string | null
  error:         string | null
  started_at:    string
  finished_at:   string
}

export interface RetentionRunResult {
  ok:               boolean
  runId:            string
  retentionEnabled: boolean
  policies:         Array<{ policy: string; rowsMatched: number; error: string | null }>
}

interface Holds { clinics: string[]; patients: string[]; orders: string[] | null; ordersError: string | null }

// A minimal query surface, so the policies' dynamic table names type-check.
type Query = {
  eq(col: string, v: unknown): Query
  is(col: string, v: null): Query
  not(col: string, op: string, v: unknown): Query
  lt(col: string, v: string): Query
  or(filters: string): Query
  order(col: string, o: { ascending: boolean }): Query
  limit(n: number): Query
} & PromiseLike<{ data: unknown; error: { message: string; code?: string } | null; count?: number | null }>
type Table = {
  select(cols: string, opts?: { count?: 'exact'; head?: boolean }): Query
  insert(rows: unknown): PromiseLike<{ error: { message: string } | null }>
}
type Client = { from(table: string): Table }

const inList = (ids: string[]) => `(${ids.join(',')})`

function applyFilters(q: Query, p: RetentionPolicy, cutoff: string, holds: Holds): Query {
  for (const f of p.filters) {
    if (f.op === 'eq') q = q.eq(f.column, f.value)
    else if (f.op === 'is') q = q.is(f.column, null)
    else q = q.not(f.column, 'is', null)
  }
  q = q.lt(p.ageColumn, cutoff)
  // Legal holds. NOT IN also leaves out rows whose link is NULL while any
  // hold exists: that undercounts, never acts on a held row.
  if (p.holds.clinic && holds.clinics.length > 0) q = q.not(p.holds.clinic, 'in', inList(holds.clinics))
  if (p.holds.patient && holds.patients.length > 0) q = q.not(p.holds.patient, 'in', inList(holds.patients))
  if (p.holds.order && holds.orders && holds.orders.length > 0) q = q.not(p.holds.order, 'in', inList(holds.orders))
  return q
}

async function readHolds(db: Client): Promise<Holds | { error: string }> {
  const { data, error } = await db.from('legal_holds').select('scope, target_id').is('released_at', null)
  if (error) return { error: 'legal holds could not be read' }
  const rows = (data ?? []) as Array<{ scope: string; target_id: string }>
  const clinics = rows.filter(r => r.scope === 'clinic').map(r => r.target_id)
  const patients = rows.filter(r => r.scope === 'patient').map(r => r.target_id)
  if (clinics.length === 0 && patients.length === 0) return { clinics, patients, orders: [], ordersError: null }

  // Order-linked rows (payloads, SMS, notices) are held through their order.
  const or = [
    clinics.length > 0 ? `clinic_id.in.${inList(clinics)}` : null,
    patients.length > 0 ? `patient_id.in.${inList(patients)}` : null,
  ].filter(Boolean).join(',')
  const held = await db.from('orders').select('order_id').or(or).limit(MAX_HELD_ORDERS)
  if (held.error) return { clinics, patients, orders: null, ordersError: 'held orders could not be read' }
  const orders = ((held.data ?? []) as Array<{ order_id: string }>).map(o => o.order_id)
  if (orders.length >= MAX_HELD_ORDERS) return { clinics, patients, orders: null, ordersError: `more than ${MAX_HELD_ORDERS - 1} held orders` }
  return { clinics, patients, orders, ordersError: null }
}

async function countPolicy(db: Client, p: RetentionPolicy, cutoff: string, holds: Holds): Promise<Pick<RetentionRunRow, 'rows_matched' | 'oldest_at' | 'newest_at' | 'error'>> {
  const none = { rows_matched: 0, oldest_at: null, newest_at: null }
  if (p.holds.order && holds.ordersError) return { ...none, error: holds.ordersError }

  const counted = await applyFilters(db.from(p.table).select(p.ageColumn, { count: 'exact', head: true }), p, cutoff, holds)
  if (counted.error) return { ...none, error: `count failed (${counted.error.code ?? 'error'})` }
  const rows = counted.count ?? 0
  if (rows === 0) return { ...none, error: null }

  const edge = async (ascending: boolean): Promise<string | null> => {
    const r = await applyFilters(db.from(p.table).select(p.ageColumn), p, cutoff, holds).order(p.ageColumn, { ascending }).limit(1)
    const first = (r.data as Array<Record<string, unknown>> | null)?.[0]?.[p.ageColumn]
    return r.error || typeof first !== 'string' ? null : first
  }
  return { rows_matched: rows, oldest_at: await edge(true), newest_at: await edge(false), error: null }
}

/**
 * One retention run: every policy counted and recorded. PR 1 is a dry run
 * whatever `enabled` says (no policy is live); `enabled` is reported.
 */
export async function runRetention(
  supabase: SupabaseClient,
  input: { enabled: boolean; now?: Date },
): Promise<RetentionRunResult> {
  const db = supabase as unknown as Client
  const now = input.now ?? new Date()
  const runId = crypto.randomUUID()
  const holds = await readHolds(db)

  const rows: RetentionRunRow[] = []
  for (const p of RETENTION_POLICIES) {
    const startedAt = new Date().toISOString()
    const cutoff = new Date(now.getTime() - p.keepDays * DAY_MS).toISOString()
    const counted = 'error' in holds && !('clinics' in holds)
      ? { rows_matched: 0, oldest_at: null, newest_at: null, error: holds.error }
      : await countPolicy(db, p, cutoff, holds as Holds)
    rows.push({
      run_id: runId, policy: p.key,
      mode: 'dry_run', // PR 1: no policy is live
      cutoff, ...counted, rows_affected: 0,
      started_at: startedAt, finished_at: new Date().toISOString(),
    })
  }

  const { error: recordError } = await db.from('retention_runs').insert(rows)
  if (recordError) console.error('[retention] the run could not be recorded in retention_runs:', recordError.message)

  const result: RetentionRunResult = {
    ok: !recordError && rows.every(r => r.error === null),
    runId,
    retentionEnabled: input.enabled,
    policies: rows.map(r => ({ policy: r.policy, rowsMatched: r.rows_matched, error: r.error })),
  }
  console.info('[retention] dry run', { run_id: runId, retention_enabled: input.enabled, policies: result.policies })
  return result
}
