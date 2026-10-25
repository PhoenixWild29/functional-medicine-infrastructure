// ============================================================
// PHI access audit log (Compliance C2)
// ============================================================
//
// logPhiAccess writes one phi_access_log row for a request that reads or
// writes patient-identifying data: who (user id, role, keyed hash of the
// email), which clinic, which patient / order, what (action + resource),
// on which route pattern, from where (keyed hashes of IP and user agent),
// and when. Migration 20261007000001.
//
// No PHI ever goes in a row: no names, DOB, phone, drug or free text, and
// the email, IP and user agent only as HMAC-SHA256 with the server secret
// PHI_ACCESS_LOG_HASH_SECRET (so "was it this IP?" can be answered by
// hashing the candidate, but the log alone reveals nothing). Without the
// secret the hashes are left NULL, never an unkeyed hash that a dictionary
// could reverse.
//
// It NEVER throws into the request: an insert that fails, a database that
// is down, or a client that cannot be created is logged (error code only,
// no row values, no ids) and the page or API carries on. It is never
// silent either (B15): it returns whether the row was written, and a
// failure raises one PHI-free alert (Slack and Sentry: the error code,
// the route pattern and the action), throttled per route and action.
//
// Who (B14): a signed-in user (`user`), or an `actor` for everyone else:
//   - patientActor(): a patient on a token link (/plan, /intake, /join,
//     /checkout). actor_role 'patient', actor_user_id = the patient's id.
//   - systemActor(): a cron, adapter or webhook acting for the platform.
//     actor_role 'system', actor_user_id = the nil UUID.
// Both fit the existing columns (actor_role ^[a-z_]{1,40}$, actor_user_id
// an unconstrained UUID): no schema change.
//
// Disclosures (PHI sent outside: a pharmacy, an AI vendor) use
// logPhiDisclosure, action 'export'. It is FAIL-CLOSED by contract: the
// caller sends only after it returns true.

import { getUserClinicId, getUserRole } from '@/lib/auth/claims'

import { AUDIT_HASH_SECRET_ENV, auditHash, clientIp } from './keyed-hash'

export const PHI_ACCESS_HASH_ENV = AUDIT_HASH_SECRET_ENV

export const PHI_ACTIONS = ['view', 'create', 'update', 'export', 'print', 'sign'] as const
export type PhiAction = (typeof PHI_ACTIONS)[number]

/** What was touched. A code, never free text (the column CHECK is ^[a-z_]{1,40}$). */
export type PhiResource =
  | 'patient'
  | 'patient_list'
  | 'patient_allergies'
  | 'order'
  | 'order_list'
  | 'prescription'
  | 'refill'
  | 'practice_export'
  | 'practice_dashboard'
  | 'payment_link'
  | 'payment_group'
  | 'patient_phases'
  // Patient Intake PR 4: a face sheet read to prefill + New patient (no patient yet).
  | 'face_sheet_fill'
  | 'access_log'
  // Patient Intake PR 2: dismissing "Possible duplicate of <name>".
  | 'patient_duplicate_flag'
  // Patient Intake PR 5b: what EHR sync changed or kept on a patient.
  | 'patient_ehr_changes'
  // C-2026-10-25-17 (B14): paths that were not logged before.
  | 'order_timeline'
  | 'favorite'
  | 'draft_edit'
  | 'patient_import_preview'
  | 'inbound_fax'
  | 'ops_order_action'
  | 'proposal'
  | 'plan'
  | 'intake'
  | 'signup'
  | 'checkout'
  | 'ehr_sync'
  | 'pharmacy_disclosure'
  | 'ai_face_sheet'
  | 'ai_portal_screenshot'

export interface PhiActor {
  userId:   string
  role:     string
  email:    string | null
  clinicId: string | null
}

/** The actor from a Supabase auth user (getUser()). */
export function phiActorFromUser(user: PhiUser | null | undefined): PhiActor | null {
  if (!user?.id) return null
  const role = getUserRole(user) ?? 'unknown'
  const clinicId = getUserClinicId(user) ?? null
  return { userId: user.id, role, email: user.email ?? null, clinicId }
}

/** The nil UUID: actor_user_id for the system (crons, adapters, webhooks). */
export const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000'

/** A patient acting on a token link: their own id is the actor. */
export function patientActor(patientId: string, clinicId: string | null): PhiActor {
  return { userId: patientId, role: 'patient', email: null, clinicId }
}

/** The platform acting on its own (a cron, an adapter, a webhook). */
export function systemActor(clinicId: string | null): PhiActor {
  return { userId: SYSTEM_ACTOR_ID, role: 'system', email: null, clinicId }
}

/** True when PHI_ACCESS_LOG_HASH_SECRET is set (for the health check; never the value). */
export function phiAuditSecretConfigured(): boolean {
  return (process.env[PHI_ACCESS_HASH_ENV] ?? '').trim().length > 0
}

/** The signed-in user, as getUser() (or a route's session) returns it. */
export interface PhiUser {
  id: string
  email?: string | null | undefined
  /** Role and clinic are read from app_metadata only (src/lib/auth/claims). */
  app_metadata?: Record<string, unknown> | null | undefined
}

export interface PhiAccessEntry {
  /** Who: the signed-in user. Nothing is written without a user or an actor. */
  user?:      PhiUser | null | undefined
  /** Who, when it is not a signed-in user: patientActor() or systemActor(). Wins over `user`. */
  actor?:     PhiActor | null
  action:     PhiAction
  resource:   PhiResource
  /** The route PATTERN, e.g. '/api/orders/[orderId]/record'. An id in it is masked. */
  route:      string
  patientId?: string | null
  orderId?:   string | null
  /** The clinic whose data it is, when not the actor's own (ops). */
  clinicId?:  string | null
  /** The request headers (IP, user agent); null when there are none. */
  headers?:   Headers | null
}

const RESOURCE_RE = /^[a-z_]{1,40}$/
const ROLE_RE = /^[a-z_]{1,40}$/
const UUID_SEGMENT_RE = /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi

let warnedNoSecret = false

async function keyedHash(value: string | null | undefined): Promise<string | null> {
  const secret = process.env[PHI_ACCESS_HASH_ENV]
  if (!value) return null
  if (!secret) {
    if (!warnedNoSecret) {
      warnedNoSecret = true
      console.warn(`[phi-access] ${PHI_ACCESS_HASH_ENV} is not set: email, IP and user agent hashes are left empty`)
    }
    return null
  }
  return auditHash(value)
}

/** The route as a pattern: no query string, no ids. */
function routePattern(route: string): string {
  const path = route.split('?')[0] ?? ''
  return path.replace(UUID_SEGMENT_RE, '/[id]').slice(0, 200)
}

const ALERT_THROTTLE_MS = 60_000
const lastAlertAt = new Map<string, number>()

/** For tests: forget when the last alerts were sent. */
export function __resetPhiAlertThrottle(): void {
  lastAlertAt.clear()
}

/**
 * B15: a PHI access that could not be recorded is never silent. One alert
 * per route and action per minute, to Slack (the allow-listed ops alert)
 * and Sentry, carrying only the error code, the route pattern and the
 * action: never an id, a name or a row value. Never throws.
 */
async function reportLogFailure(route: string, action: string, code: string): Promise<void> {
  const key = `${route}|${action}`
  const now = Date.now()
  if ((lastAlertAt.get(key) ?? 0) > now - ALERT_THROTTLE_MS) return
  lastAlertAt.set(key, now)
  try {
    const Sentry = await import('@sentry/nextjs')
    Sentry.captureMessage('phi_access_log write failed', { level: 'error', tags: { route, action, code } })
  } catch { /* reporting must never throw */ }
  try {
    const { sendSlackAlert, buildPhiAccessLogFailedAlert } = await import('@/lib/slack/client')
    await sendSlackAlert(buildPhiAccessLogFailedAlert({ route, action, code }))
  } catch (err) {
    console.error(`[phi-access] the alert for an unrecorded access failed | ${err instanceof Error ? err.name : 'error'} | route=${route}`)
  }
}

function entryActor(entry: Pick<PhiAccessEntry, 'user' | 'actor'>): PhiActor | null {
  return entry.actor ?? phiActorFromUser(entry.user)
}

/**
 * Write one phi_access_log row. Resolves in every case, to true when the
 * row was written. A failure is logged without any value from the row and
 * raises an alert (reportLogFailure).
 */
export async function logPhiAccess(entry: PhiAccessEntry): Promise<boolean> {
  try {
    const actor = entryActor(entry)
    if (!actor) return false
    if (!(PHI_ACTIONS as readonly string[]).includes(entry.action) || !RESOURCE_RE.test(entry.resource)) {
      console.error(`[phi-access] refused an entry with an unknown action or resource | route=${routePattern(entry.route)}`)
      await reportLogFailure(routePattern(entry.route), String(entry.action), 'invalid_entry')
      return false
    }
    const [actorEmailHash, ipHash, userAgentHash] = await Promise.all([
      keyedHash(actor.email?.trim().toLowerCase()),
      keyedHash(clientIp(entry.headers)),
      keyedHash(entry.headers?.get('user-agent') ?? null),
    ])
    const row = {
      occurred_at:      new Date().toISOString(),
      actor_user_id:    actor.userId,
      actor_role:       ROLE_RE.test(actor.role) ? actor.role : 'unknown',
      actor_email_hash: actorEmailHash,
      clinic_id:        entry.clinicId ?? actor.clinicId ?? null,
      patient_id:       entry.patientId ?? null,
      order_id:         entry.orderId ?? null,
      action:           entry.action,
      resource:         entry.resource,
      route:            routePattern(entry.route),
      ip_hash:          ipHash,
      user_agent_hash:  userAgentHash,
    }
    // Loaded here, not at module load: every route imports this module.
    const { createServiceClient } = await import('@/lib/supabase/service')
    const { error } = await createServiceClient().from('phi_access_log').insert(row)
    if (error) {
      // The code only: a Postgres message can quote the failing row.
      const code = (error as { code?: string }).code ?? 'unknown'
      console.error(`[phi-access] phi_access_log insert failed | code=${code} | route=${row.route} | action=${row.action}`)
      await reportLogFailure(row.route, row.action, code)
      return false
    }
    return true
  } catch (err) {
    const name = err instanceof Error ? err.name : 'error'
    console.error(`[phi-access] phi_access_log write failed | ${name} | route=${routePattern(entry.route)}`)
    await reportLogFailure(routePattern(entry.route), String(entry.action), name)
    return false
  }
}

/**
 * A disclosure: PHI sent outside the app (a pharmacy, an AI vendor). One
 * 'export' row. FAIL-CLOSED: the caller sends only when this returns true;
 * a false is already alerted.
 */
export async function logPhiDisclosure(entry: Omit<PhiAccessEntry, 'action'>): Promise<boolean> {
  return logPhiAccess({ ...entry, action: 'export' })
}

const MANY_CHUNK = 500

/**
 * One phi_access_log row per patient, for a write that touches many
 * patients at once (the patient CSV import): the same actor, action,
 * resource and route on each, written in chunks of 500. Like
 * logPhiAccess, it resolves in every case and logs no row value.
 */
export async function logPhiAccessMany(
  entry: Omit<PhiAccessEntry, 'patientId' | 'orderId'>,
  patientIds: ReadonlyArray<string>,
): Promise<boolean> {
  try {
    if (patientIds.length === 0) return true
    const actor = entryActor(entry)
    if (!actor) return false
    if (!(PHI_ACTIONS as readonly string[]).includes(entry.action) || !RESOURCE_RE.test(entry.resource)) {
      console.error(`[phi-access] refused entries with an unknown action or resource | route=${routePattern(entry.route)}`)
      await reportLogFailure(routePattern(entry.route), String(entry.action), 'invalid_entry')
      return false
    }
    const [actorEmailHash, ipHash, userAgentHash] = await Promise.all([
      keyedHash(actor.email?.trim().toLowerCase()),
      keyedHash(clientIp(entry.headers)),
      keyedHash(entry.headers?.get('user-agent') ?? null),
    ])
    const occurredAt = new Date().toISOString()
    const base = {
      occurred_at:      occurredAt,
      actor_user_id:    actor.userId,
      actor_role:       ROLE_RE.test(actor.role) ? actor.role : 'unknown',
      actor_email_hash: actorEmailHash,
      clinic_id:        entry.clinicId ?? actor.clinicId ?? null,
      order_id:         null,
      action:           entry.action,
      resource:         entry.resource,
      route:            routePattern(entry.route),
      ip_hash:          ipHash,
      user_agent_hash:  userAgentHash,
    }
    const { createServiceClient } = await import('@/lib/supabase/service')
    const db = createServiceClient()
    let allWritten = true
    for (let i = 0; i < patientIds.length; i += MANY_CHUNK) {
      const rows = patientIds.slice(i, i + MANY_CHUNK).map(patientId => ({ ...base, patient_id: patientId }))
      const { error } = await db.from('phi_access_log').insert(rows)
      if (error) {
        const code = (error as { code?: string }).code ?? 'unknown'
        console.error(`[phi-access] phi_access_log insert failed | code=${code} | route=${base.route} | rows=${rows.length}`)
        await reportLogFailure(base.route, base.action, code)
        allWritten = false
      }
    }
    return allWritten
  } catch (err) {
    const name = err instanceof Error ? err.name : 'error'
    console.error(`[phi-access] phi_access_log write failed | ${name} | route=${routePattern(entry.route)}`)
    await reportLogFailure(routePattern(entry.route), String(entry.action), name)
    return false
  }
}

/**
 * The current request's headers, for a Server Component (a page has no
 * Request object). null outside a request (a test, a build), never a throw.
 */
export async function currentRequestHeaders(): Promise<Headers | null> {
  try {
    const { headers } = await import('next/headers')
    return new Headers(await headers())
  } catch {
    return null
  }
}
