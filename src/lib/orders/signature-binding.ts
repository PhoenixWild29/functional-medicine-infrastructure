// ============================================================
// Signature binding: the signature covers what was signed (HIPAA B7)
// ============================================================
//
// Before this, orders.provider_signature_hash_snapshot was
// SHA-256(signature image : signing time): it proved a signature was
// captured, but not WHAT was signed. Now, at signing (lib/orders/
// batch-sign), each order's column carries
//
//   v2:<signature digest>:<binding>
//
//   signature digest  SHA-256(signature image : signing time), as before
//                     (also on providers.signature_hash and the history row)
//   binding           SHA-256 over a domain tag, the signature digest, the
//                     signing time (locked_at) and the canonical
//                     serialisation of the order's signed clinical content
//
// At send (lib/adapters/transmission-guard) the binding is recomputed from
// the order as it is now; any difference refuses the send. The column is
// frozen once locked_at is set (prevent_snapshot_mutation), so neither part
// can be rewritten afterwards. A column without the v2 prefix was signed
// before this change ("legacy"): it is sent as before, with a log line.
//
// The canonical serialisation is a JSON array of [name, value] pairs in a
// fixed order (CANONICAL_FIELDS), objects with their keys sorted at every
// depth, undefined as null. Adding, removing or reordering a field changes
// every binding, so it needs a new version (v3), never an edit of v2.
//
// No PHI leaves this module: callers log order ids and codes only.

import { createHash } from 'node:crypto'
import { allergyStatus, type PatientAllergyFields } from '@/lib/patients/allergies'

export const SIGNATURE_BINDING_VERSION = 'v2'
const DOMAIN = 'compoundiq/rx-signature-binding/v2'
const HEX64 = /^[0-9a-f]{64}$/

export interface SignedOrderRow {
  order_id:                         string
  status?:                          string | null
  locked_at?:                       string | null
  provider_signature_hash_snapshot?: string | null
  patient_id:                       string
  provider_npi_snapshot?:           string | null
  pharmacy_snapshot?:               unknown
  medication_snapshot?:             unknown
  sig_mode?:                        string | null
  sig_text?:                        string | null
  titration_steps?:                 unknown
  cycle_on_days?:                   number | null
  cycle_off_days?:                  number | null
  quantity?:                        number | string | null
  dispense_quantity?:               number | string | null
  dispense_unit?:                   string | null
  days_supply?:                     number | null
  refills?:                         number | null
  package_id?:                      string | null
  package_label?:                   string | null
  package_count?:                   number | null
  syringe_option?:                  string | null
  substitution_allowed?:            boolean | null
  shipping_type?:                   string | null
  clinical_difference?:             string | null
  diagnosis_code?:                  string | null
  diagnosis_text?:                  string | null
  special_instructions?:            string | null
}

type Field = readonly [
  name:   string,
  /** The orders column it reads, or null (allergies live on the patient). */
  column: keyof SignedOrderRow | null,
  value:  (o: SignedOrderRow, patient: PatientAllergyFields | null) => unknown,
]

/**
 * v2, in this order. The medication snapshot carries the medication,
 * strength, form and compounding record; the pharmacy snapshot is the
 * pharmacy the provider signed for (frozen, so a reroute, which changes
 * pharmacy_id only, does not change it).
 *
 * The order columns named here are also the clinical columns the database
 * freezes once an order is signed (lib/orders/signed-order-freeze, HIPAA
 * B5): a test holds the freeze migration to this list.
 */
const CANONICAL_FIELDS: readonly Field[] = [
  ['patient_id',           'patient_id',            o => o.patient_id],
  ['provider_npi',         'provider_npi_snapshot', o => o.provider_npi_snapshot],
  ['pharmacy',             'pharmacy_snapshot',     o => o.pharmacy_snapshot],
  ['medication',           'medication_snapshot',   o => o.medication_snapshot],
  ['sig_mode',             'sig_mode',              o => o.sig_mode],
  ['sig_text',             'sig_text',              o => o.sig_text],
  ['titration_steps',      'titration_steps',       o => o.titration_steps],
  ['cycle_on_days',        'cycle_on_days',         o => o.cycle_on_days],
  ['cycle_off_days',       'cycle_off_days',        o => o.cycle_off_days],
  ['quantity',             'quantity',              o => o.quantity],
  ['dispense_quantity',    'dispense_quantity',     o => o.dispense_quantity],
  ['dispense_unit',        'dispense_unit',         o => o.dispense_unit],
  ['days_supply',          'days_supply',           o => o.days_supply],
  ['refills',              'refills',               o => o.refills],
  ['package_id',           'package_id',            o => o.package_id],
  ['package_label',        'package_label',         o => o.package_label],
  ['package_count',        'package_count',         o => o.package_count],
  ['syringe_option',       'syringe_option',        o => o.syringe_option],
  ['substitution_allowed', 'substitution_allowed',  o => o.substitution_allowed],
  ['shipping_type',        'shipping_type',         o => o.shipping_type],
  ['clinical_difference',  'clinical_difference',   o => o.clinical_difference],
  ['diagnosis_code',       'diagnosis_code',        o => o.diagnosis_code],
  ['diagnosis_text',       'diagnosis_text',        o => o.diagnosis_text],
  ['special_instructions', 'special_instructions',  o => o.special_instructions],
  // Allergies live on the patient (Phase 21 rule 4), so the status the
  // provider saw is bound: NKDA, or the recorded list.
  ['allergies',            null,                    (_o, p) => allergyStatus(p)],
]

/** The orders columns the binding covers: the signed clinical content. */
export const SIGNED_CONTENT_COLUMNS: readonly string[] = CANONICAL_FIELDS.flatMap(([, column]) => (column ? [column] : []))

/** What the binding reads, plus what the guard needs. */
export const SIGNED_ORDER_COLUMNS =
  ['order_id', 'status', 'locked_at', 'provider_signature_hash_snapshot', ...SIGNED_CONTENT_COLUMNS].join(', ')

/** The names, in order (for tests and the report). */
export const CANONICAL_FIELD_NAMES: readonly string[] = CANONICAL_FIELDS.map(([name]) => name)

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
export function canonicalSignedContent(order: SignedOrderRow, patient: PatientAllergyFields | null): string {
  return JSON.stringify(CANONICAL_FIELDS.map(([name, , value]) => [name, canonicalValue(value(order, patient))]))
}

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

/** The signing time as one string, whatever form Postgres returned it in. */
function canonicalTime(t: string): string {
  const d = new Date(t)
  if (Number.isNaN(d.getTime())) throw new Error('signing time is not a timestamp')
  return d.toISOString()
}

/** The binding: the signature, the time and the content, together. */
export function signatureBinding(signatureDigest: string, signedAt: string, content: string): string {
  return sha256(`${DOMAIN}\n${signatureDigest}\n${canonicalTime(signedAt)}\n${content}`)
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

/** Does the order, as it is now, still match what was signed? */
export function verifySignatureBinding(
  order: SignedOrderRow,
  patient: PatientAllergyFields | null,
): 'match' | 'mismatch' | 'legacy' | 'unsigned' {
  if (!order.locked_at) return 'unsigned'
  const parsed = parseSignatureValue(order.provider_signature_hash_snapshot)
  if (parsed.kind === 'none') return 'unsigned'
  if (parsed.kind === 'legacy') return 'legacy'
  if (parsed.kind === 'malformed') return 'mismatch'
  let expected: string
  try {
    expected = signatureBinding(parsed.signatureDigest, order.locked_at, canonicalSignedContent(order, patient))
  } catch {
    return 'mismatch'
  }
  return expected === parsed.binding ? 'match' : 'mismatch'
}

interface QueryClient {
  from: (table: string) => unknown
}
type InQuery<T> = {
  select: (c: string) => { in: (k: string, v: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }> }
}

/**
 * The signed columns of these orders and their patients' allergy fields,
 * read the same way at signing and at send.
 */
export async function readSignedContent(
  supabase: QueryClient,
  orderIds: string[],
): Promise<
  | { ok: true; orders: Map<string, SignedOrderRow>; patients: Map<string, PatientAllergyFields> }
  | { ok: false; error: string }
> {
  const db = supabase as unknown as { from: (t: string) => unknown }
  const { data: orders, error: ordersError } = await (db.from('orders') as InQuery<SignedOrderRow>)
    .select(SIGNED_ORDER_COLUMNS)
    .in('order_id', orderIds)
  if (ordersError || !orders) return { ok: false, error: ordersError?.message ?? 'no data' }

  const patientIds = [...new Set(orders.map(o => o.patient_id))]
  const { data: patients, error: patientsError } = patientIds.length === 0
    ? { data: [], error: null }
    : await (db.from('patients') as InQuery<{ patient_id: string } & PatientAllergyFields>)
        .select('patient_id, allergies, nkda')
        .in('patient_id', patientIds)
  if (patientsError || !patients) return { ok: false, error: patientsError?.message ?? 'no data' }

  return {
    ok:       true,
    orders:   new Map(orders.map(o => [o.order_id, o])),
    patients: new Map(patients.map(p => [p.patient_id, { allergies: p.allergies ?? null, nkda: p.nkda ?? null }])),
  }
}

type EqQuery<T> = {
  select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => PromiseLike<{ data: T | null; error: { message: string } | null }> } }
}

/** One order's signed columns and its patient's allergy fields (the send-time read). */
export async function readSignedOrder(
  supabase: QueryClient,
  orderId: string,
): Promise<{ ok: true; order: SignedOrderRow | null; patient: PatientAllergyFields | null } | { ok: false; error: string }> {
  const db = supabase as unknown as { from: (t: string) => unknown }
  const { data: order, error: orderError } = await (db.from('orders') as EqQuery<SignedOrderRow>)
    .select(SIGNED_ORDER_COLUMNS)
    .eq('order_id', orderId)
    .maybeSingle()
  if (orderError) return { ok: false, error: orderError.message }
  if (!order) return { ok: true, order: null, patient: null }

  const { data: patient, error: patientError } = await (db.from('patients') as EqQuery<PatientAllergyFields>)
    .select('allergies, nkda')
    .eq('patient_id', order.patient_id)
    .maybeSingle()
  if (patientError) return { ok: false, error: patientError.message }
  return { ok: true, order, patient: patient ? { allergies: patient.allergies ?? null, nkda: patient.nkda ?? null } : null }
}
