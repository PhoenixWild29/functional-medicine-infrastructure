// ============================================================
// Fax row mapper — WO-36
// ============================================================
// Shared between:
//   src/app/(ops-dashboard)/ops/fax/page.tsx  (server component)
//   src/app/api/ops/fax/route.ts              (API route)

import type { SupabaseClient } from '@supabase/supabase-js'
import type { FaxEntry, FaxStatus } from '@/app/api/ops/fax/route'

const SIGNED_URL_EXPIRY_SECS = 15 * 60  // REQ-FTQ-007

export async function mapFaxRow(
  row: unknown,
  supabase: SupabaseClient,
): Promise<FaxEntry> {
  const r        = row as Record<string, unknown>
  const pharmacy = r['pharmacies'] as { name: string; integration_tier: string } | null
  const order    = r['orders']    as { order_number: string | null; status: string } | null

  const storagePath = r['storage_path'] as string
  let signedUrl: string | null = null
  if (storagePath) {
    const { data: urlData } = await supabase.storage
      .from('fax-pdfs')
      .createSignedUrl(storagePath, SIGNED_URL_EXPIRY_SECS)
    signedUrl = urlData?.signedUrl ?? null
  }

  const pharmacyTier = pharmacy?.integration_tier ?? null
  const isAnomalyTier = pharmacyTier === 'TIER_1_API' || pharmacyTier === 'TIER_3_SPEC'

  return {
    faxId:             r['fax_id']          as string,
    documoFaxId:       r['documo_fax_id']   as string,
    fromNumber:        r['from_number']      as string,
    pageCount:         r['page_count']       as number,
    storagePath,
    status:            r['status']           as FaxStatus,
    notes:             (r['notes']           as string | null) ?? null,
    processedBy:       (r['processed_by']    as string | null) ?? null,
    createdAt:         r['created_at']       as string,
    updatedAt:         r['updated_at']       as string,
    signedUrl,
    matchedPharmacyId: (r['matched_pharmacy_id'] as string | null) ?? null,
    pharmacyName:      pharmacy?.name ?? null,
    pharmacyTier,
    matchedOrderId:    (r['matched_order_id'] as string | null) ?? null,
    orderNumber:       order?.order_number ?? null,
    orderStatus:       order?.status ?? null,
    isAnomalyTier,
  }
}
