// ============================================================
// Draft reassignment constants — WO-100
// ============================================================
//
// Shared between POST /api/orders/[orderId]/reassign-to-me (writer) and
// anything that reads order_status_history for the audit trail.

/** metadata.actor value on the DRAFT → DRAFT audit row written by "Sign as me". */
export const REASSIGN_AUDIT_ACTOR = 'provider_reassign_to_self'
