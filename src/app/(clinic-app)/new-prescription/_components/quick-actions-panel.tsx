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
// Protocols add all medications to the WO-80 session at once.

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { usePrescriptionSession } from '../_context/prescription-session'

// ── Types ───────────────────────────────────────────────────

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
}

// ── Fetchers ────────────────────────────────────────────────

async function fetchFavorites(): Promise<Favorite[]> {
  const res = await fetch('/api/favorites')
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

async function fetchProtocolDetail(id: string): Promise<ProtocolDetail | null> {
  const res = await fetch(`/api/protocols?id=${id}`)
  if (!res.ok) return null
  const json = await res.json()
  return json.data ?? null
}

// ── Props ───────────────────────────────────────────────────

interface QuickActionsPanelProps {
  onLoadFavorite: (fav: Favorite) => void
}

// ── Component ───────────────────────────────────────────────

export function QuickActionsPanel({ onLoadFavorite }: QuickActionsPanelProps) {
  const router = useRouter()
  const session = usePrescriptionSession()
  const [activeTab, setActiveTab] = useState<'favorites' | 'protocols' | 'recent'>('favorites')
  const [expandedProtocol, setExpandedProtocol] = useState<string | null>(null)
  const [loadingProtocol, setLoadingProtocol] = useState(false)

  const { data: favorites = [] } = useQuery({
    queryKey: ['provider-favorites'],
    queryFn: fetchFavorites,
  })

  const { data: protocols = [] } = useQuery({
    queryKey: ['clinic-protocols'],
    queryFn: fetchProtocols,
  })

  const { data: protocolDetail } = useQuery({
    queryKey: ['protocol-detail', expandedProtocol],
    queryFn: () => fetchProtocolDetail(expandedProtocol!),
    enabled: !!expandedProtocol,
  })

  // ── Load protocol into session ────────────────────────
  async function loadProtocolToSession(detail: ProtocolDetail) {
    if (!session.patient || !session.provider) return
    setLoadingProtocol(true)

    for (const item of detail.items) {
      if (!item.formulations || !item.pharmacies) continue

      // Navigate to margin builder for each item so provider can set retail price
      // For POC: add all items to session with a default 2x markup
      // In production, this would open the margin builder for each
      const formName = item.formulations.name
      const doseText = `${item.dose_amount ?? ''} ${item.dose_unit ?? ''}`.trim()

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
        wholesaleCents: 0, // Will be set when provider reviews
        deaSchedule: null,
        retailCents: 0,    // Will be set when provider reviews
        sigText: item.sig_text ?? '',
        integrationTier: item.pharmacies.integration_tier,
      })
    }

    setLoadingProtocol(false)
    // Navigate to review page so provider can set prices for each
    router.push('/new-prescription/review')
  }

  // ── Handle favorite load ──────────────────────────────
  function handleFavoriteClick(fav: Favorite) {
    // Bump use timestamp
    fetch(`/api/favorites?id=${fav.favorite_id}`, { method: 'PATCH' }).catch(() => {})
    onLoadFavorite(fav)
  }

  // ── No data yet? ─────────────────────────────────────
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
        {/* ── Favorites Tab ──────────────────────────────── */}
        {activeTab === 'favorites' && (
          <div className="space-y-1.5">
            {favorites.map(fav => (
              <button
                key={fav.favorite_id}
                type="button"
                onClick={() => handleFavoriteClick(fav)}
                className="w-full text-left rounded-md border border-border px-3 py-2 transition-colors hover:bg-muted/50"
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-foreground">{fav.label}</p>
                  {fav.sig_mode !== 'standard' && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                      {fav.sig_mode}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground truncate">
                  {fav.formulations?.name}
                  {fav.dose_amount && ` — ${fav.dose_amount} ${fav.dose_unit ?? ''}`}
                </p>
                {fav.use_count > 0 && (
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    Used {fav.use_count} time{fav.use_count !== 1 ? 's' : ''}
                  </p>
                )}
              </button>
            ))}
          </div>
        )}

        {/* ── Protocols Tab ─────────────────────────────── */}
        {activeTab === 'protocols' && (
          <div className="space-y-2">
            {protocols.map(proto => (
              <div key={proto.protocol_id} className="rounded-md border border-border">
                <button
                  type="button"
                  onClick={() => setExpandedProtocol(
                    expandedProtocol === proto.protocol_id ? null : proto.protocol_id
                  )}
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
                    {protocolDetail.items.map((item, i) => (
                      <div key={item.item_id ?? i} className="flex items-start gap-2 text-xs">
                        <span className="mt-0.5 w-4 text-center font-medium text-muted-foreground">
                          {i + 1}
                        </span>
                        <div className="flex-1">
                          <p className="font-medium text-foreground">
                            {item.formulations?.name ?? 'Unknown'}
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
                    ))}
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
