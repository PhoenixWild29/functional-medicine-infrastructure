// ============================================================
// PHI access log for the ops fax queue (B14)
// ============================================================
// Shared between:
//   src/app/(ops-dashboard)/ops/fax/page.tsx  (server component)
//   src/app/api/ops/fax/route.ts              (API route)
//
// The queue hands out 15-minute signed URLs to inbound fax PDFs (PHI). One
// 'view' / 'inbound_fax' row per matched order (the order, its patient and
// its clinic, so that clinic's admin sees the access), and one row with no
// ids when an unmatched fax is shown. phi_access_log has no fax id column,
// so a fax is identified by its order only. A read: the caller serves the
// queue whatever this returns (a failed write is already alerted).
// The rows are as selected, with orders(..., patient_id, clinic_id).

import { logPhiAccess, type PhiUser } from '@/lib/audit/phi-access'

export async function logFaxQueueView(
  entry: { user: PhiUser | null | undefined; route: string; headers: Headers | null },
  rows: ReadonlyArray<unknown>,
): Promise<boolean> {
  const byOrder = new Map<string, { patientId: string | null; clinicId: string | null }>()
  let unmatched = false
  for (const row of rows) {
    const r = row as Record<string, unknown>
    const orderId = (r['matched_order_id'] as string | null) ?? null
    if (!orderId) { unmatched = true; continue }
    const order = r['orders'] as { patient_id?: string | null; clinic_id?: string | null } | null
    byOrder.set(orderId, { patientId: order?.patient_id ?? null, clinicId: order?.clinic_id ?? null })
  }
  const base = { user: entry.user, action: 'view' as const, resource: 'inbound_fax' as const, route: entry.route, headers: entry.headers }
  const writes = [...byOrder].map(([orderId, o]) =>
    logPhiAccess({ ...base, orderId, patientId: o.patientId, clinicId: o.clinicId }))
  if (unmatched) writes.push(logPhiAccess(base))
  return (await Promise.all(writes)).every(Boolean)
}
