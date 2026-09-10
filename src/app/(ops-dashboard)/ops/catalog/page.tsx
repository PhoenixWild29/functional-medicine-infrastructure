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
// TWO CATALOGS COEXIST on this route, and the page is explicit about which is
// which (see docs/technical/API-REFERENCE.md "Dual catalog"):
//
//   1. The V3 HIERARCHICAL product catalog — ingredients / salt_forms /
//      formulations / pharmacy_formulations. This is what the prescription
//      builder cascade uses (/api/formulations). Rendered read-only at the top
//      of the page as <ProductCatalogSummary />.
//   2. The LEGACY FLAT `catalog` table — one denormalized row per pharmacy
//      medication, populated by the per-pharmacy price-list CSV upload path.
//      That is everything <CatalogManager /> manages.
//
// Before this split, the page read "Catalog Management — N items" where N was
// the legacy row count, which reads as a contradiction next to the hierarchical
// catalog the prescribing UI actually surfaces.
//
// Auth: ops_admin only, enforced OUTSIDE this component — src/middleware.ts
// rejects non-ops_admin on /ops before the page runs, and
// (ops-dashboard)/layout.tsx re-checks the role server-side.
//
// Do NOT re-open a Supabase auth client here. A third getSession() inside the
// streamed page body can rotate the refresh token from a context that cannot
// persist cookies, and a redirect() raised from inside the loading.tsx
// Suspense boundary can never be delivered — the boundary is left unresolved
// and the route hangs on the spinner forever. That was this route's prod bug.
//
// Likewise: the product-catalog counts below are added to the EXISTING
// Promise.all, not to a new Suspense child. PR #122 fixed infinite-spinner
// behavior on these ops routes; do not reintroduce an unbounded await.

import { createServiceClient } from '@/lib/supabase/service'
import { CatalogManager }      from './_components/catalog-manager'
import { ProductCatalogSummary } from './_components/product-catalog-summary'
import type { ProductCatalogCounts } from './_components/product-catalog-summary'
import type { CatalogResponse } from '@/app/api/ops/catalog/route'
import {
  mapCatalogItem, mapUploadVersion, mapNormalizedEntry, mapPharmacySyncStatus,
} from '@/lib/catalog/map-catalog-row'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Catalog | Ops Dashboard',
}

export default async function CatalogPage() {
  const supabase = createServiceClient()

  const [
    itemsResult, versionsResult, normalizedResult, syncResult,
    ingredientsCount, saltFormsCount, formulationsCount, pharmacyFormulationsCount,
  ] = await Promise.all([
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

    // ── V3 hierarchical product-catalog counts (read-only) ───────
    // head: true → COUNT only, no rows over the wire.
    // Filters mirror src/app/api/formulations/route.ts exactly so these
    // numbers agree with what the prescription builder actually shows.
    supabase
      .from('ingredients')
      .select('ingredient_id', { count: 'exact', head: true })
      .eq('is_active', true)
      .is('deleted_at', null),

    supabase
      .from('salt_forms')
      .select('salt_form_id', { count: 'exact', head: true })
      .eq('is_active', true)
      .is('deleted_at', null),

    supabase
      .from('formulations')
      .select('formulation_id', { count: 'exact', head: true })
      .eq('is_active', true)
      .is('deleted_at', null),

    supabase
      .from('pharmacy_formulations')
      .select('pharmacy_formulation_id', { count: 'exact', head: true })
      .eq('is_available', true)
      .eq('is_active', true)
      .is('deleted_at', null),
  ])

  // A failed query must degrade to an empty table, never to a hang.
  // `?? []` below already guarantees that; log so ops can see why it is empty.
  if (itemsResult.error) {
    console.error('[ops/catalog/page] items fetch error:', itemsResult.error.message)
  }
  if (versionsResult.error) {
    console.error('[ops/catalog/page] versions fetch error (non-fatal):', versionsResult.error.message)
  }
  if (normalizedResult.error) {
    console.error('[ops/catalog/page] normalized fetch error (non-fatal):', normalizedResult.error.message)
  }
  if (syncResult.error) {
    console.error('[ops/catalog/page] sync-status fetch error (non-fatal):', syncResult.error.message)
  }

  // ── Map rows using shared mappers (NB-01/02) ─────────────────
  const items      = (itemsResult.data     ?? []).map(r => mapCatalogItem(r))
  const versions   = (versionsResult.data  ?? []).map(r => mapUploadVersion(r))
  const normalized = (normalizedResult.data ?? []).map(r => mapNormalizedEntry(r))
  const syncStatus = (syncResult.data      ?? []).map(r => mapPharmacySyncStatus(r))

  // ── V3 counts → null on error, rendered as an em dash. ───────
  // A count failure is cosmetic; it must never take the route down.
  const countOrNull = (
    label: string,
    result: { count: number | null; error: { message: string } | null },
  ): number | null => {
    if (result.error) {
      console.error(`[ops/catalog/page] ${label} count error (non-fatal):`, result.error.message)
      return null
    }
    return result.count ?? null
  }

  const productCatalogCounts: ProductCatalogCounts = {
    ingredients:       countOrNull('ingredients', ingredientsCount),
    saltForms:         countOrNull('salt_forms', saltFormsCount),
    formulations:      countOrNull('formulations', formulationsCount),
    pharmacyOfferings: countOrNull('pharmacy_formulations', pharmacyFormulationsCount),
  }

  const initialData: CatalogResponse = {
    items,
    totalCount: itemsResult.count ?? items.length,
    versions,
    normalized,
    syncStatus,
    fetchedAt: new Date().toISOString(),
  }

  return (
    <div className="space-y-4">
      <ProductCatalogSummary counts={productCatalogCounts} />
      <CatalogManager initialData={initialData} />
    </div>
  )
}
