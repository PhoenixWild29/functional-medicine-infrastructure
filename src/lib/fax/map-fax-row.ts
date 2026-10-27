// ============================================================
// Fax row mapper — WO-36
// ============================================================
// Shared between:
//   src/app/(ops-dashboard)/ops/fax/page.tsx  (server component)
//   src/app/api/ops/fax/route.ts              (API route)
//
// Inbound faxes live only in Documo (the webhook stores the Documo fax id,
// never the file; Issue Log 72), so a row carries the ops-only route that
// fetches its PDF from Documo on demand, not a storage URL.

import type { FaxEntry, FaxStatus } from '@/app/api/ops/fax/route'

export function faxPdfUrl(faxId: string): string {
  return `/api/ops/fax/${encodeURIComponent(faxId)}/pdf`
}

export function mapFaxRow(row: unknown): FaxEntry {
  const r        = row as Record<string, unknown>
  const pharmacy = r['pharmacies'] as { name: string; integration_tier: string } | null
  const order    = r['orders']    as { order_number: string | null; status: string } | null

  const faxId = r['fax_id'] as string
  const pharmacyTier = pharmacy?.integration_tier ?? null
  const isAnomalyTier = pharmacyTier === 'TIER_1_API' || pharmacyTier === 'TIER_3_SPEC'

  return {
    faxId,
    documoFaxId:       r['documo_fax_id']   as string,
    fromNumber:        r['from_number']      as string,
    pageCount:         r['page_count']       as number,
    storagePath:       r['storage_path']     as string,
    status:            r['status']           as FaxStatus,
    notes:             (r['notes']           as string | null) ?? null,
    processedBy:       (r['processed_by']    as string | null) ?? null,
    createdAt:         r['created_at']       as string,
    updatedAt:         r['updated_at']       as string,
    pdfUrl:            faxPdfUrl(faxId),
    matchedPharmacyId: (r['matched_pharmacy_id'] as string | null) ?? null,
    pharmacyName:      pharmacy?.name ?? null,
    pharmacyTier,
    matchedOrderId:    (r['matched_order_id'] as string | null) ?? null,
    orderNumber:       order?.order_number ?? null,
    orderStatus:       order?.status ?? null,
    isAnomalyTier,
  }
}
