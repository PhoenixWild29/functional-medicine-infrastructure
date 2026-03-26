// ============================================================
// Catalog Management — WO-37
// /ops/catalog
// ============================================================
//
// Server Component: fetches initial catalog data, passes to
// CatalogManager client component.
//
// REQ-CTM-001: CSV upload with validation
// REQ-CTM-002: Bulk insert
// REQ-CTM-003: Version tracking
// REQ-CTM-004: Version comparison
// REQ-CTM-005: Price discrepancy alerting
// REQ-CTM-006: API sync status
// REQ-CTM-007: Normalized catalog view
// REQ-CTM-008: Catalog rollback
//
// Auth: ops_admin required (defense-in-depth; layout also enforces this).

import { redirect }            from 'next/navigation'
import { createServerClient }  from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { CatalogManager }      from './_components/catalog-manager'
import type { CatalogResponse } from '@/app/api/ops/catalog/route'
import {
  mapCatalogItem, mapUploadVersion, mapNormalizedEntry, mapPharmacySyncStatus,
} from '@/lib/catalog/map-catalog-row'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Catalog | Ops Dashboard',
}

export default async function CatalogPage() {
  // Auth guard
  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session || session.user.user_metadata['app_role'] !== 'ops_admin') {
    redirect('/unauthorized')
  }

  const supabase = createServiceClient()

  const [itemsResult, versionsResult, normalizedResult, syncResult] = await Promise.all([
    supabase
      .from('catalog')
      .select('item_id, pharmacy_id, medication_name, form, dose, wholesale_price, retail_price, regulatory_status, requires_prior_auth, normalized_id, created_at, updated_at, pharmacies(name)', { count: 'exact' })
      .is('deleted_at', null)
      .eq('is_active', true)
      .order('medication_name')
      .limit(500),

    supabase
      .from('catalog_upload_history')
      .select('history_id, pharmacy_id, uploader, upload_source, version_number, row_count, delta_summary, is_active, uploaded_at, pharmacies(name)')
      .order('uploaded_at', { ascending: false })
      .limit(100),

    supabase
      .from('normalized_catalog')
      .select('normalized_id, canonical_name, form, dose, pharmacy_id, wholesale_price, confidence_score, pharmacies(name)')
      .eq('is_active', true)
      .order('canonical_name')
      .limit(200),

    supabase
      .from('pharmacies')
      .select('pharmacy_id, name, integration_tier, catalog_last_synced_at')
      .in('integration_tier', ['TIER_1_API', 'TIER_3_SPEC', 'TIER_3_HYBRID'])
      .is('deleted_at', null)
      .eq('is_active', true)
      .order('name'),
  ])

  if (itemsResult.error) {
    console.error('[ops/catalog/page] items fetch error:', itemsResult.error.message)
  }

  // ── Map rows using shared mappers (NB-01/02) ─────────────────
  const items      = (itemsResult.data     ?? []).map(r => mapCatalogItem(r))
  const versions   = (versionsResult.data  ?? []).map(r => mapUploadVersion(r))
  const normalized = (normalizedResult.data ?? []).map(r => mapNormalizedEntry(r))
  const syncStatus = (syncResult.data      ?? []).map(r => mapPharmacySyncStatus(r))

  const initialData: CatalogResponse = {
    items,
    totalCount: itemsResult.count ?? items.length,
    versions,
    normalized,
    syncStatus,
    fetchedAt: new Date().toISOString(),
  }

  return (
    <CatalogManager initialData={initialData} />
  )
}
