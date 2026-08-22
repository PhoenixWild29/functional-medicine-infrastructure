'use client'

// ============================================================
// WO-85: Quick Actions Panel — Favorites, Protocols, Recent
// ============================================================
//
// Tabbed panel above the ingredient search in the cascading
// prescription builder. Three tabs:
// 1. Favorites — one-click load saved prescription configs
// 2. Protocols — one-click load multi-medication templates
// 3. Recent   — last 10 prescriptions for quick reorder
//
// Favorites load all dropdown values + sig into the builder.
// Protocols add all medications to the WO-80 session at once,
// priced from the LIVE wholesale price + clinic default markup
// (see protocol-pricing.ts) — never $0.00 stubs. If any item is
// no longer available, the whole protocol load is blocked with
// an inline error naming the unavailable item(s).
//
// State-licensure guard: both quick-load paths carry a pinned
// pharmacy_id, so /api/favorites and /api/protocols?id= are asked
// (via ?patient_state=) whether that pharmacy is licensed in the
// selected patient's shipping state. Unlicensed favorites are
// blocked with an inline explanation; unlicensed protocol items are
// SKIPPED (licensed items still load) and reported by name.

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { usePrescriptionSession } from '../_context/prescription-session'
import { computeItemPricing, findUnavailableItems, findUnlicensedItems } from './protocol-pricing'

// ── Types ─────────────────────────────────────────────

interface Favorite {
  favorite_id: string
  provider_id: string
  formulation_id: string
  pharmacy_id: string | null
  label: string
  dose_amount: string | null
  dose_unit: string | null
  frequency_code: string | null
  timing_code: string | null
  duration_code: string | null
  sig_mode: string
  sig_text: string | null
  default_quantity: string | null
  default_refills: number
  use_count: number
  last_used_at: string | null
  // Stale-favorite hardening: false when the referenced formulation has
  // been deactivated or soft-deleted (e.g. by a catalog reseed). The card
  // renders grayed out with the click-through disabled.
  formulation_active: boolean
  // State-licensure: false when the pinned pharmacy has no ACTIVE license
  // in the selected patient's shipping state; null when unknown (no
  // patient state, or no pinned pharmacy). Only an explicit false blocks.
  pharmacy_licensed: boolean | null
  pharmacies: { pharmacy_id: string; name: string } | null
  formulations: {
    formulation_id: string
    name: string
    concentration: string | null
    concentration_value: number | null
    concentration_unit: string | null
    dosage_forms: { name: string } | null
    routes_of_administration: { name: string; abbreviation: string; sig_prefix: string } | null
  } | null
}

interface Protocol {
  protocol_id: string
  name: string
  description: string | null
  therapeutic_category: string | null
  total_duration_weeks: number | null
  use_count: number
}

interface ProtocolItem {
  item_id: string
  formulation_id: string
  pharmacy_id: string | null
  phase_name: string | null
  dose_amount: string | null
  dose_unit: string | null
  frequency_code: string | null
  sig_text: string | null
  default_quantity: string | null
  default_refills: number
  sort_order: number
  // Live pricing resolved server-side by /api/protocols?id= — null when
  // the pharmacy no longer actively offers this formulation.
  wholesale_price: number | null
  formulation_active: boolean
  // State-licensure: false when the pinned pharmacy has no ACTIVE license
  // in the selected patient's shipping state; null when unknown (no
  // patient state provided). Only an explicit false skips the item.
  pharmacy_licensed: boolean | null
  formulations: {
    formulation_id: string
    name: string
    concentration: string | null
    dosage_forms: { name: string } | null
  } | null
  pharmacies: {
    pharmacy_id: string
    name: string
    slug: string
    integration_tier: string
  } | null
}

interface ProtocolDetail extends Protocol {
  items: ProtocolItem[]
  default_markup_pct: number | null
}

// ── Fetchers ──────────────────────────────────────────

async function fetchFavorites(patientState: string | null): Promise<Favorite[]> {
  const params = patientState ? `?patient_state=${encodeURIComponent(patientState)}` : ''
  const res = await fetch(`/api/favorites${params}`)
  if (!res.ok) return []
  const json = await res.json()
  return json.data ?? []
}

async function fetchProtocols(): Promise<Protocol[]> {
  const res = await fetch('/api/protocols')
  if (!res.ok) return []
  const json = await res.json()
  return json.data ?? []
}

async function fetchProtocolDetail(id: string, patientState: string | null): Promise<ProtocolDetail | null> {
  const stateParam = patientState ? `&patient_state=${encodeURIComponent(patientState)}` : ''
  const res = await fetch(`/api/protocols?id=${id}${stateParam}`)
  if (!res.ok) return null
  const json = await res.json()
  return json.data ?? null
}

// ── Props ──────────────────────────────────────────────

interface QuickActionsPanelProps {
  onLoadFavorite: (fav: Favorite) => void
}

// ── Component ───────────────────────────────────────────

export function QuickActionsPanel({ onLoadFavorite }: QuickActionsPanelProps) {
  const router = useRouter()
  const session = usePrescriptionSession()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<'favorites' | 'protocols' | 'recent'>('favorites')
  const [expandedProtocol, setExpandedProtocol] = useState<string | null>(null)
  const [loadingProtocol, setLoadingProtocol] = useState(false)
  const [protocolLoadError, setProtocolLoadError] = useState<string | null>(null)
  // Two-step delete confirm — matches the catalog rollback pattern
  // (catalog-manager.tsx). Tracks which favorite row is currently
  // showing [Confirm] / [Cancel] buttons; null = idle.
  const [confirmDeleteFav, setConfirmDeleteFav] = useState<string | null>(null)
  const [deletingFav, setDeletingFav] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // Selected patient's shipping state — drives the licensure enrichment
  // on both quick-load APIs. Part of the query keys so switching patients
  // refetches with the right state.
  const patientState = session.patient?.state ?? null

  const { data: favorites = [] } = useQuery({
    queryKey: ['provider-favorites', patientState],
    queryFn: () => fetchFavorites(patientState),
  })

  const { data: protocols = [] } = useQuery({
    queryKey: ['clinic-protocols'],
    queryFn: fetchProtocols,
  })

  const { data: protocolDetail } = useQuery({
    queryKey: ['protocol-detail', expandedProtocol, patientState],
    queryFn: () => fetchProtocolDetail(expandedProtocol!, patientState),
    enabled: !!expandedProtocol,
  })

  // ── Load protocol into session ────────────────────
  function loadProtocolToSession(detail: ProtocolDetail) {
    if (!session.patient || !session.provider) return
    setProtocolLoadError(null)

    // State-licensure guard: items whose pinned pharmacy is not licensed
    // in the patient's shipping state are SKIPPED (never loaded), and
    // reported by name. Licensed items may still load.
    const skippedMessages = findUnlicensedItems(detail.items.map(item => ({
      name: item.formulations?.name ?? 'Unknown medication',
      pharmacyName: item.pharmacies?.name ?? 'its pharmacy',
      pharmacyLicensed: item.pharmacy_licensed,
    })), patientState)

    const loadableItems = detail.items.filter(item => item.pharmacy_licensed !== false)

    if (loadableItems.length === 0) {
      setProtocolLoadError(
        `No medications loaded for this ${patientState} patient — ${skippedMessages.join('; ')}.`
      )
      return
    }

    // WO-85 fix: never load $0.00 stubs. Every loadable item must have an
    // active formulation AND a live wholesale price, or the whole protocol
    // load is blocked with an error naming the unavailable item(s).
    const unavailable = findUnavailableItems(loadableItems.map(item => ({
      name: item.formulations?.name ?? 'Unknown medication',
      pharmacyName: item.pharmacies?.name ?? 'its pharmacy',
      wholesalePrice: item.formulations && item.pharmacies ? item.wholesale_price : null,
      formulationActive: !!item.formulations && !!item.pharmacies && item.formulation_active,
    })))

    if (unavailable.length > 0) {
      setProtocolLoadError(`${unavailable.join('; ')} — protocol not loaded.`)
      return
    }

    setLoadingProtocol(true)

    for (const item of loadableItems) {
      // The guards above ensure these never trip; they narrow the types.
      if (!item.formulations || !item.pharmacies || item.wholesale_price === null) continue

      const formName = item.formulations.name
      const doseText = `${item.dose_amount ?? ''} ${item.dose_unit ?? ''}`.trim()
      const { wholesaleCents, retailCents } = computeItemPricing(
        item.wholesale_price,
        detail.default_markup_pct
      )

      session.addPrescription({
        pharmacyId: item.pharmacies.pharmacy_id,
        pharmacyName: item.pharmacies.name,
        // WO-87: protocol items come from the V3.0 hierarchical catalog,
        // so they carry a formulationId, not a legacy catalog itemId.
        itemId: null,
        formulationId: item.formulation_id,
        medicationName: formName,
        form: item.formulations.dosage_forms?.name ?? '',
        dose: doseText,
        wholesaleCents,
        deaSchedule: null,
        retailCents,
        sigText: item.sig_text ?? '',
        integrationTier: item.pharmacies.integration_tier,
        // GAP-3: stamp the source protocol so order creation can link
        // the order to a protocol_instance + version. Favorites and
        // ad-hoc builder lines never set this.
        protocolId: detail.protocol_id,
        protocolName: detail.name,
      })
    }

    setLoadingProtocol(false)

    if (skippedMessages.length > 0) {
      // Partial load: stay on this page so the provider sees exactly which
      // items were skipped (navigating away would hide the report). The
      // loaded lines are already in the session and reachable via Review.
      setProtocolLoadError(
        `Loaded ${loadableItems.length} of ${detail.items.length} medications. ` +
        `Skipped for this ${patientState} patient: ${skippedMessages.join('; ')}.`
      )
      return
    }

    // Navigate to review page — every line already carries a real price;
    // the provider can still adjust retail per line if needed.
    router.push('/new-prescription/review')
  }

  // ── Handle favorite load ──────────────────────
  function handleFavoriteClick(fav: Favorite) {
    // Stale favorites are rendered grayed out with the button disabled;
    // this guard also keeps a dead click from bumping use_count.
    if (fav.formulation_active === false) return
    // State-licensure: the pinned pharmacy is not licensed in the selected
    // patient's shipping state. The card is disabled with an inline
    // explanation; this guard is the belt to that suspenders.
    if (fav.pharmacy_licensed === false) return
    // Bump use timestamp
    fetch(`/api/favorites?id=${fav.favorite_id}`, { method: 'PATCH' }).catch(() => {})
    onLoadFavorite(fav)
  }

  // ── Handle favorite delete (two-step confirm) ─────────
  async function handleConfirmDelete(favoriteId: string) {
    setDeletingFav(favoriteId)
    setDeleteError(null)
    try {
      const res = await fetch(`/api/favorites?id=${favoriteId}`, { method: 'DELETE' })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error ?? `Delete failed (${res.status})`)
      }
      await queryClient.invalidateQueries({ queryKey: ['provider-favorites'] })
      setConfirmDeleteFav(null)
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setDeletingFav(null)
    }
  }

  // ── No data yet? ───────────────────────────────
  const hasFavorites = favorites.length > 0
  const hasProtocols = protocols.length > 0

  if (!hasFavorites && !hasProtocols) return null

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm">
      {/* Tab headers */}
      <div className="flex border-b border-border">
        {hasFavorites && (
          <button
            type="button"
            onClick={() => setActiveTab('favorites')}
            className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
              activeTab === 'favorites'
                ? 'border-b-2 border-primary text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Favorites ({favorites.length})
          </button>
        )}
        {hasProtocols && (
          <button
            type="button"
            onClick={() => setActiveTab('protocols')}
            className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
              activeTab === 'protocols'
                ? 'border-b-2 border-primary text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Protocols ({protocols.length})
          </button>
        )}
      </div>

      {/* Tab content */}
      <div className="p-3">
        {/* ── Favorites Tab ────────────────────────────── */}
        {activeTab === 'favorites' && (
          <div className="space-y-1.5">
            {deleteError && (
              <p
                role="alert"
                className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
              >
                {deleteError}
              </p>
            )}
            {favorites.map(fav => {
              const isConfirming = confirmDeleteFav === fav.favorite_id
              const isDeleting = deletingFav === fav.favorite_id
              const isUnavailable = fav.formulation_active === false
              const isUnlicensed = fav.pharmacy_licensed === false
              return (
                <div
                  key={fav.favorite_id}
                  className={`group flex items-stretch rounded-md border border-border transition-colors ${
                    isUnavailable || isUnlicensed ? 'opacity-60' : 'hover:bg-muted/50'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => handleFavoriteClick(fav)}
                    disabled={isUnavailable || isUnlicensed}
                    className="flex-1 text-left px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-l-md disabled:cursor-not-allowed"
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-foreground">{fav.label}</p>
                      <div className="flex items-center gap-1">
                        {isUnavailable && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                            unavailable
                          </span>
                        )}
                        {!isUnavailable && isUnlicensed && (
                          <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700">
                            not licensed in {patientState}
                          </span>
                        )}
                        {fav.sig_mode !== 'standard' && (
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                            {fav.sig_mode}
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground truncate">
                      {fav.formulations?.name}
                      {fav.dose_amount && ` — ${fav.dose_amount} ${fav.dose_unit ?? ''}`}
                    </p>
                    {isUnavailable && (
                      <p className="mt-0.5 text-[10px] text-amber-700">
                        No longer in the catalog — remove this favorite and choose a replacement.
                      </p>
                    )}
                    {!isUnavailable && isUnlicensed && (
                      <p className="mt-0.5 text-[10px] text-red-700">
                        {fav.pharmacies?.name ?? 'The pinned pharmacy'} is not licensed in {patientState} — choose a licensed pharmacy for this patient.
                      </p>
                    )}
                    {fav.use_count > 0 && (
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        Used {fav.use_count} time{fav.use_count !== 1 ? 's' : ''}
                      </p>
                    )}
                  </button>
                  {/* Delete affordance — two-step confirm pattern */}
                  <div className="flex items-center pr-2">
                    {isConfirming ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => { void handleConfirmDelete(fav.favorite_id) }}
                          disabled={isDeleting}
                          className="rounded bg-red-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                        >
                          {isDeleting ? 'Deleting…' : 'Confirm'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteFav(null)}
                          disabled={isDeleting}
                          className="rounded border border-border px-2 py-1 text-[10px] hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        aria-label={`Delete favorite ${fav.label}`}
                        onClick={() => setConfirmDeleteFav(fav.favorite_id)}
                        className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-red-50 hover:text-red-600 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M3 6h18" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          <line x1="10" y1="11" x2="10" y2="17" />
                          <line x1="14" y1="11" x2="14" y2="17" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ── Protocols Tab ───────────────────────────── */}
        {activeTab === 'protocols' && (
          <div className="space-y-2">
            {protocolLoadError && (
              <p
                role="alert"
                className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
              >
                {protocolLoadError}
              </p>
            )}
            {protocols.map(proto => (
              <div key={proto.protocol_id} className="rounded-md border border-border">
                <button
                  type="button"
                  onClick={() => {
                    setProtocolLoadError(null)
                    setExpandedProtocol(
                      expandedProtocol === proto.protocol_id ? null : proto.protocol_id
                    )
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-foreground">{proto.name}</p>
                      <p className="text-xs text-muted-foreground">{proto.description}</p>
                    </div>
                    <div className="text-right">
                      {proto.therapeutic_category && (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                          {proto.therapeutic_category}
                        </span>
                      )}
                      {proto.total_duration_weeks && (
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          {proto.total_duration_weeks} weeks
                        </p>
                      )}
                    </div>
                  </div>
                </button>

                {/* Expanded: show items + load button */}
                {expandedProtocol === proto.protocol_id && protocolDetail && (
                  <div className="border-t border-border px-3 py-2 space-y-1.5">
                    {protocolDetail.items.map((item, i) => {
                      const itemUnlicensed = item.pharmacy_licensed === false
                      const itemUnavailable =
                        !itemUnlicensed && (!item.formulation_active || item.wholesale_price === null)
                      return (
                        <div key={item.item_id ?? i} className="flex items-start gap-2 text-xs">
                          <span className="mt-0.5 w-4 text-center font-medium text-muted-foreground">
                            {i + 1}
                          </span>
                          <div className="flex-1">
                            <p className="font-medium text-foreground">
                              {item.formulations?.name ?? 'Unknown'}
                              {itemUnavailable && (
                                <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                                  unavailable
                                </span>
                              )}
                              {itemUnlicensed && (
                                <span className="ml-1 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
                                  not licensed in {patientState} — will be skipped
                                </span>
                              )}
                            </p>
                            <p className="text-muted-foreground truncate">
                              {item.sig_text}
                            </p>
                            {item.phase_name && (
                              <span className="rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                                {item.phase_name}
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                    <button
                      type="button"
                      disabled={!session.patient || !session.provider || loadingProtocol}
                      onClick={() => loadProtocolToSession(protocolDetail)}
                      className="mt-2 w-full rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {loadingProtocol
                        ? 'Loading...'
                        : `Load ${protocolDetail.items.length} Medications into Session`}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
