// ============================================================
// Transmission guard: what may be sent to a pharmacy (HIPAA B6, B7, B17)
// ============================================================
//
// B6   Nothing unsigned is sent. Every send path (routeOrder for Tier 1, 2,
//      3 and 4 and the cascade, submitQueuedFax for ops force/retry fax, the
//      fax-retry cron, the sla-check cascade, the internal adapters/submit
//      route) reaches an adapter, and every adapter calls
//      assertOrderTransmittable first: locked_at, a provider signature, and
//      a status from which a send is allowed. routeOrder and
//      submitQueuedFax check before dispatch too, so a refusal lands as a
//      failure reason for ops instead of cascading.
// B7   The signature still matches the content (lib/orders/signature-
//      binding). A mismatch is refused; an order signed before binding
//      existed is sent as before, with a log line saying so.
// B17  Tier 1 and Tier 2 pharmacy URLs must be https at send time. http is
//      refused, except a localhost URL while NODE_ENV is 'test'.
//
// A refusal throws TransmissionRefusedError with a code; the callers turn
// the code into SUBMISSION_FAILED / FAX_FAILED metadata and an alert. Logs
// carry order ids and codes only, never content.

import { readSignedOrder, verifySignatureBinding } from '@/lib/orders/signature-binding'

export type TransmissionRefusalCode =
  | 'unsigned_order'
  | 'order_not_submittable'
  | 'signature_mismatch'
  | 'insecure_pharmacy_url'

export const TRANSMISSION_REFUSAL_CODES: readonly TransmissionRefusalCode[] = [
  'unsigned_order', 'order_not_submittable', 'signature_mismatch', 'insecure_pharmacy_url',
]

export class TransmissionRefusedError extends Error {
  readonly code: TransmissionRefusalCode
  constructor(code: TransmissionRefusalCode, message: string) {
    super(message)
    this.name = 'TransmissionRefusedError'
    this.code = code
  }
}

export function isTransmissionRefusedError(err: unknown): err is TransmissionRefusedError {
  return err instanceof Error && err.name === 'TransmissionRefusedError'
}

/**
 * The statuses an adapter may send from: PAID_PROCESSING (the internal
 * adapters/submit route), SUBMISSION_PENDING (claimed by routeOrder) and
 * FAX_QUEUED (ops fax, fax retries, the SLA cascade).
 */
export const SUBMITTABLE_STATUSES: readonly string[] = ['PAID_PROCESSING', 'SUBMISSION_PENDING', 'FAX_QUEUED']

interface QueryClient {
  from: (table: string) => unknown
}

function refuse(orderId: string, code: TransmissionRefusalCode, message: string): never {
  console.error(`[transmission-guard] send refused | order=${orderId} | code=${code}`)
  throw new TransmissionRefusedError(code, message)
}

/**
 * Throws TransmissionRefusedError unless the order may be sent now. A read
 * that fails throws a plain Error (nothing is sent blind).
 * Returns 'legacy' for an order signed before content binding.
 */
export async function assertOrderTransmittable(supabase: QueryClient, orderId: string): Promise<'bound' | 'legacy'> {
  const read = await readSignedOrder(supabase, orderId)
  if (!read.ok) throw new Error(`Order ${orderId} could not be read to check its signature, so it was not sent: ${read.error}`)
  const order = read.order
  if (!order) throw new Error(`Order ${orderId} not found, so it was not sent`)

  if (!order.locked_at || !order.provider_signature_hash_snapshot) {
    refuse(orderId, 'unsigned_order', `Order ${orderId} has not been signed, so it was not sent`)
  }
  if (!order.status || !SUBMITTABLE_STATUSES.includes(order.status)) {
    refuse(orderId, 'order_not_submittable', `Order ${orderId} is ${order.status ?? 'without a status'}, which cannot be sent`)
  }

  const verdict = verifySignatureBinding(order, read.patient)
  if (verdict === 'unsigned') refuse(orderId, 'unsigned_order', `Order ${orderId} has not been signed, so it was not sent`)
  if (verdict === 'mismatch') {
    refuse(orderId, 'signature_mismatch', `Order ${orderId} no longer matches what the provider signed, so it was not sent`)
  }
  if (verdict === 'legacy') {
    console.warn(`[transmission-guard] order=${orderId} was signed before signature binding; sent without the content check`)
    return 'legacy'
  }
  return 'bound'
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** https, or http to localhost while NODE_ENV is 'test'. */
export function isSecurePharmacyUrl(raw: string | null | undefined): boolean {
  if (!raw) return false
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  if (!u.hostname) return false
  if (u.protocol === 'https:') return true
  return u.protocol === 'http:' && process.env['NODE_ENV'] === 'test' && LOCAL_HOSTS.has(u.hostname)
}

/** B17: refuse a Tier 1 / Tier 2 pharmacy URL that is not https. */
export function assertSecurePharmacyUrl(raw: string | null | undefined, ctx: { orderId: string; pharmacyId: string; what: string }): void {
  if (isSecurePharmacyUrl(raw)) return
  // The URL itself is configuration, not PHI, but it is not logged either.
  console.error(`[transmission-guard] send refused | order=${ctx.orderId} | pharmacy=${ctx.pharmacyId} | code=insecure_pharmacy_url | ${ctx.what}`)
  throw new TransmissionRefusedError('insecure_pharmacy_url', `The ${ctx.what} for pharmacy ${ctx.pharmacyId} is not https, so order ${ctx.orderId} was not sent`)
}
