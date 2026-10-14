// ============================================================
// Clinic sign-up links (Patient Intake PR 3)
// ============================================================
//
// One standing link per clinic (clinic_signup_links), printed as a QR code
// for the waiting room. A new patient who opens it completes self-intake
// and is created in that clinic (see /api/join/[token]).
//
// The token is HMAC-SHA256 of the link id under the server secret
// (JWT_SECRET), base64url: 43 characters, the intake token's shape. The
// server can therefore show the link to staff again, while the database
// keeps only the token's SHA-256 (token_hash), like the intake links: a
// stolen row cannot be turned into a working link. Rotating JWT_SECRET
// changes every sign-up link (staff then reprint the QR code).
//
// Making a new link revokes the old one (it stops working); turning a link
// off keeps it but tells patients it is no longer active.
//
// Server only. Written with the service-role client: RLS lets clinic staff
// read their clinic's row, but nothing but the service role writes it.

import { createHmac, randomUUID } from 'node:crypto'
import { serverEnv } from '@/lib/env'
import { hashIntakeToken, isWellFormedIntakeToken } from './token'

/** New patients one link may create in any 24 hours. */
export const SIGNUP_DAILY_CAP = 50

// Structural: the service client, or a test double.
type Db = { from: (table: string) => unknown }
type Result = { data: unknown; error: { message: string; code?: string } | null; count?: number | null }
type Q = {
  select: (cols?: string, opts?: { count?: 'exact'; head?: boolean }) => Q
  insert: (row: unknown) => Q
  update: (patch: unknown) => Q
  eq: (col: string, v: unknown) => Q
  is: (col: string, v: null) => Q
  gte: (col: string, v: unknown) => Q
  maybeSingle: () => Promise<Result>
  single: () => Promise<Result>
  then: Promise<Result>['then']
}
const table = (db: Db) => db.from('clinic_signup_links') as Q

const COLUMNS = 'link_id, enabled, use_count, last_used_at, created_at'

export interface SignupLink {
  linkId: string
  enabled: boolean
  useCount: number
  lastUsedAt: string | null
  createdAt: string
  url: string
}

export function signupToken(linkId: string): string {
  return createHmac('sha256', serverEnv.jwtSecret()).update(`clinic-signup-link:v1:${linkId}`, 'utf8').digest('base64url')
}

export function signupUrl(token: string): string {
  return `${serverEnv.appBaseUrl().replace(/\/+$/, '')}/join/${token}`
}

function toLink(row: unknown): SignupLink {
  const r = row as { link_id: string; enabled: boolean; use_count: number | null; last_used_at: string | null; created_at: string }
  return {
    linkId: r.link_id,
    enabled: r.enabled === true,
    useCount: r.use_count ?? 0,
    lastUsedAt: r.last_used_at ?? null,
    createdAt: r.created_at,
    url: signupUrl(signupToken(r.link_id)),
  }
}

/** The clinic's active (not revoked) link, or null when it has none. */
export async function getSignupLink(db: Db, clinicId: string): Promise<{ ok: true; link: SignupLink | null } | { ok: false }> {
  const { data, error } = await table(db).select(COLUMNS).eq('clinic_id', clinicId).is('revoked_at', null).maybeSingle()
  if (error) {
    console.error('[signup-links] read failed | clinic=', clinicId, '| code=', error.code ?? 'unknown')
    return { ok: false }
  }
  return { ok: true, link: data ? toLink(data) : null }
}

/** Make a new link: the clinic's active link is revoked first (it stops working). */
export async function createSignupLink(
  db: Db,
  input: { clinicId: string; createdBy: string },
): Promise<{ ok: true; link: SignupLink } | { ok: false }> {
  // Two tries: a second admin making a link at the same moment can insert
  // between our revoke and insert; the one-active index refuses ours
  // (23505), so revoke again and retry once.
  for (let attempt = 0; attempt < 2; attempt++) {
    const { error: revokeError } = await table(db)
      .update({ revoked_at: new Date().toISOString(), revoked_by: input.createdBy })
      .eq('clinic_id', input.clinicId)
      .is('revoked_at', null)
    if (revokeError) {
      console.error('[signup-links] revoke failed | clinic=', input.clinicId, '| code=', revokeError.code ?? 'unknown')
      return { ok: false }
    }

    const linkId = randomUUID()
    const { data, error } = await table(db)
      .insert({
        link_id: linkId,
        clinic_id: input.clinicId,
        token_hash: hashIntakeToken(signupToken(linkId)),
        enabled: true,
        created_by: input.createdBy,
      })
      .select(COLUMNS)
      .single()
    if (!error && data) return { ok: true, link: toLink(data) }
    if (error?.code === '23505' && attempt === 0) continue
    console.error('[signup-links] insert failed | clinic=', input.clinicId, '| code=', error?.code ?? 'no row')
    return { ok: false }
  }
  return { ok: false }
}

/** Turn the clinic's active link off or back on. */
export async function setSignupLinkEnabled(
  db: Db,
  input: { clinicId: string; enabled: boolean },
): Promise<{ ok: true; link: SignupLink } | { ok: false; error: 'none' | 'db' }> {
  const { data, error } = await table(db)
    .update({ enabled: input.enabled })
    .eq('clinic_id', input.clinicId)
    .is('revoked_at', null)
    .select(COLUMNS)
    .maybeSingle()
  if (error) {
    console.error('[signup-links] update failed | clinic=', input.clinicId, '| code=', error.code ?? 'unknown')
    return { ok: false, error: 'db' }
  }
  if (!data) return { ok: false, error: 'none' }
  return { ok: true, link: toLink(data) }
}

export type SignupLinkState =
  | { state: 'open'; linkId: string; clinicId: string; clinicName: string }
  | { state: 'inactive' | 'invalid' | 'unavailable' }

export async function resolveSignupLink(db: Db, token: string): Promise<SignupLinkState> {
  if (!isWellFormedIntakeToken(token)) return { state: 'invalid' }
  const { data, error } = await table(db)
    .select('link_id, clinic_id, enabled, revoked_at, clinics(name)')
    .eq('token_hash', hashIntakeToken(token))
    .maybeSingle()
  if (error) {
    console.error('[signup-links] link read failed | code=', error.code ?? 'unknown')
    return { state: 'unavailable' }
  }
  if (!data) return { state: 'invalid' }
  const row = data as {
    link_id: string; clinic_id: string; enabled: boolean; revoked_at: string | null
    clinics: { name?: string } | Array<{ name?: string }> | null
  }
  if (!row.enabled || row.revoked_at) return { state: 'inactive' }
  const clinic = Array.isArray(row.clinics) ? row.clinics[0] : row.clinics
  return { state: 'open', linkId: row.link_id, clinicId: row.clinic_id, clinicName: clinic?.name?.trim() || 'Your clinic' }
}

/**
 * Patients who signed up from the clinic's links in the last 7 days, for
 * the Settings card. A count only. Null when it cannot be read.
 */
export async function countRecentSignups(db: Db, clinicId: string): Promise<number | null> {
  try {
    const since = new Date(Date.now() - 7 * 24 * 3600_000).toISOString()
    const { count, error } = await (db.from('patients') as Q)
      .select('patient_id', { count: 'exact', head: true })
      .eq('clinic_id', clinicId)
      .eq('source', 'signup_link')
      .is('deleted_at', null)
      .gte('created_at', since)
    if (error || typeof count !== 'number') return null
    return count
  } catch {
    return null
  }
}
