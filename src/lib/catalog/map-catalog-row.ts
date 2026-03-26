// ============================================================
// Catalog row mappers — NB-01/02 shared utility
// ============================================================
//
// Shared mappers used by both the API route (GET /api/ops/catalog)
// and the server page (ops/catalog/page.tsx) to avoid duplication.

import type {
  CatalogItem, CatalogUploadVersion, NormalizedEntry, PharmacySyncStatus,
} from '@/app/api/ops/catalog/route'

export function mapCatalogItem(r: unknown): CatalogItem {
  const row      = r as Record<string, unknown>
  const pharmacy = row['pharmacies'] as { name: string } | null
  return {
    itemId:            row['item_id']             as string,
    pharmacyId:        row['pharmacy_id']         as string,
    pharmacyName:      pharmacy?.name ?? '—',
    medicationName:    row['medication_name']      as string,
    form:              row['form']                as string,
    dose:              row['dose']                as string,
    wholesalePrice:    row['wholesale_price']      as number,
    retailPrice:       (row['retail_price']        as number | null) ?? null,
    regulatoryStatus:  row['regulatory_status']   as string,
    requiresPriorAuth: (row['requires_prior_auth'] as boolean) ?? false,
    normalizedId:      (row['normalized_id']       as string | null) ?? null,
    createdAt:         row['created_at']           as string,
    updatedAt:         row['updated_at']           as string,
  }
}

export function mapUploadVersion(r: unknown): CatalogUploadVersion {
  const row      = r as Record<string, unknown>
  const pharmacy = row['pharmacies'] as { name: string } | null
  const delta    = row['delta_summary'] as { added?: number; modified?: number; removed?: number } ?? {}
  return {
    historyId:     row['history_id']    as string,
    pharmacyId:    row['pharmacy_id']   as string,
    pharmacyName:  pharmacy?.name ?? '—',
    uploader:      row['uploader']      as string,
    uploadSource:  row['upload_source'] as string,
    versionNumber: row['version_number'] as number,
    rowCount:      row['row_count']     as number,
    deltaSummary:  { added: delta.added ?? 0, modified: delta.modified ?? 0, removed: delta.removed ?? 0 },
    isActive:      (row['is_active']    as boolean) ?? true,
    uploadedAt:    row['uploaded_at']   as string,
  }
}

export function mapNormalizedEntry(r: unknown): NormalizedEntry {
  const row      = r as Record<string, unknown>
  const pharmacy = row['pharmacies'] as { name: string } | null
  return {
    normalizedId:   row['normalized_id']    as string,
    canonicalName:  row['canonical_name']   as string,
    form:           row['form']             as string,
    dose:           row['dose']             as string,
    pharmacyId:     row['pharmacy_id']      as string,
    pharmacyName:   pharmacy?.name ?? '—',
    wholesalePrice: (row['wholesale_price'] as number | null) ?? null,
    confidence:     (row['confidence_score'] as number | null) ?? null,
  }
}

export function mapPharmacySyncStatus(r: unknown): PharmacySyncStatus {
  const row = r as Record<string, unknown>
  return {
    pharmacyId:   row['pharmacy_id']             as string,
    pharmacyName: row['name']                    as string,
    tier:         row['integration_tier']        as string,
    lastSyncedAt: (row['catalog_last_synced_at'] as string | null) ?? null,
  }
}
