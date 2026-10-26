// ============================================================
// Signature binding: the signature covers what was signed (HIPAA B7)
// ============================================================
//
// At signing (lib/orders/batch-sign) each order's
// orders.provider_signature_hash_snapshot is
//
//   v3:<signature digest>:<binding>
//
//   signature digest  SHA-256(signature image : signing time) (also on
//                     providers.signature_hash and the history row)
//   binding           HMAC-SHA256, keyed by the server secret
//                     RX_BINDING_SECRET, over a domain tag, the signature
//                     digest, the signing time (locked_at) and the canonical
//                     serialisation of what the pharmacy will receive
//
// B's review (2026-10-26):
// - T1. The binding is keyed, so a value cannot be computed without the
//   server secret; an unkeyed hash of altered content is a mismatch. A bare
//   64-hex value ("legacy", signed before binding) is accepted only when
//   the service-written signing history row proves it
//   (legacySignatureProven), never because it looks like a digest.
// - T2. What the pharmacy receives is bound: the patient's name, date of
//   birth and allergy status and the prescriber's name, NPI, DEA and
//   license state, snapshotted at signing (patient_snapshot,
//   prescriber_snapshot), and the ship-to address snapshot. The adapters
//   send the snapshots, not live rows. The destination pharmacy is the
//   signed one (pharmacy_snapshot) unless the ops reroute recorded a keyed
//   proof for the new one (rerouteBinding / rerouteProven).
//
// No key in production (VERCEL_ENV=production): binding throws
// BindingKeyMissingError, so nothing is signed, rerouted or sent. Elsewhere
// a fixed development key is used, so local runs, CI and E2E work.
//
// The canonical serialisation is a JSON array of [name, value] pairs in a
// fixed order (CANONICAL_FIELDS), objects with their keys sorted at every
// depth, undefined as null. Changing the list needs a new version (v4).
// The order columns it reads (SIGNED_CONTENT_COLUMNS) are also the columns
// the signed-order freeze covers (lib/orders/signed-order-freeze).
//
// Neither the key nor any content is ever logged: callers log order ids
// and codes only.

import { createHmac } from 'node:crypto'
import { allergyStatus, type AllergyStatus, type PatientAllergyFields } from '@/lib/patients/allergies'
import { serverEnv } from '@/lib/env'

export const SIGNATURE_BINDING_VERSION = 'v3'
const DOMAIN = 'compoundiq/rx-signature-binding/v3'
const REROUTE_DOMAIN = 'compoundiq/rx-reroute/v1'
const HEX64 = /^[0-9a-f]{64}$/

/** Not a secret: only ever used outside production, where there is no real PHI. */
const DEVELOPMENT_KEY = 'compoundiq-development-rx-binding-key-not-for-production'

/**
 * Orders signed by the code before this change carry a bare digest. Such
 * an order is accepted as legacy only if its signing history row is older
 * than this instant. Set it to the deploy time when this ships; an order
 * the old code signed after it is refused (fail closed: cancel and
 * prescribe again).
 */
export const LEGACY_SIGNING_CUTOFF = '2026-11-01T00:00:00.000Z'
const LEGACY_SIGNING_ACTORS = ['provider_batch_sign', 'provider_sign_and_send']

export class BindingKeyMissingError extends Error {
  constructor() {
    super('RX_BINDING_SECRET is not set: prescriptions cannot be signed, rerouted or sent')
    this.name = 'BindingKeyMissingError'
  }
}

export function isBindingKeyMissingError(err: unknown): err is BindingKeyMissingError {
  return err instanceof Error && err.name === 'BindingKeyMissingError'
}

/** Whether RX_BINDING_SECRET is set (the health check reports this, never the value). */
export function rxBindingKeyConfigured(): boolean {
  return serverEnv.rxBindingSecret() !== null
}

/** The key, or BindingKeyMissingError in production when it is not set. */
function bindingKey(): string {
  const key = serverEnv.rxBindingSecret()
  if (key) return key
  if (serverEnv.isProductionDeployment()) throw new BindingKeyMissingError()
  return DEVELOPMENT_KEY
}

const hmac = (message: string) => createHmac('sha256', bindingKey()).update(message, 'utf8').digest('hex')

// ── The snapshots taken at signing (T2) ─────────────────────────

export interface PatientSnapshot {
  first_name:     string | null
  last_name:      string | null
  date_of_birth:  string | null
  /** What the prescriber saw: NKDA, the recorded list, or not recorded. */
  allergy_status: AllergyStatus
}

export interface PrescriberSnapshot {
  provider_id:   string | null
  first_name:    string | null
  last_name:     string | null
  npi_number:    string | null
  dea_number:    string | null
  license_state: string | null
}

export function patientSnapshotFor(p: {
  first_name?: string | null; last_name?: string | null; date_of_birth?: string | null
} & PatientAllergyFields): PatientSnapshot {
  return {
    first_name:     p.first_name ?? null,
    last_name:      p.last_name ?? null,
    date_of_birth:  p.date_of_birth ?? null,
    allergy_status: allergyStatus(p),
  }
}

export function prescriberSnapshotFor(p: {
  provider_id?: string | null; first_name?: string | null; last_name?: string | null
  npi_number?: string | null; dea_number?: string | null; license_state?: string | null
}): PrescriberSnapshot {
  return {
    provider_id:   p.provider_id ?? null,
    first_name:    p.first_name ?? null,
    last_name:     p.last_name ?? null,
    npi_number:    p.npi_number ?? null,
    dea_number:    p.dea_number ?? null,
    license_state: p.license_state ?? null,
  }
}

// ── The bound content ───────────────────────────────────────────

export interface SignedOrderRow {
  order_id:                          string
  status?:                           string | null
  locked_at?:                        string | null
  provider_signature_hash_snapshot?: string | null
  pharmacy_id?:                      string | null
  reroute_count?:                    number | null
  patient_id:                        string
  patient_snapshot?:                 unknown
  prescriber_snapshot?:              unknown
  provider_npi_snapshot?:            string | null
  pharmacy_snapshot?:                unknown
  medication_snapshot?:              unknown
  sig_mode?:                         string | null
  sig_text?:                         string | null
  titration_steps?:                  unknown
  cycle_on_days?:                    number | null
  cycle_off_days?:                   number | null
  quantity?:                         number | string | null
  dispense_quantity?:                number | string | null
  dispense_unit?:                    string | null
  days_supply?:                      number | null
  refills?:                          number | null
  package_id?:                       string | null
  package_label?:                    string | null
  package_count?:                    number | null
  syringe_option?:                   string | null
  substitution_allowed?:             boolean | null
  shipping_type?:                    string | null
  shipping_address_line1_snapshot?:  string | null
  shipping_address_line2_snapshot?:  string | null
  shipping_city_snapshot?:           string | null
  shipping_zip_snapshot?:            string | null
  shipping_state_snapshot?:          string | null
  clinical_difference?:              string | null
  diagnosis_code?:                   string | null
  diagnosis_text?:                   string | null
  special_instructions?:             string | null
}

type Column = keyof SignedOrderRow & string
type Field = readonly [name: string, columns: readonly Column[], value: (o: SignedOrderRow) => unknown]
const col = (c: Column): Field => [c, [c], o => o[c]]
const named = (name: string, c: Column): Field => [name, [c], o => o[c]]

/** v3, in this order. */
const CANONICAL_FIELDS: readonly Field[] = [
  col('patient_id'),
  named('patient', 'patient_snapshot'),
  named('prescriber', 'prescriber_snapshot'),
  named('provider_npi', 'provider_npi_snapshot'),
  // The pharmacy the provider signed for (frozen; a reroute changes
  // pharmacy_id only, and needs its own proof).
  named('pharmacy', 'pharmacy_snapshot'),
  // The medication, strength, form and the C8 compounding record.
  named('medication', 'medication_snapshot'),
  col('sig_mode'),
  col('sig_text'),
  col('titration_steps'),
  col('cycle_on_days'),
  col('cycle_off_days'),
  col('quantity'),
  col('dispense_quantity'),
  col('dispense_unit'),
  col('days_supply'),
  col('refills'),
  col('package_id'),
  col('package_label'),
  col('package_count'),
  col('syringe_option'),
  col('substitution_allowed'),
  col('shipping_type'),
  ['ship_to', ['shipping_address_line1_snapshot', 'shipping_address_line2_snapshot', 'shipping_city_snapshot', 'shipping_state_snapshot', 'shipping_zip_snapshot'],
    o => ({
      line1: o.shipping_address_line1_snapshot, line2: o.shipping_address_line2_snapshot,
      city: o.shipping_city_snapshot, state: o.shipping_state_snapshot, zip: o.shipping_zip_snapshot,
    })],
  col('clinical_difference'),
  col('diagnosis_code'),
  col('diagnosis_text'),
  col('special_instructions'),
]

/** The names, in order (for tests and the report). */
export const CANONICAL_FIELD_NAMES: readonly string[] = CANONICAL_FIELDS.map(([name]) => name)

/**
 * The orders columns the binding covers: what the pharmacy receives. The
 * signed-order freeze (migration 20261024000010) is held to this list.
 */
export const SIGNED_CONTENT_COLUMNS: readonly string[] = CANONICAL_FIELDS.flatMap(([, columns]) => columns)

/** What the binding reads, plus what the guard needs. */
export const SIGNED_ORDER_COLUMNS =
  ['order_id', 'status', 'locked_at', 'provider_signature_hash_snapshot', 'pharmacy_id', 'reroute_count', ...SIGNED_CONTENT_COLUMNS].join(', ')

function canonicalValue(v: unknown): unknown {
  if (v === undefined || v === null) return null
  if (typeof v === 'number') return Object.is(v, -0) ? 0 : v
  if (Array.isArray(v)) return v.map(canonicalValue)
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(v as Record<string, unknown>).sort()) out[k] = canonicalValue((v as Record<string, unknown>)[k])
    return out
  }
  return v
}

/** The canonical serialisation of what was signed on one order. */
export function canonicalSignedContent(order: SignedOrderRow): string {
  return JSON.stringify(CANONICAL_FIELDS.map(([name, , value]) => [name, canonicalValue(value(order))]))
}

/** Equal as canonical JSON (for the allergy-status check). */
export function sameCanonical(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonicalValue(a)) === JSON.stringify(canonicalValue(b))
}

/** The signing time as one string, whatever form Postgres returned it in. */
function canonicalTime(t: string): string {
  const d = new Date(t)
  if (Number.isNaN(d.getTime())) throw new Error('signing time is not a timestamp')
  return d.toISOString()
}

/** The keyed binding: the signature, the time and the content, together. */
export function signatureBinding(signatureDigest: string, signedAt: string, content: string): string {
  return hmac(`${DOMAIN}\n${signatureDigest}\n${canonicalTime(signedAt)}\n${content}`)
}

/** The value stored in orders.provider_signature_hash_snapshot at signing. */
export function boundSignatureValue(signatureDigest: string, signedAt: string, content: string): string {
  return `${SIGNATURE_BINDING_VERSION}:${signatureDigest}:${signatureBinding(signatureDigest, signedAt, content)}`
}

export type ParsedSignature =
  | { kind: 'none' }
  | { kind: 'legacy' }
  | { kind: 'bound'; signatureDigest: string; binding: string }
  | { kind: 'malformed' }

export function parseSignatureValue(value: string | null | undefined): ParsedSignature {
  if (value == null || value.trim() === '') return { kind: 'none' }
  if (HEX64.test(value)) return { kind: 'legacy' }
  const parts = value.split(':')
  if (parts.length === 3 && parts[0] === SIGNATURE_BINDING_VERSION && HEX64.test(parts[1]!) && HEX64.test(parts[2]!)) {
    return { kind: 'bound', signatureDigest: parts[1]!, binding: parts[2]! }
  }
  return { kind: 'malformed' }
}

/**
 * Does the order, as it is now, still match what was signed? 'legacy' is
 * only the shape; the caller must still prove it (legacySignatureProven).
 * Throws BindingKeyMissingError in production without the key.
 */
export function verifySignatureBinding(order: SignedOrderRow): 'match' | 'mismatch' | 'legacy' | 'unsigned' {
  if (!order.locked_at) return 'unsigned'
  const parsed = parseSignatureValue(order.provider_signature_hash_snapshot)
  if (parsed.kind === 'none') return 'unsigned'
  if (parsed.kind === 'legacy') return 'legacy'
  if (parsed.kind === 'malformed') return 'mismatch'
  let expected: string
  try {
    expected = signatureBinding(parsed.signatureDigest, order.locked_at, canonicalSignedContent(order))
  } catch (err) {
    if (isBindingKeyMissingError(err)) throw err
    return 'mismatch'
  }
  return expected === parsed.binding ? 'match' : 'mismatch'
}

// ── Proofs from the status history (service-written, append-only) ──

export interface StatusHistoryRow {
  old_status?: string | null
  new_status?: string | null
  created_at?: string | null
  metadata?:   unknown
}

const meta = (r: StatusHistoryRow): Record<string, unknown> =>
  r.metadata && typeof r.metadata === 'object' && !Array.isArray(r.metadata) ? r.metadata as Record<string, unknown> : {}

/**
 * T1: a bare digest is legacy only if the service signed the order before
 * the cutoff: a DRAFT to AWAITING_PAYMENT history row by a signing actor,
 * with no binding marker (the bound signing path always writes one), and,
 * for batch-sign rows, the same digest. order_status_history takes inserts
 * from the service role only, so a clinic user cannot write such a row.
 */
export function legacySignatureProven(columnValue: string, rows: readonly StatusHistoryRow[]): boolean {
  if (!HEX64.test(columnValue)) return false
  const cutoff = Date.parse(LEGACY_SIGNING_CUTOFF)
  return rows.some(r => {
    const m = meta(r)
    if (r.old_status !== 'DRAFT' || r.new_status !== 'AWAITING_PAYMENT') return false
    if (typeof m['actor'] !== 'string' || !LEGACY_SIGNING_ACTORS.includes(m['actor'])) return false
    if (m['signature_binding'] !== undefined) return false
    if (m['actor'] === 'provider_batch_sign' && m['signature_hash'] !== columnValue) return false
    const at = Date.parse(r.created_at ?? '')
    return Number.isFinite(at) && at < cutoff
  })
}

/** T2: the ops reroute's keyed proof that the order may go to newPharmacyId. */
export function rerouteBinding(orderId: string, signatureValue: string, newPharmacyId: string, rerouteCount: number): string {
  return hmac(`${REROUTE_DOMAIN}\n${orderId}\n${signatureValue}\n${newPharmacyId}\n${rerouteCount}`)
}

/**
 * T2: the order's current pharmacy_id was set by the ops reroute. The
 * latest reroute that changed the pharmacy must name the current one and
 * carry a valid keyed proof over this order and its signature.
 */
export function rerouteProven(order: SignedOrderRow, rows: readonly StatusHistoryRow[]): boolean {
  if (!order.pharmacy_id || !order.provider_signature_hash_snapshot) return false
  const changes = rows
    .filter(r => r.new_status === 'REROUTE_PENDING' && typeof meta(r)['new_pharmacy_id'] === 'string' && meta(r)['new_pharmacy_id'] !== '')
    .sort((a, b) => Date.parse(b.created_at ?? '') - Date.parse(a.created_at ?? ''))
  const latest = changes[0]
  if (!latest) return false
  const m = meta(latest)
  if (m['new_pharmacy_id'] !== order.pharmacy_id || typeof m['reroute_binding'] !== 'string' || typeof m['reroute_count'] !== 'number') return false
  return m['reroute_binding'] === rerouteBinding(order.order_id, order.provider_signature_hash_snapshot, order.pharmacy_id, m['reroute_count'])
}

// ── Reads ───────────────────────────────────────────────────────

interface QueryClient {
  from: (table: string) => unknown
}
type InQuery<T> = {
  select: (c: string) => { in: (k: string, v: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }> }
}

/** The signed columns of these orders, read the same way the guard reads them at send. */
export async function readSignedContent(
  supabase: QueryClient,
  orderIds: string[],
): Promise<{ ok: true; orders: Map<string, SignedOrderRow> } | { ok: false; error: string }> {
  const db = supabase as unknown as { from: (t: string) => unknown }
  const { data, error } = await (db.from('orders') as InQuery<SignedOrderRow>)
    .select(SIGNED_ORDER_COLUMNS)
    .in('order_id', orderIds)
  if (error || !data) return { ok: false, error: error?.message ?? 'no data' }
  return { ok: true, orders: new Map(data.map(o => [o.order_id, o])) }
}
