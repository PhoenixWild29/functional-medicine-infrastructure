// ============================================================
// Transmission guard: what may be sent to a pharmacy (HIPAA B6, B7, B17)
// ============================================================
//
// B6   Nothing unsigned is sent. Every send path (routeOrder for Tier 1, 2,
//      3 and 4 and the cascade, submitQueuedFax for ops force/retry fax, the
//      fax-retry cron, the sla-check cascade, the internal adapters/submit
//      route) reaches an adapter, and every adapter loads the order through
//      loadTransmittableOrder: locked_at, a provider signature, and a status
//      from which a send is allowed. routeOrder and submitQueuedFax check
//      before dispatch too, so a refusal lands as a failure reason for ops
//      instead of cascading.
// B7   The keyed signature still matches the content (lib/orders/signature-
//      binding). B's review (2026-10-26):
//      T1 an order signed before binding ("legacy") is sent only with its
//         service-written signing history row; any other bare digest, a
//         value computed without the server key, or no key in production
//         is refused;
//      T2 the order goes to the pharmacy it was signed for unless the ops
//         reroute's keyed proof names the new one; the caller's pharmacy
//         must be the order's; the patient and prescriber sent are the
//         signing snapshots, not live rows;
//      T3 the adapters build the payload from the row verified here (one
//         read);
//      T6 a patient whose allergies changed after signing is refused with
//         its own reason (cancel and prescribe again).
// B17  Tier 1 and Tier 2 pharmacy URLs must be https: the configured URLs,
//      the portal flows' navigate steps, every request of the portal browser
//      (enforceHttpsOnly) and the page before anything is typed
//      (assertPageSecure). http only to localhost while NODE_ENV is 'test'.
//
// A refusal throws TransmissionRefusedError with a code; the callers turn
// the code into SUBMISSION_FAILED / FAX_FAILED metadata and an alert. Logs
// carry order ids and codes only, never content, URLs or the key.

import type { APIResponse, BrowserContext } from 'playwright'
import { allergyStatus } from '@/lib/patients/allergies'
import {
  SIGNED_ORDER_COLUMNS,
  isBindingKeyMissingError,
  legacySignatureProven,
  rerouteProven,
  sameCanonical,
  verifySignatureBinding,
  type PatientSnapshot,
  type PrescriberSnapshot,
  type SignedOrderRow,
  type StatusHistoryRow,
} from '@/lib/orders/signature-binding'

export type TransmissionRefusalCode =
  | 'unsigned_order'
  | 'order_not_submittable'
  | 'signature_mismatch'
  | 'insecure_pharmacy_url'
  | 'pharmacy_mismatch'
  | 'allergies_changed'
  | 'binding_key_missing'

export const TRANSMISSION_REFUSAL_CODES: readonly TransmissionRefusalCode[] = [
  'unsigned_order', 'order_not_submittable', 'signature_mismatch', 'insecure_pharmacy_url',
  'pharmacy_mismatch', 'allergies_changed', 'binding_key_missing',
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

/** Every order column an adapter builds from, plus what the guard checks. */
export const SEND_ORDER_COLUMNS = [...new Set([
  ...SIGNED_ORDER_COLUMNS.split(', '),
  'order_number', 'clinic_id', 'provider_id', 'formulation_id', 'catalog_item_id', 'fax_attempt_count', 'created_at',
  'shipping_address_snapshot_at',
])].join(', ')

const SEND_PATIENT_COLUMNS = 'first_name, last_name, date_of_birth, address_line1, address_line2, city, state, zip, allergies, nkda'

/** The order row an adapter sends from: the verified one. */
export type SendOrderRow = SignedOrderRow & Record<string, unknown>

export interface SendPatient {
  /** '' when missing: the adapters refuse a patient without a name or date of birth. */
  first_name:    string
  last_name:     string
  date_of_birth: string | null
  address_line1: string | null
  address_line2: string | null
  city:          string | null
  state:         string | null
  zip:           string | null
  allergies:     string[] | null
  nkda:          boolean | null
}

export interface SendPrescriber {
  first_name:    string
  last_name:     string
  npi_number:    string
  dea_number:    string | null
  license_state: string
}

export interface TransmittableOrder {
  order:      SendOrderRow
  /** Name and date of birth from the signing snapshot (live only for a legacy order); allergies live (checked equal). */
  patient:    SendPatient
  /** The signing snapshot, NPI from provider_npi_snapshot (live only for a legacy order). */
  prescriber: SendPrescriber
  signature:  'bound' | 'legacy'
}

interface QueryClient {
  from: (table: string) => unknown
}
const text = (v: string | null | undefined): string => v ?? ''

type Eq<T> = { select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => PromiseLike<{ data: T | null; error: { message: string } | null }> } } }
type History = { select: (c: string) => { eq: (k: string, v: string) => PromiseLike<{ data: StatusHistoryRow[] | null; error: { message: string } | null }> } }

function refuse(orderId: string, code: TransmissionRefusalCode, message: string): never {
  console.error(`[transmission-guard] send refused | order=${orderId} | code=${code}`)
  throw new TransmissionRefusedError(code, message)
}

const asObject = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null

/**
 * The one read of the order an adapter sends from, verified. Throws
 * TransmissionRefusedError unless the order may be sent now (to
 * opts.pharmacyId when the caller names one). A read that fails throws a
 * plain Error (nothing is sent blind).
 */
export async function loadTransmittableOrder(
  supabase: QueryClient,
  orderId: string,
  opts: { pharmacyId?: string } = {},
): Promise<TransmittableOrder> {
  const db = supabase as unknown as { from: (t: string) => unknown }
  const { data: order, error } = await (db.from('orders') as Eq<SendOrderRow>).select(SEND_ORDER_COLUMNS).eq('order_id', orderId).maybeSingle()
  if (error) throw new Error(`Order ${orderId} could not be read to check its signature, so it was not sent: ${error.message}`)
  if (!order) throw new Error(`Order ${orderId} not found, so it was not sent`)

  // B6
  if (!order.locked_at || !order.provider_signature_hash_snapshot) {
    refuse(orderId, 'unsigned_order', `Order ${orderId} has not been signed, so it was not sent`)
  }
  if (!order.status || !SUBMITTABLE_STATUSES.includes(order.status)) {
    refuse(orderId, 'order_not_submittable', `Order ${orderId} is ${order.status ?? 'without a status'}, which cannot be sent`)
  }

  // B7 / T1
  let verdict: ReturnType<typeof verifySignatureBinding>
  try {
    verdict = verifySignatureBinding(order)
  } catch (err) {
    if (isBindingKeyMissingError(err)) {
      refuse(orderId, 'binding_key_missing', `RX_BINDING_SECRET is not set, so order ${orderId} was not sent`)
    }
    throw err
  }
  if (verdict === 'unsigned') refuse(orderId, 'unsigned_order', `Order ${orderId} has not been signed, so it was not sent`)
  if (verdict === 'mismatch') {
    refuse(orderId, 'signature_mismatch', `Order ${orderId} no longer matches what the provider signed, so it was not sent`)
  }

  // T2: the destination pharmacy.
  if (opts.pharmacyId !== undefined && opts.pharmacyId !== order.pharmacy_id) {
    refuse(orderId, 'pharmacy_mismatch', `Order ${orderId} was asked to go to a pharmacy that is not its own, so it was not sent`)
  }
  const signedPharmacy = asObject(order.pharmacy_snapshot)?.['pharmacy_id'] ?? null
  const pharmacyChanged = !order.pharmacy_id || (typeof signedPharmacy === 'string' ? signedPharmacy !== order.pharmacy_id : verdict === 'match')

  // History is read only when something must be proven from it.
  let history: StatusHistoryRow[] | null = null
  const readHistory = async (): Promise<StatusHistoryRow[]> => {
    if (history) return history
    const { data, error: historyError } = await (db.from('order_status_history') as History)
      .select('old_status, new_status, metadata, created_at')
      .eq('order_id', orderId)
    if (historyError) throw new Error(`Order ${orderId}: its status history could not be read, so it was not sent: ${historyError.message}`)
    history = data ?? []
    return history
  }

  if (verdict === 'legacy' && !legacySignatureProven(order, await readHistory())) {
    refuse(orderId, 'signature_mismatch', `Order ${orderId} carries a signature value no signing record proves, so it was not sent`)
  }
  if (pharmacyChanged) {
    let proven = false
    try {
      proven = rerouteProven(order, await readHistory())
    } catch (err) {
      if (isBindingKeyMissingError(err)) refuse(orderId, 'binding_key_missing', `RX_BINDING_SECRET is not set, so order ${orderId} was not sent`)
      throw err
    }
    if (!proven) refuse(orderId, 'pharmacy_mismatch', `Order ${orderId} is set to a pharmacy it was not signed for, with no ops reroute, so it was not sent`)
  }

  // The patient: live row (allergies, legacy name and address), read once.
  const { data: live, error: patientError } = await (db.from('patients') as Eq<SendPatient & { first_name: string | null; last_name: string | null }>).select(SEND_PATIENT_COLUMNS).eq('patient_id', order.patient_id).maybeSingle()
  if (patientError) throw new Error(`Order ${orderId}: the patient could not be read, so it was not sent: ${patientError.message}`)
  if (!live) throw new Error(`Order ${orderId}: the patient was not found, so it was not sent`)

  if (verdict === 'legacy') {
    console.warn(`[transmission-guard] order=${orderId} was signed before signature binding; sent without the content check`)
    const { data: provider, error: providerError } = await (db.from('providers') as Eq<{ [K in keyof SendPrescriber]: string | null }>)
      .select('first_name, last_name, npi_number, dea_number, license_state')
      .eq('provider_id', String(order['provider_id'] ?? ''))
      .maybeSingle()
    if (providerError) throw new Error(`Order ${orderId} was not sent: provider ${String(order['provider_id'] ?? '')} could not be read: ${providerError.message}`)
    if (!provider) throw new Error(`Order ${orderId}: the prescriber was not found, so it was not sent`)
    return {
      order, signature: 'legacy',
      patient: { ...live, first_name: text(live.first_name), last_name: text(live.last_name) },
      prescriber: {
        first_name: text(provider.first_name), last_name: text(provider.last_name),
        npi_number: text(order.provider_npi_snapshot ?? provider.npi_number),
        dea_number: provider.dea_number, license_state: text(provider.license_state),
      },
    }
  }

  // T6: the allergies the pharmacy will receive must be the ones signed.
  const patientSnap = asObject(order.patient_snapshot) as PatientSnapshot | null
  const prescriberSnap = asObject(order.prescriber_snapshot) as PrescriberSnapshot | null
  if (!patientSnap || !prescriberSnap) {
    refuse(orderId, 'signature_mismatch', `Order ${orderId} has no signing snapshot, so it was not sent`)
  }
  if (!sameCanonical(allergyStatus(live), patientSnap.allergy_status)) {
    refuse(orderId, 'allergies_changed', `Order ${orderId}: the patient's allergies changed after signing, so it was not sent`)
  }

  return {
    order,
    signature: 'bound',
    // T2: the name and date of birth signed; address from the shipping snapshot (shippingAddressFor).
    patient: { ...live, first_name: text(patientSnap.first_name), last_name: text(patientSnap.last_name), date_of_birth: patientSnap.date_of_birth },
    prescriber: {
      first_name:    text(prescriberSnap.first_name),
      last_name:     text(prescriberSnap.last_name),
      npi_number:    text(order.provider_npi_snapshot ?? prescriberSnap.npi_number),
      dea_number:    prescriberSnap.dea_number,
      license_state: text(prescriberSnap.license_state),
    },
  }
}

/** The check alone (routeOrder, submitQueuedFax): 'bound' or 'legacy', or a refusal. */
export async function assertOrderTransmittable(
  supabase: QueryClient,
  orderId: string,
  opts: { pharmacyId?: string } = {},
): Promise<'bound' | 'legacy'> {
  return (await loadTransmittableOrder(supabase, orderId, opts)).signature
}

// ── B17: https only ─────────────────────────────────────────────

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

/** Every navigate step of these portal flows must be https (credentials are typed into those pages). */
export function assertSecureFlowUrls(flows: readonly unknown[], ctx: { orderId: string; pharmacyId: string }): void {
  for (const flow of flows) {
    for (const step of Array.isArray(flow) ? flow as Array<{ action?: unknown; url?: unknown }> : []) {
      if (step?.action === 'navigate') {
        assertSecurePharmacyUrl(typeof step.url === 'string' ? step.url : null, { ...ctx, what: 'portal flow URL' })
      }
    }
  }
}

/** At most this many redirect hops are followed for one portal request. */
export const MAX_PORTAL_REDIRECTS = 5

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308])
/** Request headers that describe a body: dropped when a redirect turns the request into a GET. */
const BODY_HEADERS = ['content-type', 'content-length', 'content-encoding', 'content-language', 'content-location']
/** Credentials a browser does not carry to another origin on a redirect. */
const ORIGIN_BOUND_HEADERS = ['cookie', 'authorization']

const sameOrigin = (a: string, b: string) => {
  try { return new URL(a).origin === new URL(b).origin } catch { return false }
}

/**
 * T5 / T7: no request of this browser context, and no redirect hop, goes
 * to a URL that is not https (isAllowed; tests pass their own rule).
 *
 * A context route sees only the first URL of a redirect chain, and a 3xx
 * handed back to Chromium is followed past the route (D's verification;
 * B's review R1: 302 -> 301 -> http reached the blocked origin, and
 * 307 -> 307 -> http re-sent a form body). So the chain is followed HERE,
 * hop by hop, with route.fetch({ maxRedirects: 0 }):
 *   - every Location is checked with the same rule before it is fetched;
 *   - 307 / 308 keep the method and the body; 303, and 301 / 302 after a
 *     POST, continue as GET with no body (as browsers do);
 *   - a hop to another origin carries no Cookie or Authorization header
 *     (the context's cookie store supplies that origin's own cookies);
 *   - at most MAX_PORTAL_REDIRECTS hops.
 * Only the final, non-redirect answer is given to the browser. A refused
 * hop aborts the request; the reason is logged as a code, never a URL.
 * page.url() therefore stays the first URL of the chain, which was checked.
 */
export async function enforceHttpsOnly(
  context: Pick<BrowserContext, 'route'>,
  isAllowed: (url: string) => boolean = isSecurePharmacyUrl,
): Promise<void> {
  await context.route('**/*', async route => {
    const request = route.request()
    const first = request.url()
    if (!isAllowed(first)) {
      await route.abort('blockedbyclient')
      return
    }
    const refuse = async (code: string) => {
      console.error(`[transmission-guard] portal request refused | code=${code}`)
      await route.abort('blockedbyclient')
    }

    let url = first
    // The request's method, body and headers, read when a redirect is followed.
    let method = ''
    let postData: Buffer | undefined
    let headers: Record<string, string> = {}
    for (let hop = 0; ; hop++) {
      let response: APIResponse
      try {
        response = hop === 0
          ? await route.fetch({ maxRedirects: 0 })
          // Always an explicit body (A's V1): an omitted postData makes
          // route.fetch re-send the original one, so a GET passes an empty body.
          : await route.fetch({ url, method, headers, maxRedirects: 0, postData: postData ?? Buffer.alloc(0) })
      } catch {
        await route.abort('failed')
        return
      }
      const status = response.status()
      if (!REDIRECT_STATUSES.has(status)) {
        await route.fulfill({ response })
        return
      }
      if (hop >= MAX_PORTAL_REDIRECTS) return refuse('too_many_redirects')

      const location = response.headers()['location']
      let next: string | null = null
      try { next = location ? new URL(location, url).toString() : null } catch { next = null }
      if (!next || !isAllowed(next)) return refuse('insecure_pharmacy_url')

      if (hop === 0) {
        method = request.method()
        postData = request.postDataBuffer() ?? undefined
        headers = { ...request.headers() }
      }
      if (status === 303 ? method !== 'HEAD' : (status === 301 || status === 302) && method === 'POST') {
        method = 'GET'
        postData = undefined
        headers = Object.fromEntries(Object.entries(headers).filter(([k]) => !BODY_HEADERS.includes(k.toLowerCase())))
      }
      if (!sameOrigin(url, next)) {
        headers = Object.fromEntries(Object.entries(headers).filter(([k]) => !ORIGIN_BOUND_HEADERS.includes(k.toLowerCase())))
      }
      url = next
    }
  })
}

/** T5: nothing is typed on a page that is not https, whatever got the browser there. */
export function assertPageSecure(page: { url: () => string }): void {
  if (!isSecurePharmacyUrl(page.url())) {
    console.error('[transmission-guard] portal page is not https; nothing typed | code=insecure_pharmacy_url')
    throw new TransmissionRefusedError('insecure_pharmacy_url', 'The portal page is not https, so nothing was typed into it')
  }
}
