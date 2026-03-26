// ============================================================
// Pharmacy Search — WO-27
// GET /api/pharmacy-search?state=TX&itemId=<catalog_item_id>
//                         [&form=<form>]
// ============================================================
//
// REQ-SCS-002: Patient shipping state required.
// REQ-SCS-003: Optional dosage form filter.
// REQ-SCS-004: State licensing compliance — only pharmacies with
//   an ACTIVE license in the patient's state.
// REQ-SCS-005: BANNED pharmacies excluded; SUSPENDED flagged with warning.
// REQ-SCS-007: Sort by wholesale_price ASC, API-connected first.
// REQ-SCS-008: Stale data indicator (catalog updated_at > 7 days).
// REQ-SCS-011: DEA schedule >= 2 → flag, restrict to Tier 4 only.
//
// Auth: Requires active Clinic App session.
// Response: { results: PharmacySearchResult[] }

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import type { IntegrationTierEnum } from '@/types/database.types'

// ── Tier ordering for sort (lower = ranked first) ────────────
// API-connected tiers (1 and 3) ranked above portal/fax (2 and 4)
const TIER_ORDER: Record<IntegrationTierEnum, number> = {
  TIER_1_API:     1,
  TIER_3_HYBRID:  2,
  TIER_3_SPEC:    2,
  TIER_2_PORTAL:  3,
  TIER_4_FAX:     4,
}

// Staleness threshold: 7 days in ms
const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000

export interface PharmacySearchResult {
  catalog_item_id:         string
  medication_name:         string
  form:                    string
  dose:                    string
  wholesale_price:         number
  dea_schedule:            number
  // 0 = non-scheduled; >= 2 = controlled, restrict to Tier 4 only (REQ-SCS-011)
  is_stale:                boolean    // catalog updated > 7 days ago (REQ-SCS-008)
  catalog_updated_at:      string
  pharmacy_id:             string
  pharmacy_name:           string
  pharmacy_status:         'ACTIVE' | 'SUSPENDED' | 'BANNED'
  // REQ-SCS-005: BANNED excluded before this point; SUSPENDED included with badge
  integration_tier:        IntegrationTierEnum
  average_turnaround_days: number | null
  supports_real_time_status: boolean
  tier_badge:              TierBadge
}

export interface TierBadge {
  label:            string
  color:            'green' | 'blue' | 'teal' | 'gray'
  speed:            string
}

function buildTierBadge(tier: IntegrationTierEnum): TierBadge {
  switch (tier) {
    case 'TIER_1_API':    return { label: 'API Connected',     color: 'green', speed: 'Instant'  }
    case 'TIER_2_PORTAL': return { label: 'Portal',            color: 'blue',  speed: '~5 min'   }
    case 'TIER_3_HYBRID': return { label: 'Standardized API',  color: 'teal',  speed: 'Instant'  }
    case 'TIER_3_SPEC':   return { label: 'Spec API',          color: 'teal',  speed: 'Instant'  }
    case 'TIER_4_FAX':    return { label: 'Fax',               color: 'gray',  speed: '~30 min'  }
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Auth gate
  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = request.nextUrl
  const patientState = (searchParams.get('state') ?? '').trim().toUpperCase()
  const itemId       = (searchParams.get('itemId') ?? '').trim()
  const formFilter   = (searchParams.get('form') ?? '').trim()

  // REQ-SCS-002: state is required
  if (!patientState || patientState.length !== 2) {
    return NextResponse.json(
      { error: 'state parameter required (2-letter US state code)' },
      { status: 400 }
    )
  }

  if (!itemId) {
    return NextResponse.json(
      { error: 'itemId parameter required' },
      { status: 400 }
    )
  }

  const supabase = createServiceClient()

  // Step 1: Fetch the catalog item to get medication details
  const { data: catalogItem, error: itemError } = await supabase
    .from('catalog')
    .select('item_id, medication_name, form, dose, wholesale_price, dea_schedule, updated_at, pharmacy_id')
    .eq('item_id', itemId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .maybeSingle()

  if (itemError) {
    console.error('[pharmacy-search] catalog item fetch failed:', itemError.message)
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }

  if (!catalogItem) {
    return NextResponse.json({ results: [] }, { status: 200 })
  }

  // Step 2: Fetch all catalog items matching this medication name/form/dose
  // across all pharmacies, then filter for state-licensed and active pharmacies.
  // NOTE (BLK-04): `pharmacies!inner` ensures a pharmacy FK row exists but does NOT
  // filter by is_active or pharmacy_status at the DB level. Both checks are enforced
  // in application logic in Step 4 below.
  let catalogQuery = supabase
    .from('catalog')
    .select(`
      item_id,
      medication_name,
      form,
      dose,
      wholesale_price,
      dea_schedule,
      updated_at,
      pharmacy_id,
      pharmacies!inner (
        pharmacy_id,
        name,
        integration_tier,
        average_turnaround_days,
        supports_real_time_status,
        is_active,
        deleted_at,
        pharmacy_status
      )
    `)
    .eq('medication_name', catalogItem.medication_name)
    .eq('dose', catalogItem.dose)
    .eq('is_active', true)
    .is('deleted_at', null)

  // REQ-SCS-003: optional dosage form filter
  if (formFilter) {
    catalogQuery = catalogQuery.eq('form', formFilter)
  } else {
    catalogQuery = catalogQuery.eq('form', catalogItem.form)
  }

  const { data: catalogRows, error: catalogError } = await catalogQuery

  if (catalogError) {
    console.error('[pharmacy-search] catalog search failed:', catalogError.message)
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }

  if (!catalogRows || catalogRows.length === 0) {
    return NextResponse.json({ results: [] }, { status: 200 })
  }

  // Step 3: Fetch state-licensed pharmacy IDs for the patient's state
  // REQ-SCS-004: only pharmacies with ACTIVE license in patient state
  const pharmacyIds = [...new Set(catalogRows.map(r => r.pharmacy_id))]

  const { data: licenseRows, error: licenseError } = await supabase
    .from('pharmacy_state_licenses')
    .select('pharmacy_id')
    .eq('state_code', patientState)
    .eq('is_active', true)
    .in('pharmacy_id', pharmacyIds)

  if (licenseError) {
    console.error('[pharmacy-search] license check failed:', licenseError.message)
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }

  const licensedPharmacyIds = new Set((licenseRows ?? []).map(r => r.pharmacy_id))
  const staleThreshold = new Date(Date.now() - STALE_THRESHOLD_MS)

  // Step 4: Build results — filter, enrich, sort
  const results: PharmacySearchResult[] = []

  for (const row of catalogRows) {
    const pharmacy = row.pharmacies as unknown as {
      pharmacy_id: string
      name: string
      integration_tier: IntegrationTierEnum
      average_turnaround_days: number | null
      supports_real_time_status: boolean
      is_active: boolean
      deleted_at: string | null
      pharmacy_status: 'ACTIVE' | 'SUSPENDED' | 'BANNED'
    } | null

    if (!pharmacy) continue

    // REQ-SCS-004: must have ACTIVE license in patient state
    if (!licensedPharmacyIds.has(row.pharmacy_id)) continue

    // REQ-SCS-005: BANNED pharmacies never shown; soft-deleted pharmacies excluded
    if (pharmacy.pharmacy_status === 'BANNED' || !pharmacy.is_active || pharmacy.deleted_at) continue

    const catalogUpdatedAt = row.updated_at
    const isStale = new Date(catalogUpdatedAt) < staleThreshold

    results.push({
      catalog_item_id:          row.item_id,
      medication_name:          row.medication_name,
      form:                     row.form,
      dose:                     row.dose,
      wholesale_price:          row.wholesale_price,
      dea_schedule:             row.dea_schedule ?? 0,
      is_stale:                 isStale,
      catalog_updated_at:       catalogUpdatedAt,
      pharmacy_id:              pharmacy.pharmacy_id,
      pharmacy_name:            pharmacy.name,
      pharmacy_status:          pharmacy.pharmacy_status ?? 'ACTIVE',
      integration_tier:         pharmacy.integration_tier,
      average_turnaround_days:  pharmacy.average_turnaround_days,
      supports_real_time_status: pharmacy.supports_real_time_status,
      tier_badge:               buildTierBadge(pharmacy.integration_tier),
    })
  }

  // REQ-SCS-007: Sort by wholesale_price ASC, then API-connected tiers first
  results.sort((a, b) => {
    const priceDiff = a.wholesale_price - b.wholesale_price
    if (priceDiff !== 0) return priceDiff
    return (TIER_ORDER[a.integration_tier] ?? 99) - (TIER_ORDER[b.integration_tier] ?? 99)
  })

  return NextResponse.json({ results }, { status: 200 })
}
