// ============================================================
// Ops access reasons (B13, emergency access): pure, client-safe
// ============================================================
//
// Ops opens a patient's order (the pipeline drawer) only after saying
// why. The reason is a code from this list, sent in the
// x-ops-access-reason header and logged with the access as a second
// phi_access_log row whose resource is ops_reason_<code> (same order,
// patient and clinic), so the clinic's admin sees it in their access log.
//
// A code, not free text: phi_access_log has no reason column, and a code
// fits the resource CHECK (^[a-z_]{1,40}$) with no migration. A free-text
// note needs a reason column (docs/compliance/emergency-access-procedure.md).

export const OPS_ACCESS_REASON_HEADER = 'x-ops-access-reason'

export const OPS_ACCESS_REASONS = [
  { code: 'support_request',   label: 'A clinic asked for help with this order' },
  { code: 'order_exception',   label: 'The order is stuck, failed or needs rerouting' },
  { code: 'payment_issue',     label: 'A payment, refund or dispute' },
  { code: 'pharmacy_issue',    label: 'A pharmacy question or problem' },
  { code: 'compliance_review', label: 'A compliance or audit review' },
  { code: 'emergency',         label: 'Emergency access (break-glass): urgent patient safety' },
] as const

export type OpsAccessReasonCode = (typeof OPS_ACCESS_REASONS)[number]['code']
export type OpsAccessReasonResource = `ops_reason_${OpsAccessReasonCode}`

const CODES: ReadonlySet<string> = new Set(OPS_ACCESS_REASONS.map(r => r.code))

/** A listed code, exactly as sent, or null. */
export function parseOpsAccessReason(value: string | null | undefined): OpsAccessReasonCode | null {
  return typeof value === 'string' && CODES.has(value) ? value as OpsAccessReasonCode : null
}

export function opsAccessReasonResource(code: OpsAccessReasonCode): OpsAccessReasonResource {
  return `ops_reason_${code}`
}

/** The clinic access log's label for each ops_reason_<code> resource. */
export const OPS_ACCESS_REASON_RESOURCE_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  OPS_ACCESS_REASONS.map(r => [opsAccessReasonResource(r.code), `Reason given by CompoundIQ operations: ${r.label}`]),
)
