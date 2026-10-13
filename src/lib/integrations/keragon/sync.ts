// ============================================================
// Apply one inbound EHR patient (Keragon) to the clinic's patients
// ============================================================
//
// 1. Linked already (patient_external_ids: clinic, 'keragon', external
//    id): update that patient.
// 2. Otherwise the intake duplicate rule (lib/patients/duplicates): an
//    active patient of this clinic with the same date of birth and the
//    same mobile or the same name.
//      - exactly one, with the same name, not linked to another EHR id:
//        link it and update it (not a duplicate);
//      - none: create the patient (source 'ehr', external_id) and link it;
//      - several, a mobile match under a different name, or a match
//        linked to another EHR id: create the patient and flag it for
//        staff (possible_duplicate_of), never merge.
// 3. Updating: only fields the EHR sent; an absent field is never
//    cleared. A field the patient entered at self-intake (they completed
//    intake and left a value) is never overwritten: the EHR's value is
//    kept in patient_field_changes with applied = false, and the event is
//    flagged for staff. Every field sync does change is recorded there
//    too, with the old and new value.
// 4. SMS consent is never written.
//
// The result goes to the sync log: ids, codes and field names only.

import type { SupabaseClient as UntypedClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

type SupabaseClient = UntypedClient<Database>
import { withPhoneE164 } from '@/lib/patients/phone'
import type { KeragonPatient } from './contract'
import { SELF_INTAKE_FIELDS, toPatientFields, type PatientSyncFields, type SyncField } from './mapping'

export const SYSTEM = 'keragon'

export type SyncStatus = 'applied' | 'skipped' | 'flagged' | 'error'
export interface SyncOutcome {
  status:     SyncStatus
  patientId:  string | null
  /** Codes, counts and field names: never PHI. */
  detail:     Record<string, unknown>
  errorCode?: string | undefined
}

interface PatientRow extends Record<string, unknown> {
  patient_id: string
  is_active: boolean
  deleted_at: string | null
  first_name: string | null
  last_name: string | null
  phone_e164: string | null
  intake_completed_at: string | null
}

const PATIENT_COLUMNS = 'patient_id, clinic_id, is_active, deleted_at, first_name, last_name, date_of_birth, sex, phone, phone_e164, email, address_line1, address_line2, city, state, zip, allergies, nkda, intake_completed_at'

type Ctx = { clinicId: string; syncEventId: string | null; now: Date }

const fail = (code: string, patientId: string | null = null): SyncOutcome => ({ status: 'error', patientId, detail: {}, errorCode: code })
const sameName = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? '').replace(/\s+/g, ' ').trim().toLowerCase() === (b ?? '').replace(/\s+/g, ' ').trim().toLowerCase()

/** A value as stored in patient_field_changes (text). */
function asText(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (Array.isArray(v)) return JSON.stringify(v)
  return String(v)
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    const x = Array.isArray(a) ? a.map(s => String(s).toLowerCase()).sort() : []
    const y = Array.isArray(b) ? b.map(s => String(s).toLowerCase()).sort() : []
    return x.length === y.length && x.every((v, i) => v === y[i])
  }
  return (a ?? null) === (b ?? null)
}

export async function applyPatientEvent(db: SupabaseClient, ctx: Ctx, patient: KeragonPatient): Promise<SyncOutcome> {
  const fields = toPatientFields(patient)

  // 1. Linked already.
  const { data: link, error: linkError } = await db.from('patient_external_ids').select('patient_id')
    .eq('clinic_id', ctx.clinicId).eq('system', SYSTEM).eq('external_patient_id', patient.externalPatientId).maybeSingle()
  if (linkError) return fail('read_failed')
  if (link) {
    const { data: row, error } = await db.from('patients').select(PATIENT_COLUMNS)
      .eq('patient_id', (link as { patient_id: string }).patient_id).eq('clinic_id', ctx.clinicId).maybeSingle()
    if (error) return fail('read_failed')
    const p = row as PatientRow | null
    if (!p || !p.is_active || p.deleted_at) return { status: 'skipped', patientId: (link as { patient_id: string }).patient_id, detail: {}, errorCode: 'patient_inactive' }
    return updatePatient(db, ctx, p, fields, { action: 'updated' })
  }

  // 2. The intake duplicate rule: same DOB, and the same mobile or name.
  const { data: sameDob, error: candError } = await db.from('patients').select(PATIENT_COLUMNS)
    .eq('clinic_id', ctx.clinicId).eq('date_of_birth', fields.date_of_birth!).eq('is_active', true).is('deleted_at', null).limit(50)
  if (candError) return fail('read_failed')
  const byMobile = (r: PatientRow) => !!fields.phone_e164 && r.phone_e164 === fields.phone_e164
  const byName = (r: PatientRow) => sameName(r.first_name, fields.first_name) && sameName(r.last_name, fields.last_name)
  const candidates = ((sameDob ?? []) as PatientRow[]).filter(r => byMobile(r) || byName(r))

  if (candidates.length === 0) return createPatient(db, ctx, fields, patient.externalPatientId, null)

  const best = candidates.find(byMobile) ?? candidates[0]!
  const matchedOn = byMobile(best) ? 'mobile_and_date_of_birth' : 'name_and_date_of_birth'
  if (candidates.length > 1) return createPatient(db, ctx, fields, patient.externalPatientId, { of: best.patient_id, matchedOn, reason: 'several_matches', candidates: candidates.length })
  if (!byName(best)) return createPatient(db, ctx, fields, patient.externalPatientId, { of: best.patient_id, matchedOn, reason: 'name_differs', candidates: 1 })

  const { data: other, error: otherError } = await db.from('patient_external_ids').select('external_patient_id')
    .eq('patient_id', best.patient_id).eq('system', SYSTEM).maybeSingle()
  if (otherError) return fail('read_failed')
  if (other) return createPatient(db, ctx, fields, patient.externalPatientId, { of: best.patient_id, matchedOn, reason: 'match_linked_elsewhere', candidates: 1 })

  const linked = await link_(db, ctx, best.patient_id, patient.externalPatientId)
  if (!linked.ok) return fail(linked.code, best.patient_id)
  return updatePatient(db, ctx, best, fields, { action: 'linked', matched_on: matchedOn })
}

async function link_(db: SupabaseClient, ctx: Ctx, patientId: string, externalId: string): Promise<{ ok: true } | { ok: false; code: string }> {
  const { error } = await db.from('patient_external_ids').insert({
    clinic_id: ctx.clinicId, patient_id: patientId, system: SYSTEM, external_patient_id: externalId,
    linked_at: ctx.now.toISOString(), last_synced_at: ctx.now.toISOString(),
  })
  if (!error) return { ok: true }
  // Another delivery linked it first: a retry will find the link.
  return { ok: false, code: error.code === '23505' ? 'link_conflict' : 'write_failed' }
}

async function createPatient(
  db: SupabaseClient, ctx: Ctx, fields: PatientSyncFields, externalId: string,
  flag: { of: string; matchedOn: string; reason: string; candidates: number } | null,
): Promise<SyncOutcome> {
  // A patient needs a mobile or an email (chk_patients_phone_or_email).
  const { phone, ...rest } = fields
  if (!phone && !rest.email) return fail('contact_required')
  const row = withPhoneE164({
    clinic_id: ctx.clinicId,
    ...rest,
    phone: phone ?? null,
    source: 'ehr',
    external_id: externalId,
    intake_status: 'complete',
    is_active: true,
    // Never opted in by sync; the consent columns are not written at all.
    sms_opt_in: false,
    ...(flag ? { possible_duplicate_of: flag.of, possible_duplicate_matched_on: flag.matchedOn, possible_duplicate_flagged_at: ctx.now.toISOString() } : { possible_duplicate_of: null }),
  })
  const { data, error } = await db.from('patients').insert(row).select('patient_id').single()
  if (error || !data) return fail('write_failed')
  const patientId = (data as { patient_id: string }).patient_id
  const linked = await link_(db, ctx, patientId, externalId)
  if (!linked.ok) {
    // Undo: the patient is not left unlinked (a retry would create another).
    const { error: undoError } = await db.from('patients').delete().eq('patient_id', patientId)
    if (undoError) console.error(`[ehr-sync] CRITICAL: an unlinked synced patient could not be removed | patient=${patientId}`)
    return fail(linked.code)
  }
  return flag
    ? { status: 'flagged', patientId, detail: { action: 'created', reason: flag.reason, matched_on: flag.matchedOn, candidates: flag.candidates, possible_duplicate_of: flag.of } }
    : { status: 'applied', patientId, detail: { action: 'created' } }
}

async function updatePatient(
  db: SupabaseClient, ctx: Ctx, p: PatientRow, fields: PatientSyncFields, detail: Record<string, unknown>,
): Promise<SyncOutcome> {
  const selfIntake = !!p.intake_completed_at
  const update: Record<string, unknown> = {}
  const changes: Array<{ field: string; old_value: string | null; new_value: string | null; applied: boolean }> = []
  const updated: string[] = []
  const kept: string[] = []

  for (const [key, value] of Object.entries(fields) as Array<[SyncField, unknown]>) {
    if (key === 'phone_e164') continue // follows phone
    const current = p[key]
    if (sameValue(current, value)) continue
    const patientEntered = selfIntake && SELF_INTAKE_FIELDS.includes(key) && current !== null && current !== undefined && current !== ''
    if (patientEntered) {
      kept.push(key)
      changes.push({ field: key, old_value: asText(current), new_value: asText(value), applied: false })
      continue
    }
    update[key] = value
    if (key === 'allergies') update['allergies_updated_at'] = ctx.now.toISOString()
    updated.push(key)
    changes.push({ field: key, old_value: asText(current), new_value: asText(value), applied: true })
  }

  if (Object.keys(update).length > 0) {
    const { error } = await db.from('patients').update(withPhoneE164(update)).eq('patient_id', p.patient_id).eq('clinic_id', ctx.clinicId)
    if (error) return fail('write_failed', p.patient_id)
  }
  if (changes.length > 0) {
    const { error } = await db.from('patient_field_changes').insert(changes.map(c => ({
      clinic_id: ctx.clinicId, patient_id: p.patient_id, ...c, source: 'ehr_sync', sync_event_id: ctx.syncEventId, changed_at: ctx.now.toISOString(),
    })))
    if (error) console.error(`[ehr-sync] field changes not recorded | patient=${p.patient_id}:`, error.code ?? error.message)
  }
  const { error: touchError } = await db.from('patient_external_ids').update({ last_synced_at: ctx.now.toISOString() })
    .eq('clinic_id', ctx.clinicId).eq('system', SYSTEM).eq('patient_id', p.patient_id)
  if (touchError) console.error(`[ehr-sync] last_synced_at not updated | patient=${p.patient_id}`)

  const out: Record<string, unknown> = { ...detail, ...(updated.length ? { fields_updated: updated } : {}), ...(kept.length ? { fields_kept: kept } : {}) }
  if (kept.length > 0) return { status: 'flagged', patientId: p.patient_id, detail: { ...out, reason: out['reason'] ?? 'patient_entered_fields_differ' } }
  if (updated.length === 0 && detail['action'] === 'updated') return { status: 'skipped', patientId: p.patient_id, detail: { action: 'unchanged' } }
  return { status: 'applied', patientId: p.patient_id, detail: out }
}
