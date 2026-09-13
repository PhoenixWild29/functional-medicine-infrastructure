'use client'

// ============================================================
// WO-85 / WO-103: Quick Actions — Favorites + Protocols
// ============================================================
//
// WO-103 layout: the medication search (passed in as `children`) is
// the FIRST element under the session banner, with two buttons beside
// it — "Favorites (N)" and "Protocols (N)" — each opening a panel
// below. Each panel has a "+ New" action. Favorites are clinic-wide
// (WO-85) with a "Mine" filter, show units and the computed mg
// ("10 units (0.5 mg) weekly"), and are editable in place (name, dose,
// frequency, pharmacy). Delete keeps the two-step confirm.
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
//
// Partial-load behavior: a load that placed at least one line in the
// session is a SUCCESS and advances to the review step — the skip
// report travels with the session (session.addNotice) and renders
// there as a non-blocking amber notice. Only a load that placed
// nothing stays on this page with a red error, because there would be
// nothing to review. Loads are idempotent: lines already present in
// the session are never added twice.

import { useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import {
  usePrescriptionSession,
  prescriptionSignature,
  type SessionPrescription,
} from '../_context/prescription-session'
import { computeItemPricing, findUnavailableItems, findUnlicensedItems } from './protocol-pricing'
import { FREQUENCY_OPTIONS } from './structured-sig-builder.types'
import {
  buildStandardSig,
  DOSE_UNITS,
  formatFavoriteDose,
} from '@/lib/orders/dose-display'
import { splitDose } from '@/lib/orders/dose'

// ── Types ───────────────────────────────────

export interface Favorite {
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

interface PharmacyOption {
  pharmacy_formulation_id: string
  wholesale_price: number
  pharmacies: { pharmacy_id: string; name: string } | null
}

// ── Fetchers ────────────────────────────────

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

async function fetchPharmacyOptions(formulationId: string, patientState: string | null): Promise<PharmacyOption[]> {
  const search = new URLSearchParams({ level: 'pharmacy_options', formulation_id: formulationId })
  if (patientState) search.set('state', patientState)
  const res = await fetch(`/api/formulations?${search.toString()}`)
  if (!res.ok) return []
  const json = await res.json()
  return json.data ?? []
}

// ── Props ────────────────────────────────────

export type QuickActionsPanelName = 'favorites' | 'protocols'

interface QuickActionsPanelProps {
  onLoadFavorite: (fav: Favorite) => void
  /** The medication search control — rendered first, buttons beside it. */
  children?: ReactNode
  /** Favorites "+ New": close the panel and put the provider in the search. */
  onNewFavorite?: () => void
}

// ── Component ───────────────────────────────────

export function QuickActionsPanel({ onLoadFavorite, children, onNewFavorite }: QuickActionsPanelProps) {
  const router = useRouter()
  const session = usePrescriptionSession()
  const queryClient = useQueryClient()
  const [activePanel, setActivePanel] = useState<QuickActionsPanelName | null>(null)
  const [expandedProtocol, setExpandedProtocol] = useState<string | null>(null)
  const [loadingProtocol, setLoadingProtocol] = useState(false)
  const [protocolLoadError, setProtocolLoadError] = useState<string | null>(null)
  // Non-blocking counterpart to protocolLoadError: shown when a load was
  // refused as a no-op because every line is already in the session.
  const [protocolLoadNotice, setProtocolLoadNotice] = useState<string | null>(null)
  // Two-step delete confirm — matches the catalog rollback pattern
  // (catalog-manager.tsx). Tracks which favorite row is currently
  // showing [Confirm] / [Cancel] buttons; null = idle.
  const [confirmDeleteFav, setConfirmDeleteFav] = useState<string | null>(null)
  const [deletingFav, setDeletingFav] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  // WO-103: "Mine" filter (clinic-wide list narrowed to the session
  // provider's own favorites) and in-place edit.
  const [mineOnly, setMineOnly] = useState(false)
  const [editingFav, setEditingFav] = useState<string | null>(null)
  // WO-103: "+ New" protocol from the session lines.
  const [newProtocolOpen, setNewProtocolOpen] = useState(false)
  const [newProtocolName, setNewProtocolName] = useState('')
  const [savingProtocol, setSavingProtocol] = useState(false)
  const [protocolSaveError, setProtocolSaveError] = useState<string | null>(null)
  const [protocolSaved, setProtocolSaved] = useState<string | null>(null)

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

  function togglePanel(name: QuickActionsPanelName) {
    setActivePanel(prev => (prev === name ? null : name))
  }

  // ── Load protocol into session ────────────────
  function loadProtocolToSession(detail: ProtocolDetail) {
    if (!session.patient || !session.provider) return
    setProtocolLoadError(null)
    setProtocolLoadNotice(null)

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
      // Total block: nothing would reach the review step, so there is
      // nothing to advance to. Stay here with the full per-item reason.
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

    // Build every line first, then hand the batch to the session in one
    // call. Lines already present are dropped rather than re-added, so
    // clicking "Load N Medications into Session" twice can never
    // duplicate a prescription.
    const seen = new Set(session.prescriptions.map(prescriptionSignature))
    const linesToLoad: Omit<SessionPrescription, 'id'>[] = []
    const alreadyInSession: string[] = []

    for (const item of loadableItems) {
      // The guards above ensure these never trip; they narrow the types.
      if (!item.formulations || !item.pharmacies || item.wholesale_price === null) continue

      const formName = item.formulations.name
      const doseText = `${item.dose_amount ?? ''} ${item.dose_unit ?? ''}`.trim()
      const { wholesaleCents, retailCents } = computeItemPricing(
        item.wholesale_price,
        detail.default_markup_pct
      )

      const line: Omit<SessionPrescription, 'id'> = {
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
        frequencyCode: item.frequency_code,
        quantityLabel: item.default_quantity,
      }

      const signature = prescriptionSignature(line)
      if (seen.has(signature)) {
        alreadyInSession.push(formName)
        continue
      }
      seen.add(signature)
      linesToLoad.push(line)
    }

    if (linesToLoad.length > 0) {
      session.addPrescriptions(linesToLoad)
    }

    setLoadingProtocol(false)

    if (linesToLoad.length === 0 && alreadyInSession.length > 0) {
      // Idempotent re-load. Nothing changed, so navigating would imply
      // work happened; say so instead, in amber rather than red.
      const parts = [
        `All ${alreadyInSession.length} medication${alreadyInSession.length !== 1 ? 's' : ''} ` +
        `from this protocol ${alreadyInSession.length !== 1 ? 'are' : 'is'} already in this session — nothing was added.`,
      ]
      if (skippedMessages.length > 0) {
        parts.push(`Still skipped for this ${patientState} patient: ${skippedMessages.join('; ')}.`)
      }
      setProtocolLoadNotice(parts.join(' '))
      return
    }

    // Partial success is still success: the licensed lines are in the
    // session, so advance. The skip report rides along on the session and
    // renders on the review step as a non-blocking amber notice — it must
    // not strand the provider on this page with no forward action.
    if (skippedMessages.length > 0 || alreadyInSession.length > 0) {
      session.addNotice({
        protocolName: detail.name,
        patientState,
        loadedCount: linesToLoad.length,
        totalCount: detail.items.length,
        skipped: skippedMessages,
        alreadyPresent: alreadyInSession,
      })
    }

    // Navigate to review page — every line already carries a real price;
    // the provider can still adjust retail per line if needed.
    router.push('/new-prescription/review')
  }

  // ── Handle favorite load ─────────────────────
  function handleFavoriteClick(fav: Favorite) {
    // Stale favorites are rendered grayed out with the button disabled;
    // this guard also keeps a dead click from bumping use_count.
    if (fav.formulation_active === false) return
    // State-licensure: the pinned pharmacy is not licensed in the selected
    // patient's shipping state. The card is disabled with an inline
    // explanation; this guard is the belt to that suspenders.
    if (fav.pharmacy_licensed === false) return
    // NB: the favorites path does NOT add to the session here. It
    // pre-fills the cascading builder, and the line only enters the
    // session from the margin builder once a retail price and sig are
    // confirmed — so there is no silent-duplication path to guard here.
    // Duplicate protection for that path lives in addPrescriptions().
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

  // ── WO-103: "+ New" protocol from the session ─────────
  const protocolLines = session.prescriptions.filter(rx => !!rx.formulationId)

  async function handleSaveProtocol() {
    const name = newProtocolName.trim()
    if (!name || protocolLines.length === 0 || savingProtocol) return
    setSavingProtocol(true)
    setProtocolSaveError(null)
    try {
      const res = await fetch('/api/protocols', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          created_by: session.provider?.provider_id ?? null,
          items: protocolLines.map(rx => {
            const { amount, unit } = splitDose(rx.dose)
            return {
              formulation_id:   rx.formulationId,
              pharmacy_id:      rx.pharmacyId,
              dose_amount:      amount || null,
              dose_unit:        unit || null,
              frequency_code:   rx.frequencyCode ?? null,
              sig_text:         rx.sigText,
              default_quantity: rx.quantityLabel ?? null,
              default_refills:  rx.rxDetails?.refills ?? 0,
            }
          }),
        }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(json.error ?? `Save failed (${res.status})`)
      }
      await queryClient.invalidateQueries({ queryKey: ['clinic-protocols'] })
      setNewProtocolOpen(false)
      setNewProtocolName('')
      setProtocolSaved(name)
    } catch (err) {
      setProtocolSaveError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSavingProtocol(false)
    }
  }

  const providerId = session.provider?.provider_id ?? null
  const visibleFavorites = mineOnly && providerId
    ? favorites.filter(fav => fav.provider_id === providerId)
    : favorites

  const buttonClass = (name: QuickActionsPanelName) =>
    `whitespace-nowrap rounded-md border px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
      activePanel === name
        ? 'border-primary bg-primary/10 text-primary'
        : 'border-border bg-background text-foreground hover:bg-muted/50'
    }`

  return (
    <div className="space-y-3">
      {/* Search first, Favorites / Protocols buttons beside it */}
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <label htmlFor="medication-search" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Medication
        </label>
        <div className="mt-1 flex items-start gap-2">
          <div className="min-w-0 flex-1">{children}</div>
          <div className="flex shrink-0 gap-2" role="group" aria-label="Quick actions">
            <button
              type="button"
              onClick={() => togglePanel('favorites')}
              aria-expanded={activePanel === 'favorites'}
              aria-controls="favorites-panel"
              className={buttonClass('favorites')}
            >
              Favorites ({favorites.length})
            </button>
            <button
              type="button"
              onClick={() => togglePanel('protocols')}
              aria-expanded={activePanel === 'protocols'}
              aria-controls="protocols-panel"
              className={buttonClass('protocols')}
            >
              Protocols ({protocols.length})
            </button>
          </div>
        </div>
      </div>

      {/* ── Favorites panel ───────────────────────────── */}
      {activePanel === 'favorites' && (
        <section
          id="favorites-panel"
          aria-label="Favorites"
          data-testid="favorites-panel"
          className="rounded-lg border border-border bg-card p-3 shadow-sm space-y-2"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Favorites ({visibleFavorites.length})
              </p>
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={mineOnly}
                  onChange={e => setMineOnly(e.target.checked)}
                  disabled={!providerId}
                  className="rounded border-border"
                />
                Mine
              </label>
            </div>
            <button
              type="button"
              onClick={() => {
                setActivePanel(null)
                onNewFavorite?.()
              }}
              className="rounded-md border border-primary/40 px-2 py-1 text-xs font-medium text-primary hover:bg-primary/5"
            >
              + New
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Clinic-wide. New favorites are saved with ☆ from the builder, the price page, or any Review card.
          </p>
          {deleteError && (
            <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {deleteError}
            </p>
          )}
          {visibleFavorites.length === 0 && (
            <p className="rounded-md border border-dashed border-border px-3 py-3 text-center text-xs text-muted-foreground">
              {mineOnly ? 'No favorites of yours yet.' : 'No favorites yet.'} Search a medication, set the dose, and click ☆ Save as favorite.
            </p>
          )}
          <div className="space-y-1.5">
            {visibleFavorites.map(fav => (
              editingFav === fav.favorite_id ? (
                <FavoriteEditForm
                  key={fav.favorite_id}
                  favorite={fav}
                  patientState={patientState}
                  onCancel={() => setEditingFav(null)}
                  onSaved={async () => {
                    await queryClient.invalidateQueries({ queryKey: ['provider-favorites'] })
                    setEditingFav(null)
                  }}
                />
              ) : (
                <FavoriteRow
                  key={fav.favorite_id}
                  favorite={fav}
                  patientState={patientState}
                  isConfirming={confirmDeleteFav === fav.favorite_id}
                  isDeleting={deletingFav === fav.favorite_id}
                  onLoad={() => handleFavoriteClick(fav)}
                  onEdit={() => { setConfirmDeleteFav(null); setEditingFav(fav.favorite_id) }}
                  onAskDelete={() => setConfirmDeleteFav(fav.favorite_id)}
                  onConfirmDelete={() => { void handleConfirmDelete(fav.favorite_id) }}
                  onCancelDelete={() => setConfirmDeleteFav(null)}
                />
              )
            ))}
          </div>
        </section>
      )}

      {/* ── Protocols panel ─────────────────────────── */}
      {activePanel === 'protocols' && (
        <section
          id="protocols-panel"
          aria-label="Protocols"
          data-testid="protocols-panel"
          className="rounded-lg border border-border bg-card p-3 shadow-sm space-y-2"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Protocols ({protocols.length})
            </p>
            <button
              type="button"
              onClick={() => {
                setProtocolSaved(null)
                setProtocolSaveError(null)
                setNewProtocolOpen(v => !v)
              }}
              aria-expanded={newProtocolOpen}
              className="rounded-md border border-primary/40 px-2 py-1 text-xs font-medium text-primary hover:bg-primary/5"
            >
              + New
            </button>
          </div>

          {newProtocolOpen && (
            <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2" data-testid="new-protocol-form">
              {protocolLines.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Add prescriptions to this session first, then come back here to save them as a protocol.
                </p>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">
                    Saves the {protocolLines.length} prescription{protocolLines.length !== 1 ? 's' : ''} in this session
                    ({protocolLines.map(rx => rx.medicationName).join(', ')}) as a clinic protocol.
                  </p>
                  <div className="flex gap-1">
                    <label htmlFor="new-protocol-name" className="sr-only">Protocol name</label>
                    <input
                      id="new-protocol-name"
                      type="text"
                      placeholder="Protocol name…"
                      value={newProtocolName}
                      onChange={e => setNewProtocolName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void handleSaveProtocol() } }}
                      autoFocus
                      className="flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    <button
                      type="button"
                      onClick={() => { void handleSaveProtocol() }}
                      disabled={!newProtocolName.trim() || savingProtocol}
                      className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    >
                      {savingProtocol ? 'Saving…' : 'Save protocol'}
                    </button>
                  </div>
                </>
              )}
              {protocolSaveError && (
                <p role="alert" className="text-xs text-red-600">{protocolSaveError}</p>
              )}
            </div>
          )}
          {protocolSaved && (
            <p role="status" className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">
              Protocol &ldquo;{protocolSaved}&rdquo; saved.
            </p>
          )}

          {protocolLoadError && (
            <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {protocolLoadError}
            </p>
          )}
          {protocolLoadNotice && (
            <p role="status" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {protocolLoadNotice}
            </p>
          )}
          {protocols.length === 0 && !newProtocolOpen && (
            <p className="rounded-md border border-dashed border-border px-3 py-3 text-center text-xs text-muted-foreground">
              No protocols yet. Add prescriptions to the session, then use + New to save them as one.
            </p>
          )}
          {protocols.map(proto => (
            <div key={proto.protocol_id} className="rounded-md border border-border">
              <button
                type="button"
                onClick={() => {
                  setProtocolLoadError(null)
                  setProtocolLoadNotice(null)
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
        </section>
      )}
    </div>
  )
}

// ── Favorite row ───────────────────────────────

interface FavoriteRowProps {
  favorite: Favorite
  patientState: string | null
  isConfirming: boolean
  isDeleting: boolean
  onLoad: () => void
  onEdit: () => void
  onAskDelete: () => void
  onConfirmDelete: () => void
  onCancelDelete: () => void
}

function FavoriteRow({
  favorite: fav, patientState, isConfirming, isDeleting,
  onLoad, onEdit, onAskDelete, onConfirmDelete, onCancelDelete,
}: FavoriteRowProps) {
  const isUnavailable = fav.formulation_active === false
  const isUnlicensed = fav.pharmacy_licensed === false
  const doseLine = formatFavoriteDose({
    doseAmount: fav.dose_amount,
    doseUnit: fav.dose_unit,
    frequencyCode: fav.frequency_code,
    concentration: fav.formulations,
  })

  return (
    <div
      data-testid={`favorite-${fav.favorite_id}`}
      className={`group flex items-stretch rounded-md border border-border transition-colors ${
        isUnavailable || isUnlicensed ? 'opacity-60' : 'hover:bg-muted/50'
      }`}
    >
      <button
        type="button"
        onClick={onLoad}
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
          {fav.pharmacies?.name && ` · ${fav.pharmacies.name}`}
        </p>
        {doseLine && (
          <p className="mt-0.5 text-xs text-foreground" data-testid="favorite-dose">
            {doseLine}
          </p>
        )}
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
      {/* Edit + delete affordances — delete keeps the two-step confirm */}
      <div className="flex items-center gap-1 pr-2">
        {isConfirming ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onConfirmDelete}
              disabled={isDeleting}
              className="rounded bg-red-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              {isDeleting ? 'Deleting…' : 'Confirm'}
            </button>
            <button
              type="button"
              onClick={onCancelDelete}
              disabled={isDeleting}
              className="rounded border border-border px-2 py-1 text-[10px] hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        ) : (
          <>
            <button
              type="button"
              aria-label={`Edit favorite ${fav.label}`}
              onClick={onEdit}
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </button>
            <button
              type="button"
              aria-label={`Delete favorite ${fav.label}`}
              onClick={onAskDelete}
              className="rounded p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 6h18" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ── Favorite edit form (WO-103) ────────────────
// Name, dose (amount + unit), frequency and pharmacy. The mg preview
// updates as the dose is typed; on save the stored sig is regenerated
// for standard-mode favorites so it follows the new dose.

interface FavoriteEditFormProps {
  favorite: Favorite
  patientState: string | null
  onCancel: () => void
  onSaved: () => Promise<void> | void
}

function FavoriteEditForm({ favorite: fav, patientState, onCancel, onSaved }: FavoriteEditFormProps) {
  const [label, setLabel] = useState(fav.label)
  const [doseAmount, setDoseAmount] = useState(fav.dose_amount ?? '')
  const [doseUnit, setDoseUnit] = useState(fav.dose_unit ?? '')
  const [frequency, setFrequency] = useState(fav.frequency_code ?? '')
  const [pharmacyId, setPharmacyId] = useState(fav.pharmacy_id ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: pharmacyOptions = [] } = useQuery({
    queryKey: ['formulation-pharmacies', fav.formulation_id, patientState],
    queryFn: () => fetchPharmacyOptions(fav.formulation_id, patientState),
  })
  // Keep the current pharmacy selectable even if it is not (or no longer)
  // in the licensed list, so opening the form never silently changes it.
  const pharmacyChoices = pharmacyOptions
    .map(po => po.pharmacies)
    .filter((p): p is { pharmacy_id: string; name: string } => !!p)
  if (fav.pharmacies && !pharmacyChoices.some(p => p.pharmacy_id === fav.pharmacies?.pharmacy_id)) {
    pharmacyChoices.unshift(fav.pharmacies)
  }

  const preview = formatFavoriteDose({
    doseAmount, doseUnit, frequencyCode: frequency, concentration: fav.formulations,
  })
  const doseValid = Number.isFinite(parseFloat(doseAmount)) && parseFloat(doseAmount) > 0
  const canSave = !!label.trim() && doseValid && !!doseUnit && !saving

  async function handleSave() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    const doseChanged =
      doseAmount !== (fav.dose_amount ?? '') || doseUnit !== (fav.dose_unit ?? '') || frequency !== (fav.frequency_code ?? '')
    const body: Record<string, string | null> = {
      label: label.trim(),
      dose_amount: doseAmount,
      dose_unit: doseUnit,
      pharmacy_id: pharmacyId || null,
    }
    if (frequency) body['frequency_code'] = frequency
    if (doseChanged && fav.sig_mode === 'standard' && fav.formulations) {
      const sig = buildStandardSig({
        doseAmount, doseUnit, frequencyCode: frequency || fav.frequency_code,
        timingCode: fav.timing_code, formulation: fav.formulations,
      })
      if (sig) body['sig_text'] = sig
    }
    try {
      const res = await fetch(`/api/favorites?id=${fav.favorite_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(json.error ?? `Save failed (${res.status})`)
      }
      await onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
      setSaving(false)
    }
  }

  return (
    <form
      data-testid={`favorite-edit-${fav.favorite_id}`}
      aria-label={`Edit favorite ${fav.label}`}
      onSubmit={e => { e.preventDefault(); void handleSave() }}
      className="rounded-md border border-primary/40 bg-primary/5 p-3 space-y-2"
    >
      <p className="text-xs text-muted-foreground truncate">{fav.formulations?.name}</p>
      <div>
        <label htmlFor={`fav-name-${fav.favorite_id}`} className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Favorite name
        </label>
        <input
          id={`fav-name-${fav.favorite_id}`}
          type="text"
          value={label}
          onChange={e => setLabel(e.target.value)}
          className="mt-0.5 w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <div>
          <label htmlFor={`fav-dose-${fav.favorite_id}`} className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Favorite dose amount
          </label>
          <input
            id={`fav-dose-${fav.favorite_id}`}
            type="text"
            inputMode="decimal"
            value={doseAmount}
            onChange={e => setDoseAmount(e.target.value)}
            className="mt-0.5 w-20 rounded-md border border-input bg-background px-2 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div>
          <label htmlFor={`fav-unit-${fav.favorite_id}`} className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Favorite dose unit
          </label>
          <select
            id={`fav-unit-${fav.favorite_id}`}
            value={doseUnit}
            onChange={e => setDoseUnit(e.target.value)}
            className="mt-0.5 rounded-md border border-input bg-background px-2 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">Unit</option>
            {DOSE_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        <div className="min-w-[10rem] flex-1">
          <label htmlFor={`fav-freq-${fav.favorite_id}`} className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Favorite frequency
          </label>
          <select
            id={`fav-freq-${fav.favorite_id}`}
            value={frequency}
            onChange={e => setFrequency(e.target.value)}
            className="mt-0.5 w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">Select frequency</option>
            {FREQUENCY_OPTIONS.map(f => <option key={f.code} value={f.code}>{f.display}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label htmlFor={`fav-pharmacy-${fav.favorite_id}`} className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Favorite pharmacy
        </label>
        <select
          id={`fav-pharmacy-${fav.favorite_id}`}
          value={pharmacyId}
          onChange={e => setPharmacyId(e.target.value)}
          className="mt-0.5 w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">No pinned pharmacy</option>
          {pharmacyChoices.map(p => <option key={p.pharmacy_id} value={p.pharmacy_id}>{p.name}</option>)}
        </select>
      </div>
      <p className="text-xs text-foreground" data-testid="favorite-dose-preview">
        {preview || 'Enter a dose to see the mg equivalent'}
      </p>
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-1">
        <button
          type="submit"
          disabled={!canSave}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted/50 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
