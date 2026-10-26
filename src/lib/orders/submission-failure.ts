// ============================================================
// Why sending an order to the pharmacy failed, in plain words
// ============================================================
//
// The clinic order drawer shows one line when an order is in a failed
// submission state: where it was going, why it failed, and what happens
// next. The reason comes from the latest failed adapter_submissions row's
// error_code, mapped here. The adapter's error_message is never shown:
// it can hold stack traces, URLs or pharmacy internals. Unknown codes get
// a generic reason rather than the code itself.

export const SUBMISSION_FAILURE_STATUSES = ['SUBMISSION_FAILED', 'FAX_FAILED', 'PHARMACY_REJECTED'] as const

/** adapter_submissions statuses that record a failed attempt. */
export const FAILED_ADAPTER_STATUSES = ['FAILED', 'REJECTED', 'SUBMISSION_FAILED', 'TIMEOUT', 'PORTAL_ERROR'] as const

export function isSubmissionFailure(status: string | null | undefined): boolean {
  return (SUBMISSION_FAILURE_STATUSES as readonly string[]).includes(status ?? '')
}

const GENERIC = 'the order could not be delivered to the pharmacy'
const NO_RESPONSE = "the pharmacy's system did not respond"
const DECLINED = 'the pharmacy declined the order'
const FAX = 'the fax to the pharmacy did not go through'

const REASONS: Record<string, string> = {
  network_error:           NO_RESPONSE,
  exhausted:               NO_RESPONSE,
  timeout:                 NO_RESPONSE,
  circuit_breaker_opened:  "the pharmacy's system is temporarily unavailable",
  rejected:                DECLINED,
  order_rejected:          DECLINED,
  pharmacy_rejected:       DECLINED,
  drug_unavailable:        'the pharmacy does not have this medication available',
  pharmacy_not_licensed:   "the pharmacy is not licensed for the patient's state",
  fax_send_failed:         FAX,
  tier4_fax_send_failed:   FAX,
  fax_submission_error:    FAX,
  fax_permanently_failed:  FAX,
  portal_automation_error: "the pharmacy's ordering portal had an error",
  // HIPAA B6 / B7 / B17 (lib/adapters/transmission-guard): refused, never sent.
  unsigned_order:          'the prescription has not been signed',
  order_not_submittable:   'the order was not in a state that can be sent',
  signature_mismatch:      'the prescription changed after it was signed',
  insecure_pharmacy_url:   "the pharmacy's connection is not secure (https is required)",
  // B's review T1, T2, T6
  pharmacy_mismatch:       'the order was set to go to a pharmacy it was not signed for',
  allergies_changed:       "the patient's allergies changed after the prescription was signed",
  binding_key_missing:     'prescription signing is not configured on the server',
}

/**
 * Refusals a retry or re-route cannot fix: the prescription must be signed
 * again (B's review T6). The clinic is told to cancel and prescribe again.
 */
const NEEDS_NEW_PRESCRIPTION: ReadonlySet<string> = new Set([
  'allergies_changed', 'signature_mismatch', 'unsigned_order', 'pharmacy_mismatch',
])

/**
 * The code itself, only when the drawer knows it: a key of the plain-reason
 * table or an HTTP status. Anything else (a pharmacy's own code) is null,
 * so the clinic never sees an unknown code (security review, Oct 24).
 */
export function knownFailureCode(code: string | null | undefined): string | null {
  if (!code) return null
  const c = code.trim()
  if (REASONS[c.toLowerCase()] || /^\d{3}$/.test(c)) return code
  return null
}

/** A plain reason for an adapter error code; never the code itself. */
export function plainFailureReason(code: string | null | undefined): string {
  if (!code) return GENERIC
  const known = REASONS[code.trim().toLowerCase()]
  if (known) return known
  // HTTP status codes from the API tier.
  if (/^\d{3}$/.test(code.trim())) {
    const n = Number(code)
    if (n === 401 || n === 403) return "the pharmacy's system refused the connection"
    if (n === 408 || n >= 500) return NO_RESPONSE
    if (n >= 400) return 'the pharmacy could not accept the order details'
  }
  return GENERIC
}

/** The drawer line. Without a reason (the lookup failed), where and what next. */
export function submissionFailureNotice({ pharmacyName, plainReason, code }: { pharmacyName: string | null; plainReason: string | null; code?: string | null }): string {
  const where = `Sending to ${pharmacyName?.trim() || 'the pharmacy'} failed`
  const why = `${where}${plainReason ? `: ${plainReason}` : ''}.`
  if (code && NEEDS_NEW_PRESCRIPTION.has(code)) {
    const after = code === 'allergies_changed' ? ', so the prescriber signs it with the current allergies' : ''
    return `${why} Cancel this prescription and prescribe it again${after}. CompoundIQ ops has been alerted.`
  }
  return `${why} CompoundIQ ops has been alerted and will re-route or retry.`
}
