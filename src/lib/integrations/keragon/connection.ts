// ============================================================
// A clinic's Keragon connection: status, shared secret, disconnect
// ============================================================
//
// The shared secret is generated here, returned once to the clinic admin
// who asked for it, and stored only in Supabase Vault (create_vault_secret,
// the pattern used for pharmacy portal credentials); ehr_connections keeps
// only its Vault id. Rotating writes a new secret into the same Vault
// entry, so the old one stops working at once. Disconnecting deletes the
// Vault secret. Connected = a secret is set and not disconnected.
//
// Views never contain the secret or its Vault id. Server only.

import type { SupabaseClient } from '@supabase/supabase-js'
import { newSharedSecret } from './signature'

export const WEBHOOK_PATH = '/api/integrations/keragon/patients'
export const PROVIDER = 'keragon'

export type ConnectionStatus = 'not_connected' | 'connected' | 'disconnected'

export interface ConnectionRow {
  connection_id:     string
  clinic_id:         string
  secret_vault_id:   string | null
  connected_at:      string | null
  secret_rotated_at: string | null
  disconnected_at:   string | null
  last_event_at:     string | null
  last_success_at:   string | null
  last_error_at:     string | null
  last_error_code:   string | null
}

export interface ConnectionView {
  connectionId:    string | null
  status:          ConnectionStatus
  connectedAt:     string | null
  secretRotatedAt: string | null
  disconnectedAt:  string | null
  lastEventAt:     string | null
  lastSuccessAt:   string | null
  lastErrorAt:     string | null
  lastErrorCode:   string | null
  webhookPath:     string
}

export interface SyncEventView {
  syncEventId: string
  eventId:     string | null
  eventType:   string | null
  status:      string
  patientId:   string | null
  errorCode:   string | null
  detail:      Record<string, unknown>
  receivedAt:  string
}

type Fail = { ok: false; status: number; error: string }
const UNAVAILABLE = (what: string): Fail => ({ ok: false, status: 503, error: `${what} Nothing was changed. Try again.` })
const COLUMNS = 'connection_id, clinic_id, secret_vault_id, connected_at, secret_rotated_at, disconnected_at, last_event_at, last_success_at, last_error_at, last_error_code'

export function connectionStatus(row: Pick<ConnectionRow, 'secret_vault_id' | 'disconnected_at'> | null): ConnectionStatus {
  if (!row) return 'not_connected'
  if (row.secret_vault_id && !row.disconnected_at) return 'connected'
  return row.disconnected_at ? 'disconnected' : 'not_connected'
}

export function connectionView(row: ConnectionRow | null): ConnectionView {
  return {
    connectionId: row?.connection_id ?? null, status: connectionStatus(row),
    connectedAt: row?.connected_at ?? null, secretRotatedAt: row?.secret_rotated_at ?? null, disconnectedAt: row?.disconnected_at ?? null,
    lastEventAt: row?.last_event_at ?? null, lastSuccessAt: row?.last_success_at ?? null,
    lastErrorAt: row?.last_error_at ?? null, lastErrorCode: row?.last_error_code ?? null,
    webhookPath: WEBHOOK_PATH,
  }
}

async function readConnection(db: SupabaseClient, clinicId: string): Promise<{ ok: true; row: ConnectionRow | null } | { ok: false }> {
  const { data, error } = await db.from('ehr_connections').select(COLUMNS).eq('clinic_id', clinicId).eq('provider', PROVIDER).maybeSingle()
  if (error) return { ok: false }
  return { ok: true, row: (data as ConnectionRow | null) ?? null }
}

export async function loadConnection(db: SupabaseClient, clinicId: string, eventLimit = 50): Promise<{ ok: true; connection: ConnectionView; events: SyncEventView[] } | Fail> {
  const r = await readConnection(db, clinicId)
  if (!r.ok) return UNAVAILABLE('The EHR connection could not be read.')
  const { data, error } = await db.from('ehr_sync_events')
    .select('sync_event_id, event_id, event_type, status, patient_id, error_code, detail, received_at')
    .eq('clinic_id', clinicId).order('received_at', { ascending: false }).limit(eventLimit)
  if (error) return UNAVAILABLE('The sync log could not be read.')
  const events = ((data ?? []) as Array<Record<string, unknown>>).map(e => ({
    syncEventId: String(e['sync_event_id']), eventId: (e['event_id'] as string | null) ?? null, eventType: (e['event_type'] as string | null) ?? null,
    status: String(e['status']), patientId: (e['patient_id'] as string | null) ?? null, errorCode: (e['error_code'] as string | null) ?? null,
    detail: (e['detail'] as Record<string, unknown> | null) ?? {}, receivedAt: String(e['received_at']),
  }))
  return { ok: true, connection: connectionView(r.row), events }
}

/** Generate (first time or after disconnect) or rotate the shared secret. The secret is returned once. */
export async function issueSecret(
  db: SupabaseClient, input: { clinicId: string; userId: string }, now: Date = new Date(),
): Promise<{ ok: true; secret: string; rotated: boolean; connection: ConnectionView } | Fail> {
  const r = await readConnection(db, input.clinicId)
  if (!r.ok) return UNAVAILABLE('The EHR connection could not be read.')
  const secret = newSharedSecret()
  const at = now.toISOString()

  if (r.row?.secret_vault_id) {
    const { error } = await db.rpc('rotate_vault_secret', { p_secret_id: r.row.secret_vault_id, p_new_secret: secret })
    if (error) return UNAVAILABLE('The secret could not be rotated.')
    const { data, error: updError } = await db.from('ehr_connections')
      .update({ secret_rotated_at: at, secret_rotated_by: input.userId, last_error_at: null, last_error_code: null })
      .eq('connection_id', r.row.connection_id).select(COLUMNS).single()
    // The Vault entry already holds the new secret; the row only records when.
    if (updError || !data) console.error(`[ehr-sync] rotation time not recorded | connection=${r.row.connection_id}`)
    return { ok: true, secret, rotated: true, connection: connectionView((data as ConnectionRow | null) ?? r.row) }
  }

  const { data: vaultId, error: vaultError } = await db.rpc('create_vault_secret', { p_name: `ehr_keragon_${input.clinicId}_${now.getTime()}`, p_secret: secret })
  if (vaultError || !vaultId) return UNAVAILABLE('The secret could not be stored.')
  const fields = {
    secret_vault_id: vaultId as string, connected_at: at, secret_rotated_at: at, secret_rotated_by: input.userId,
    disconnected_at: null, disconnected_by: null, last_error_at: null, last_error_code: null,
  }
  const { data, error } = r.row
    ? await db.from('ehr_connections').update(fields).eq('connection_id', r.row.connection_id).select(COLUMNS).single()
    : await db.from('ehr_connections').insert({ clinic_id: input.clinicId, provider: PROVIDER, ...fields }).select(COLUMNS).single()
  if (error || !data) {
    const { error: undoError } = await db.rpc('delete_vault_secret', { p_secret_id: vaultId })
    if (undoError) console.error('[ehr-sync] CRITICAL: an unused Vault secret could not be deleted')
    return UNAVAILABLE('The connection could not be saved.')
  }
  return { ok: true, secret, rotated: false, connection: connectionView(data as ConnectionRow) }
}

export async function disconnect(db: SupabaseClient, input: { clinicId: string; userId: string }, now: Date = new Date()): Promise<{ ok: true; connection: ConnectionView } | Fail> {
  const r = await readConnection(db, input.clinicId)
  if (!r.ok) return UNAVAILABLE('The EHR connection could not be read.')
  if (!r.row || connectionStatus(r.row) !== 'connected') return { ok: true, connection: connectionView(r.row) }
  // Refuse requests first, then remove the secret.
  const { data, error } = await db.from('ehr_connections')
    .update({ secret_vault_id: null, disconnected_at: now.toISOString(), disconnected_by: input.userId })
    .eq('connection_id', r.row.connection_id).select(COLUMNS).single()
  if (error || !data) return UNAVAILABLE('The connection could not be disconnected.')
  const { error: vaultError } = await db.rpc('delete_vault_secret', { p_secret_id: r.row.secret_vault_id })
  if (vaultError) console.error(`[ehr-sync] the Vault secret of a disconnected connection could not be deleted | connection=${r.row.connection_id}`)
  return { ok: true, connection: connectionView(data as ConnectionRow) }
}

/** Ops: every clinic's connection status. */
export async function listConnections(db: SupabaseClient): Promise<{ ok: true; connections: Array<ConnectionView & { clinicId: string; clinicName: string }> } | Fail> {
  const { data, error } = await db.from('ehr_connections').select(COLUMNS).eq('provider', PROVIDER).order('created_at', { ascending: false })
  if (error) return UNAVAILABLE('The EHR connections could not be read.')
  const rows = (data ?? []) as ConnectionRow[]
  const ids = [...new Set(rows.map(r => r.clinic_id))]
  const names = new Map<string, string>()
  if (ids.length > 0) {
    const { data: clinics, error: clinicError } = await db.from('clinics').select('clinic_id, name').in('clinic_id', ids)
    if (clinicError) return UNAVAILABLE('The clinics could not be read.')
    for (const c of (clinics ?? []) as Array<{ clinic_id: string; name: string }>) names.set(c.clinic_id, c.name)
  }
  return { ok: true, connections: rows.map(r => ({ ...connectionView(r), clinicId: r.clinic_id, clinicName: names.get(r.clinic_id) ?? r.clinic_id })) }
}

// ── For the webhook ──────────────────────────────────────────

export type SecretLookup =
  | { ok: true; connectionId: string; clinicId: string; secret: string }
  | { ok: false; reason: 'unknown' | 'unavailable' }

/** The connection and its secret, or unknown (not found, not connected). */
export async function connectionSecret(db: SupabaseClient, connectionId: string): Promise<SecretLookup> {
  const { data, error } = await db.from('ehr_connections').select(COLUMNS).eq('connection_id', connectionId).eq('provider', PROVIDER).maybeSingle()
  if (error) return { ok: false, reason: 'unavailable' }
  const row = data as ConnectionRow | null
  if (!row || connectionStatus(row) !== 'connected') return { ok: false, reason: 'unknown' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: vaultRow, error: vaultError } = await (db as any).schema('vault').from('decrypted_secrets')
    .select('decrypted_secret').eq('id', row.secret_vault_id).maybeSingle()
  if (vaultError) return { ok: false, reason: 'unavailable' }
  const secret = (vaultRow as { decrypted_secret?: string } | null)?.decrypted_secret
  if (!secret) return { ok: false, reason: 'unknown' }
  return { ok: true, connectionId: row.connection_id, clinicId: row.clinic_id, secret }
}

/** Note an error on the connection (a code only). Failures are logged. */
export async function noteConnectionError(db: SupabaseClient, connectionId: string, code: string, now: Date): Promise<void> {
  const { error } = await db.from('ehr_connections').update({ last_error_at: now.toISOString(), last_error_code: code }).eq('connection_id', connectionId)
  if (error) console.error(`[ehr-sync] connection error not recorded | connection=${connectionId} | code=${code}`)
}
