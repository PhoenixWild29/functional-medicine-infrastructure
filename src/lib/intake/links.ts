// ============================================================
// Patient intake links (Patient Intake PR 2)
// ============================================================
//
// One row per link in patient_intake_links, holding only the SHA-256 of
// the token. A new link revokes the patient's open one (resend). A link is
// open until it expires (72 h), is used (the patient submitted), or is
// revoked. Claiming it is one conditional UPDATE, so two submits cannot
// both use the same link; if saving the patient's details then fails, the
// claim is released.
//
// Server only. Called with the service-role client: RLS lets clinic staff
// read their clinic's rows, but nothing but the service role writes them.

import { serverEnv } from '@/lib/env'
import { INTAKE_LINK_TTL_HOURS, hashIntakeToken, isWellFormedIntakeToken, newIntakeToken } from './token'

// Structural: the service client, or a test double.
type Db = { from: (table: string) => unknown }
type Q = {
  select: (cols?: string) => Q
  insert: (row: unknown) => Q
  update: (patch: unknown) => Q
  eq: (col: string, v: unknown) => Q
  is: (col: string, v: null) => Q
  gt: (col: string, v: unknown) => Q
  maybeSingle: () => Promise<{ data: unknown; error: { message: string; code?: string } | null }>
  single: () => Promise<{ data: unknown; error: { message: string; code?: string } | null }>
  then: Promise<{ data: unknown; error: { message: string; code?: string } | null }>['then']
}
const table = (db: Db) => db.from('patient_intake_links') as Q

export function intakeUrl(token: string): string {
  return `${serverEnv.appBaseUrl().replace(/\/+$/, '')}/intake/${token}`
}

export type CreateIntakeLinkResult =
  | { ok: true; token: string; url: string; expiresAt: string; linkId: string }
  | { ok: false; error: 'db' }

export async function createIntakeLink(
  db: Db,
  input: { clinicId: string; patientId: string; createdBy: string | null },
): Promise<CreateIntakeLinkResult> {
  // Two tries: a resend racing this one can open a link between our revoke
  // and insert; the one-open-link index refuses ours (23505), so revoke
  // again and retry once.
  for (let attempt = 0; attempt < 2; attempt++) {
    const now = new Date()
    const { error: revokeError } = await table(db)
      .update({ revoked_at: now.toISOString() })
      .eq('patient_id', input.patientId)
      .is('used_at', null)
      .is('revoked_at', null)
    if (revokeError) {
      console.error('[intake-links] revoke failed:', revokeError.message, '| patient=', input.patientId)
      return { ok: false, error: 'db' }
    }

    const token = newIntakeToken()
    const expiresAt = new Date(now.getTime() + INTAKE_LINK_TTL_HOURS * 3600_000).toISOString()
    const { data, error } = await table(db)
      .insert({
        clinic_id:  input.clinicId,
        patient_id: input.patientId,
        token_hash: hashIntakeToken(token),
        expires_at: expiresAt,
        created_by: input.createdBy,
      })
      .select('link_id')
      .single()

    if (!error && data) {
      return { ok: true, token, url: intakeUrl(token), expiresAt, linkId: (data as { link_id: string }).link_id }
    }
    if (error?.code === '23505' && attempt === 0) continue
    console.error('[intake-links] insert failed:', error?.message ?? 'no row', '| patient=', input.patientId)
    return { ok: false, error: 'db' }
  }
  return { ok: false, error: 'db' }
}

export type IntakeLinkState =
  | { state: 'open'; link: { linkId: string; clinicId: string; patientId: string; expiresAt: string }; clinicName: string }
  | { state: 'expired' | 'used' | 'invalid' | 'unavailable' }

export async function resolveIntakeLink(db: Db, token: string): Promise<IntakeLinkState> {
  if (!isWellFormedIntakeToken(token)) return { state: 'invalid' }
  const { data, error } = await table(db)
    .select('link_id, clinic_id, patient_id, expires_at, used_at, revoked_at, clinics(name)')
    .eq('token_hash', hashIntakeToken(token))
    .maybeSingle()
  if (error) {
    console.error('[intake-links] link read failed:', error.message)
    return { state: 'unavailable' }
  }
  if (!data) return { state: 'invalid' }

  const row = data as {
    link_id: string; clinic_id: string; patient_id: string; expires_at: string
    used_at: string | null; revoked_at: string | null; clinics: { name?: string } | Array<{ name?: string }> | null
  }
  if (row.used_at || row.revoked_at) return { state: 'used' }
  if (Date.parse(row.expires_at) <= Date.now()) return { state: 'expired' }
  const clinic = Array.isArray(row.clinics) ? row.clinics[0] : row.clinics
  return {
    state: 'open',
    link: { linkId: row.link_id, clinicId: row.clinic_id, patientId: row.patient_id, expiresAt: row.expires_at },
    clinicName: clinic?.name?.trim() || 'Your clinic',
  }
}

/** Marks the link used. False when it was not open any more (used, revoked, expired). */
export async function claimIntakeLink(db: Db, linkId: string): Promise<boolean> {
  const { data, error } = await table(db)
    .update({ used_at: new Date().toISOString() })
    .eq('link_id', linkId)
    .is('used_at', null)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('link_id')
    .maybeSingle()
  if (error) {
    console.error('[intake-links] claim failed:', error.message, '| link=', linkId)
    return false
  }
  return !!data
}

/** Puts a claimed link back, when the patient's details could not be saved. */
export async function releaseIntakeLink(db: Db, linkId: string): Promise<void> {
  const { error } = await table(db).update({ used_at: null }).eq('link_id', linkId)
  if (error) console.error('[intake-links] release failed:', error.message, '| link=', linkId)
}
