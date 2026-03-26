// ============================================================
// Ops Catalog — GET /api/ops/catalog
// ============================================================
//
// Returns catalog items with optional pharmacy/status filters,
// plus version history and normalized catalog entries.
//
// REQ-CTM-001: CSV upload validation (handled in /upload route)
// REQ-CTM-003: Version tracking — returns upload history
// REQ-CTM-007: Normalized catalog view
//
// Query params:
//   pharmacyId  — filter by pharmacy UUID
//   status      — regulatory_status filter
//   search      — medication_name free-text search
//
// Auth: ops_admin only.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient }  from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import {
  mapCatalogItem, mapUploadVersion, mapNormalizedEntry, mapPharmacySyncStatus,
} from '@/lib/catalog/map-catalog-row'
import type { Enums } from '@/types/database.types'

type RegulatoryStatusEnum = Enums<'regulatory_status_enum'>

export interface CatalogItem {
  itemId:             string
  pharmacyId:         string
  pharmacyName:       string
  medicationName:     string
  form:               string
  dose:               string
  wholesalePrice:     number
  retailPrice:        number | null
  regulatoryStatus:   string
  requiresPriorAuth:  boolean
  normalizedId:       string | null
  createdAt:          string
  updatedAt:          string
}

export interface CatalogUploadVersion {
  historyId:     string
  pharmacyId:    string
  pharmacyName:  string
  uploader:      string
  uploadSource:  string
  versionNumber: number
  rowCount:      number
  deltaSummary:  { added: number; modified: number; removed: number }
  isActive:      boolean
  uploadedAt:    string
}

export interface NormalizedEntry {
  normalizedId:   string
  canonicalName:  string
  form:           string
  dose:           string
  pharmacyId:     string
  pharmacyName:   string
  wholesalePrice: number | null
  confidence:     number | null
}

export interface PharmacySyncStatus {
  pharmacyId:     string
  pharmacyName:   string
  tier:           string
  lastSyncedAt:   string | null
}

export interface CatalogResponse {
  items:       CatalogItem[]
  totalCount:  number
  versions:    CatalogUploadVersion[]
  normalized:  NormalizedEntry[]
  syncStatus:  PharmacySyncStatus[]
  fetchedAt:   string
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.user.user_metadata['app_role'] !== 'ops_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const pharmacyIdFilter = searchParams.get('pharmacyId')
  const statusFilter     = searchParams.get('status')
  const searchQuery      = searchParams.get('search')

  // Validate UUID if provided
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  if (pharmacyIdFilter && !UUID_RE.test(pharmacyIdFilter)) {
    return NextResponse.json({ error: 'Invalid pharmacyId' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // ── Parallel fetches ─────────────────────────────────────────
  const [itemsResult, versionsResult, normalizedResult, syncResult] = await Promise.all([

    // Catalog items with pharmacy join
    (() => {
      let q = supabase
        .from('catalog')
        .select('item_id, pharmacy_id, medication_name, form, dose, wholesale_price, retail_price, regulatory_status, requires_prior_auth, normalized_id, created_at, updated_at, pharmacies(name)', { count: 'exact' })
        .is('deleted_at', null)
        .eq('is_active', true)
        .order('medication_name')
        .limit(500)

      if (pharmacyIdFilter) q = q.eq('pharmacy_id', pharmacyIdFilter)
      if (statusFilter)     q = q.eq('regulatory_status', statusFilter.toUpperCase() as RegulatoryStatusEnum)
      if (searchQuery)      q = q.ilike('medication_name', `%${searchQuery}%`)

      return q
    })(),

    // Upload version history
    (() => {
      let q = supabase
        .from('catalog_upload_history')
        .select('history_id, pharmacy_id, uploader, upload_source, version_number, row_count, delta_summary, is_active, uploaded_at, pharmacies(name)')
        .order('uploaded_at', { ascending: false })
        .limit(100)

      if (pharmacyIdFilter) q = q.eq('pharmacy_id', pharmacyIdFilter)
      return q
    })(),

    // Normalized catalog — REQ-CTM-007
    (() => {
      let q = supabase
        .from('normalized_catalog')
        .select('normalized_id, canonical_name, form, dose, pharmacy_id, wholesale_price, confidence_score, pharmacies(name)')
        .eq('is_active', true)
        .order('canonical_name')
        .limit(200)

      if (pharmacyIdFilter) q = q.eq('pharmacy_id', pharmacyIdFilter)
      return q
    })(),

    // Sync status for Tier 1/3 pharmacies — REQ-CTM-006
    supabase
      .from('pharmacies')
      .select('pharmacy_id, name, integration_tier, catalog_last_synced_at')
      .in('integration_tier', ['TIER_1_API', 'TIER_3_SPEC', 'TIER_3_HYBRID'])
      .is('deleted_at', null)
      .eq('is_active', true)
      .order('name'),
  ])

  if (itemsResult.error) {
    console.error('[ops/catalog] items fetch error:', itemsResult.error.message)
    return NextResponse.json({ error: 'Failed to fetch catalog' }, { status: 500 })
  }

  // ── Map rows using shared mappers (NB-01/02) ─────────────────
  const items      = (itemsResult.data     ?? []).map(r => mapCatalogItem(r))
  const versions   = (versionsResult.data  ?? []).map(r => mapUploadVersion(r))
  const normalized = (normalizedResult.data ?? []).map(r => mapNormalizedEntry(r))
  const syncStatus = (syncResult.data      ?? []).map(r => mapPharmacySyncStatus(r))

  return NextResponse.json({
    items,
    totalCount:  itemsResult.count ?? items.length,
    versions,
    normalized,
    syncStatus,
    fetchedAt:   new Date().toISOString(),
  } satisfies CatalogResponse, { status: 200 })
}

export function POST()   { return new NextResponse(null, { status: 405 }) }
export function PUT()    { return new NextResponse(null, { status: 405 }) }
export function PATCH()  { return new NextResponse(null, { status: 405 }) }
export function DELETE() { return new NextResponse(null, { status: 405 }) }
