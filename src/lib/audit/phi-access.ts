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
// no row values, no ids) and the page or API carries on.

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
  | 'access_log'
  // Patient Intake PR 2: dismissing "Possible duplicate of <name>".
  | 'patient_duplicate_flag'

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

/** The signed-in user, as getUser() (or a route's session) returns it. */
export interface PhiUser {
  id: string
  email?: string | null | undefined
  /** Role and clinic are read from app_metadata only (src/lib/auth/claims). */
  app_metadata?: Record<string, unknown> | null | undefined
}

export interface PhiAccessEntry {
  /** Who: the signed-in user. Nothing is written without one. */
  user:       PhiUser | null | undefined
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

/**
 * Write one phi_access_log row. Resolves in every case; a failure is
 * logged without any value from the row.
 */
export async function logPhiAccess(entry: PhiAccessEntry): Promise<void> {
  try {
    const actor = phiActorFromUser(entry.user)
    if (!actor) return
    if (!(PHI_ACTIONS as readonly string[]).includes(entry.action) || !RESOURCE_RE.test(entry.resource)) {
      console.error(`[phi-access] refused an entry with an unknown action or resource | route=${routePattern(entry.route)}`)
      return
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
      console.error(`[phi-access] phi_access_log insert failed | code=${(error as { code?: string }).code ?? 'unknown'} | route=${row.route} | action=${row.action}`)
    }
  } catch (err) {
    console.error(`[phi-access] phi_access_log write failed | ${err instanceof Error ? err.name : 'error'} | route=${routePattern(entry.route)}`)
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
