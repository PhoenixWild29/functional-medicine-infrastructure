// ============================================================
// POST /api/integrations/keragon/patients: the pipeline
// ============================================================
//
// Server to server; no session. In order:
//   1. x-compoundiq-connection names the clinic's connection. Unknown,
//      malformed or not connected: 401 (nothing says which).
//   2. The shared secret from Vault. Vault unreadable: 503 (retry).
//   3. HMAC-SHA256 over `${timestamp}.${rawBody}`, constant-time, at most
//      5 minutes skew. Bad, missing or stale: 401; the code is noted on
//      the connection (never the request), no event row.
//   4. JSON and the contract. Invalid: 422 with the fields named; logged
//      as an error with field names only.
//   5. The event id is claimed in ehr_sync_events (unique per connection).
//      Already there: 409, unless the earlier attempt failed for a reason
//      a retry can fix (then this delivery takes over that row).
//   5a. The clinic must be approved (lib/onboarding/approval-guard, the
//      guard on every write). Not yet: 403 clinic_not_approved, no patient
//      written, the refusal logged on the event log and the connection so
//      ops sees it on Ops Dashboard > EHR sync. Keragon resending the same
//      event after approval takes over that row. Clinic unreadable: 503.
//   6. Applied (lib sync); the log row gets the outcome, the patient id
//      and codes; the connection its last event / success / error.
//   7. PHI access log (B14/B15; L1, writes are logged first): a patient
//      created or updated is one 'create' or 'update' / 'ehr_sync' row by
//      the system actor for the clinic, with the patient id, written
//      BEFORE the write (sync's beforeWrite; a new patient's id is
//      generated first). A row that cannot be written refuses the sync:
//      the event fails with audit_log_failed, retryable, so this answers
//      the 503 and Keragon redelivers. A write that fails after logging
//      gets a not_completed_ehr_sync row. Nothing written (skipped): no row.
// Nothing here logs PHI: ids, codes and field names only.

import type { SupabaseClient as UntypedClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database.types'

type SupabaseClient = UntypedClient<Database>
import { CONNECTION_HEADER, SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySignature } from './signature'
import { connectionSecret, noteConnectionError } from './connection'
import { parsePatientEvent } from './contract'
import { AUDIT_LOG_FAILED, applyPatientEvent, type PatientWrite, type SyncOutcome } from './sync'
import { clinicApproval } from '@/lib/onboarding/approval-guard'
import { logPhiAccess, logPhiWriteNotCompleted, systemActor, type PhiAccessEntry } from '@/lib/audit/phi-access'

export interface WebhookResult { status: number; body: Record<string, unknown> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Failures a later delivery of the same event may get past. */
const RETRYABLE = new Set(['read_failed', 'write_failed', 'link_conflict', 'processing_failed', 'clinic_not_approved', AUDIT_LOG_FAILED])
export const CLINIC_NOT_APPROVED_MESSAGE = 'This clinic has not been approved by CompoundIQ yet, so no patients are synced. Nothing was saved.'
const UNAUTHORIZED: WebhookResult = { status: 401, body: { error: 'Unauthorized' } }

export async function handleKeragonWebhook(
  db: SupabaseClient,
  input: { headers: { get(name: string): string | null }; rawBody: string; now?: Date },
): Promise<WebhookResult> {
  const now = input.now ?? new Date()
  const connectionId = input.headers.get(CONNECTION_HEADER)?.trim() ?? ''
  if (!UUID.test(connectionId)) return UNAUTHORIZED

  const conn = await connectionSecret(db, connectionId)
  if (!conn.ok) {
    if (conn.reason === 'unavailable') {
      console.error(`[ehr-sync] 503 | reason=${conn.stage} | connection=${connectionId} | code=${conn.code}`)
      return { status: 503, body: { error: 'Temporarily unavailable. Retry.' } }
    }
    console.warn(`[ehr-sync] request for an unknown or disconnected connection | connection=${connectionId}`)
    return UNAUTHORIZED
  }

  const check = verifySignature({
    secret: conn.secret, timestamp: input.headers.get(TIMESTAMP_HEADER), signature: input.headers.get(SIGNATURE_HEADER),
    rawBody: input.rawBody, nowMs: now.getTime(),
  })
  if (!check.ok) {
    const code = check.reason === 'stale' ? 'stale_signature' : check.reason === 'missing' ? 'missing_signature' : 'bad_signature'
    console.warn(`[ehr-sync] signature refused | connection=${connectionId} | ${code}`)
    await noteConnectionError(db, connectionId, code, now)
    return UNAUTHORIZED
  }

  let body: unknown
  try { body = JSON.parse(input.rawBody) } catch { body = undefined }
  const parsed = body === undefined ? { ok: false as const, eventId: null, errors: { body: 'Send valid JSON.' } } : parsePatientEvent(body, now)
  if (!parsed.ok) {
    const fields = Object.keys(parsed.errors)
    const { error } = await db.from('ehr_sync_events').insert({
      connection_id: connectionId, clinic_id: conn.clinicId, event_id: parsed.eventId,
      event_type: typeof (body as Record<string, unknown> | undefined)?.['event_type'] === 'string' && /^[a-z_.]{1,60}$/.test(String((body as Record<string, unknown>)['event_type'])) ? String((body as Record<string, unknown>)['event_type']) : null,
      status: 'error', error_code: 'invalid_payload', detail: { fields }, received_at: now.toISOString(), processed_at: now.toISOString(),
    })
    if (error?.code === '23505') return { status: 409, body: { error: 'This event id was already received.', event_id: parsed.eventId } }
    if (error) console.error(`[ehr-sync] invalid event not logged | connection=${connectionId}:`, error.code ?? error.message)
    await noteConnectionError(db, connectionId, 'invalid_payload', now)
    return { status: 422, body: { error: 'The payload does not match the contract.', errors: parsed.errors, event_id: parsed.eventId } }
  }
  const event = parsed.event

  // Only an approved clinic receives patients (decision 2).
  const approval = await clinicApproval(db, conn.clinicId)
  if (approval.state === 'unavailable') {
    console.error(`[ehr-sync] 503 | reason=clinic_read_failed | connection=${connectionId} | event=${event.eventId}`)
    return { status: 503, body: { error: 'Temporarily unavailable. Retry.' } }
  }
  if (approval.state === 'pending') {
    const { error: refusedLogError } = await db.from('ehr_sync_events').insert({
      connection_id: connectionId, clinic_id: conn.clinicId, event_id: event.eventId, event_type: event.eventType,
      status: 'error', error_code: 'clinic_not_approved', patient_id: null, received_at: now.toISOString(), processed_at: now.toISOString(),
    })
    // 23505: this event was refused (or seen) before; the row already says so.
    if (refusedLogError && refusedLogError.code !== '23505') console.error(`[ehr-sync] refusal not logged | connection=${connectionId} | event=${event.eventId}:`, refusedLogError.code ?? refusedLogError.message)
    await noteConnectionError(db, connectionId, 'clinic_not_approved', now)
    console.warn(`[ehr-sync] 403 | reason=clinic_not_approved | connection=${connectionId} | event=${event.eventId}`)
    return { status: 403, body: { error: CLINIC_NOT_APPROVED_MESSAGE, error_code: 'clinic_not_approved', event_id: event.eventId } }
  }

  // Claim the event id.
  let syncEventId: string
  const { data: claimed, error: claimError } = await db.from('ehr_sync_events').insert({
    connection_id: connectionId, clinic_id: conn.clinicId, event_id: event.eventId, event_type: event.eventType,
    status: 'received', received_at: now.toISOString(),
  }).select('sync_event_id').single()
  if (claimError?.code === '23505') {
    const { data: prior, error: priorError } = await db.from('ehr_sync_events').select('sync_event_id, status, error_code')
      .eq('connection_id', connectionId).eq('event_id', event.eventId).maybeSingle()
    const p = prior as { sync_event_id: string; status: string; error_code: string | null } | null
    if (priorError || !p || p.status !== 'error' || !RETRYABLE.has(p.error_code ?? '')) {
      return { status: 409, body: { error: 'This event id was already received.', event_id: event.eventId } }
    }
    syncEventId = p.sync_event_id
  } else if (claimError || !claimed) {
    console.error(`[ehr-sync] 503 | reason=event_log_failed | connection=${connectionId} | event=${event.eventId} | code=${claimError?.code ?? 'no_row'}`)
    return { status: 503, body: { error: 'Temporarily unavailable. Retry.' } }
  } else {
    syncEventId = (claimed as { sync_event_id: string }).sync_event_id
  }

  // L1: the PHI access row is written before the patient write; false
  // refuses it (audit_log_failed, retryable).
  let logged = null as PhiAccessEntry | null
  const beforeWrite = async (w: PatientWrite): Promise<boolean> => {
    const entry: PhiAccessEntry = {
      actor: systemActor(conn.clinicId), action: w.action,
      resource: 'ehr_sync', route: '/api/integrations/keragon/patients',
      patientId: w.patientId, clinicId: conn.clinicId,
      headers: input.headers instanceof Headers ? input.headers : null,
    }
    if (!(await logPhiAccess(entry))) return false
    logged = entry
    return true
  }

  let outcome: SyncOutcome
  try {
    outcome = await applyPatientEvent(db, { clinicId: conn.clinicId, syncEventId, now, beforeWrite }, event.patient)
  } catch (err) {
    console.error(`[ehr-sync] processing threw | connection=${connectionId} | event=${event.eventId}:`, err instanceof Error ? err.name : 'error')
    outcome = { status: 'error', patientId: null, detail: {}, errorCode: 'processing_failed' }
  }

  // Logged, then the write failed: say so.
  if (logged && outcome.status === 'error') await logPhiWriteNotCompleted(logged)

  const { error: logError } = await db.from('ehr_sync_events').update({
    status: outcome.status, patient_id: outcome.patientId, detail: outcome.detail as Json, error_code: outcome.errorCode ?? null, processed_at: new Date().toISOString(),
  }).eq('sync_event_id', syncEventId)
  if (logError) console.error(`[ehr-sync] outcome not logged | event=${event.eventId}:`, logError.code ?? logError.message)

  const touch: Record<string, unknown> = { last_event_at: now.toISOString() }
  if (outcome.status === 'error') { touch['last_error_at'] = now.toISOString(); touch['last_error_code'] = outcome.errorCode ?? 'processing_failed' } else touch['last_success_at'] = now.toISOString()
  const { error: touchError } = await db.from('ehr_connections').update(touch).eq('connection_id', connectionId)
  if (touchError) console.error(`[ehr-sync] connection status not updated | connection=${connectionId}`)

  const result = { status: outcome.status, event_id: event.eventId, patient_id: outcome.patientId, ...(outcome.errorCode ? { error_code: outcome.errorCode } : {}) }
  if (outcome.status !== 'error') return { status: 200, body: result }
  if (RETRYABLE.has(outcome.errorCode ?? '')) {
    console.error(`[ehr-sync] 503 | reason=${outcome.errorCode} | connection=${connectionId} | event=${event.eventId}`)
    return { status: 503, body: { ...result, error: 'Temporarily unavailable. Retry.' } }
  }
  return { status: 422, body: { ...result, error: 'The patient could not be synced.' } }
}
