'use client'

// ============================================================
// Dynamic Margin Builder Form — WO-28
// ============================================================
//
// REQ-DMB-001: Locked wholesale cost display with pharmacy name.
// REQ-DMB-002: Editable retail price with [1.5x][2x][2.5x][3x] multipliers.
// REQ-DMB-003: Default markup pre-population from clinics.default_markup_pct.
// REQ-DMB-004: Real-time margin calculation (margin %, platform fee, clinic margin).
// REQ-DMB-005: Retail >= wholesale validation (client-side; DB CHECK is safety net).
// REQ-DMB-006: >5x wholesale amber warning with acknowledgment.
// REQ-DMB-007: <$10 clinic margin amber warning.
// REQ-DMB-008: HC-01 — all arithmetic in integer cents; never floating-point.
// REQ-DMB-009: Sig text 10-character minimum (trimmed — whitespace-only not accepted).

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { usePrescriptionSession } from '../../_context/prescription-session'

// ── Cent arithmetic helpers — HC-01 ──────────────────────────
// Convert a NUMERIC(10,2) server value (JS float64) to integer cents once.
// All subsequent math stays in cents; toCurrency() converts back for display only.

function toCents(dollars: number): number {
  return Math.round(dollars * 100)
}

function toCurrency(cents: number): string {
  return (cents / 100).toFixed(2)
}

// Platform fee: 15% of margin, rounded to nearest cent.
// Cent-precision: Math.round(marginCents * 15 / 100) avoids float drift.
function calcPlatformFeeCents(marginCents: number): number {
  return Math.round(marginCents * 15 / 100)
}

// Pre-populate retail price from default_markup_pct.
// default_markup_pct = 50.00 → retail = wholesale * 1.50
// Falls back to 2x wholesale if no default is set.
function defaultRetailCents(wholesaleCents: number, markupPct: number | null): number {
  if (markupPct != null && markupPct > 0) {
    return Math.round(wholesaleCents * (100 + markupPct) / 100)
  }
  return wholesaleCents * 2
}

// ── Props ─────────────────────────────────────────────────────
interface Props {
  pharmacyId:       string
  itemId:           string
  pharmacyName:     string
  medicationName:   string
  form:             string
  dose:             string
  wholesalePrice:   number         // NUMERIC(10,2) from DB
  deaSchedule:      number
  defaultMarkupPct: number | null  // NUMERIC(5,2) from DB — e.g. 50.00 = 50%
  presetSigText?:   string | undefined  // WO-83: Pre-filled sig from cascading builder
}

// ── Multiplier buttons ────────────────────────────────────────
const MULTIPLIERS = [
  { label: '1.5×', factor: 150 },
  { label: '2×',   factor: 200 },
  { label: '2.5×', factor: 250 },
  { label: '3×',   factor: 300 },
]

export function MarginBuilderForm({
  pharmacyId,
  itemId,
  pharmacyName,
  medicationName,
  form,
  dose,
  wholesalePrice,
  deaSchedule,
  defaultMarkupPct,
  presetSigText,
}: Props) {
  const router = useRouter()
  const rxSession = usePrescriptionSession()

  const wholesaleCents = useMemo(() => toCents(wholesalePrice), [wholesalePrice])

  // Retail price input — stored as formatted string so user can type freely
  const [retailInput, setRetailInput] = useState<string>(() =>
    toCurrency(defaultRetailCents(wholesaleCents, defaultMarkupPct))
  )
  // WO-83: Pre-fill sig from cascading builder if available
  const [sigText, setSigText] = useState(presetSigText ?? '')
  // REQ-DMB-006: soft-block for >5x wholesale — requires explicit acknowledgment
  const [highMarkupAcknowledged, setHighMarkupAcknowledged] = useState(false)

  // ── Derived calculations — HC-01: integer cents throughout ──
  const retailCents = useMemo(() => {
    const parsed = parseFloat(retailInput)
    // BLK-03: guard against Infinity/NaN from scientific notation (e.g. '1e308')
    if (!isFinite(parsed) || parsed <= 0) return 0
    return toCents(parsed)
  }, [retailInput])

  // NB-04: wrap all derived margin values in one useMemo to avoid
  // recalculating on unrelated state changes.
  const { marginCents, platformFeeCents, clinicMarginCents, marginPct } = useMemo(() => {
    const marginCents = retailCents - wholesaleCents
    const platformFeeCents = marginCents > 0 ? calcPlatformFeeCents(marginCents) : 0
    // BLK-01: unconditional subtraction per formula spec (retail - wholesale - platform_fee)
    const clinicMarginCents = marginCents - platformFeeCents
    const marginPct = retailCents > 0 ? (marginCents / retailCents) * 100 : 0
    return { marginCents, platformFeeCents, clinicMarginCents, marginPct }
  }, [retailCents, wholesaleCents])

  // ── Validation states ─────────────────────────────────────────
  const isBelowWholesale = retailCents > 0 && retailCents < wholesaleCents
  // BLK-02: guard wholesaleCents > 0 so $0-wholesale items don't incorrectly trigger
  const isHighMarkup     = wholesaleCents > 0 && retailCents > wholesaleCents * 5
  // NB-09: warn whenever there's a positive spread but clinic keeps < $10
  const isLowMargin      = marginCents > 0 && clinicMarginCents < 1000

  // BLK-05: trim sigText — whitespace-only must not satisfy the 10-char minimum
  const sigTrimmed   = sigText.trim()
  const isSigTooShort = sigText.length > 0 && sigTrimmed.length < 10

  const canContinue =
    retailCents >= wholesaleCents &&
    retailCents > 0 &&
    !isBelowWholesale &&
    (!isHighMarkup || highMarkupAcknowledged) &&
    sigTrimmed.length >= 10

  // ── Multiplier handler ────────────────────────────────────────
  function applyMultiplier(factor: number) {
    // factor = 150 → 1.5× → Math.round(wholesaleCents * 150 / 100)
    const newCents = Math.round(wholesaleCents * factor / 100)
    setRetailInput(toCurrency(newCents))
    setHighMarkupAcknowledged(false)
  }

  // ── WO-80: Add prescription to session ─────────────────────────
  function addToSession() {
    if (!canContinue) return
    rxSession.addPrescription({
      pharmacyId,
      pharmacyName,
      itemId,
      medicationName,
      form,
      dose,
      wholesaleCents,
      deaSchedule: deaSchedule || null,
      retailCents,
      sigText: sigTrimmed,
      integrationTier: '',
    })
  }

  function handleAddAnother(e: React.MouseEvent) {
    e.preventDefault()
    addToSession()
    router.push('/new-prescription/search')
  }

  function handleReviewAll(e: React.FormEvent) {
    e.preventDefault()
    addToSession()
    router.push('/new-prescription/review')
  }

  // ── WO-77: Save as Draft — create DRAFT order without signing ──
  const [isSavingDraft, setIsSavingDraft] = useState(false)
  const [draftError, setDraftError] = useState<string | null>(null)

  async function handleSaveDraft(e: React.MouseEvent) {
    e.preventDefault()
    if (!canContinue) return
    if (!rxSession.patient || !rxSession.provider) return

    setIsSavingDraft(true)
    setDraftError(null)

    try {
      const orderRes = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientId:     rxSession.patient.patient_id,
          providerId:    rxSession.provider.provider_id,
          catalogItemId: itemId,
          pharmacyId,
          retailCents,
          sigText:       sigTrimmed,
          patientState:  rxSession.patient.state ?? '',
        }),
      })

      if (!orderRes.ok) {
        const err = await orderRes.json()
        throw new Error(err.error ?? 'Failed to save draft')
      }

      // Navigate FIRST, then clear session after a tick.
      // Same pattern as WO-80 batch send: clearSession triggers
      // SessionBanner redirect to /new-prescription before router.push fires.
      router.push('/dashboard?draft=1')
      setTimeout(() => rxSession.clearSession(), 100)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'An unexpected error occurred'
      setDraftError(msg)
      setIsSavingDraft(false)
    }
  }

  return (
    <form onSubmit={handleReviewAll} className="space-y-6">

      {/* ── Locked wholesale display — REQ-DMB-001 ── */}
      <div className="rounded-lg border border-border bg-muted/40 p-4">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
          Wholesale Cost (locked)
        </p>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-semibold text-foreground">{medicationName}</p>
            <p className="text-sm text-muted-foreground">{form} · {dose}</p>
            <p className="text-xs text-muted-foreground mt-0.5">via {pharmacyName}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-xl font-bold text-foreground">${toCurrency(wholesaleCents)}</p>
            {deaSchedule >= 2 && (
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-red-100 text-red-800 mt-1">
                DEA Sch. {deaSchedule}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Retail price input — REQ-DMB-002 ── */}
      <div className="space-y-2">
        <label htmlFor="retail-price" className="block text-sm font-medium text-foreground">
          Retail Price <span className="text-destructive">*</span>
        </label>

        {/* Quick-action multiplier buttons */}
        <div className="flex gap-2 flex-wrap">
          {MULTIPLIERS.map(({ label, factor }) => (
            <button
              key={label}
              type="button"
              onClick={() => applyMultiplier(factor)}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {label}
            </button>
          ))}
        </div>

        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground select-none">$</span>
          <input
            id="retail-price"
            type="number"
            step="0.01"
            min="0"
            value={retailInput}
            onChange={e => {
              setRetailInput(e.target.value)
              setHighMarkupAcknowledged(false)
            }}
            // NB-07: prevent scroll-wheel accidentally changing the value
            onWheel={e => (e.currentTarget as HTMLInputElement).blur()}
            aria-invalid={isBelowWholesale ? 'true' : undefined}
            aria-describedby={isBelowWholesale ? 'retail-error' : undefined}
            // NB-07: suppress browser spinner arrows for currency input
            style={{ appearance: 'textfield' } as React.CSSProperties}
            className={`w-full rounded-md border pl-7 pr-3 py-2 text-sm shadow-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring ${
              isBelowWholesale ? 'border-destructive' : 'border-input'
            }`}
          />
        </div>

        {/* REQ-DMB-005: below-wholesale error */}
        {isBelowWholesale && (
          <p id="retail-error" className="text-sm text-destructive" role="alert">
            Retail price must be at least the wholesale cost (${toCurrency(wholesaleCents)}).
          </p>
        )}
      </div>

      {/* ── Real-time margin summary — REQ-DMB-004 ── */}
      {retailCents > 0 && !isBelowWholesale && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Margin Summary
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <span className="text-muted-foreground">Margin %</span>
            <span className="font-medium text-foreground text-right">
              {marginPct.toFixed(1)}%
            </span>

            <span className="text-muted-foreground">Platform fee</span>
            <span className="font-medium text-foreground text-right">
              ${toCurrency(platformFeeCents)}{' '}
              <span className="text-xs text-muted-foreground">(15% of margin)</span>
            </span>

            <span className="text-muted-foreground">Est. clinic margin</span>
            <span className={`font-semibold text-right ${clinicMarginCents >= 1000 ? 'text-emerald-600' : 'text-amber-600'}`}>
              ${toCurrency(clinicMarginCents)}
            </span>
          </div>
        </div>
      )}

      {/* ── REQ-DMB-007: low margin warning (<$10) ── */}
      {isLowMargin && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800" role="alert">
          <strong>Low margin warning:</strong> Estimated clinic margin is below $10.00.
          You may continue, but consider adjusting the retail price.
        </div>
      )}

      {/* ── REQ-DMB-006: high markup warning (>5x) ── */}
      {isHighMarkup && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 space-y-3" role="alert">
          <p className="text-sm font-medium text-amber-800">
            High markup warning: retail price is more than 5× the wholesale cost.
          </p>
          <label className="flex items-start gap-2 text-sm text-amber-800 cursor-pointer">
            <input
              type="checkbox"
              checked={highMarkupAcknowledged}
              onChange={e => setHighMarkupAcknowledged(e.target.checked)}
              className="mt-0.5 rounded border-amber-400"
            />
            <span>I confirm this pricing is intentional and appropriate for this patient.</span>
          </label>
        </div>
      )}

      {/* ── Sig (prescription directions) — REQ-DMB-009 ── */}
      <div className="space-y-1">
        <label htmlFor="sig-text" className="block text-sm font-medium text-foreground">
          Sig (Prescription Directions) <span className="text-destructive">*</span>
        </label>
        <textarea
          id="sig-text"
          rows={3}
          placeholder="e.g. Apply 0.5 mL topically to forearm twice daily."
          value={sigText}
          onChange={e => setSigText(e.target.value)}
          aria-invalid={isSigTooShort ? 'true' : undefined}
          aria-describedby="sig-hint"
          className={`w-full rounded-md border px-3 py-2 text-sm shadow-sm bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none ${
            isSigTooShort ? 'border-destructive' : 'border-input'
          }`}
        />
        {/* NB-02/03: distinguish empty (not started) vs. in-progress-but-short vs. valid */}
        <p
          id="sig-hint"
          className={`text-xs ${
            sigText.length === 0
              ? 'text-muted-foreground'
              : sigTrimmed.length < 10
              ? 'text-destructive'
              : 'text-emerald-600'
          }`}
        >
          {sigText.length === 0
            ? 'Minimum 10 characters required'
            : `${sigTrimmed.length} characters${sigTrimmed.length < 10 ? ' — minimum 10 required' : ''}`}
        </p>
      </div>

      {/* ── WO-80: Session-aware action buttons ── */}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={handleAddAnother}
          disabled={!canContinue}
          className="flex-1 rounded-md border border-primary bg-background px-4 py-2 text-sm font-medium text-primary shadow-sm hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Add & Search Another
        </button>
        <button
          type="submit"
          disabled={!canContinue}
          className="flex-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {rxSession.prescriptionCount > 0
            ? `Review & Send (${rxSession.prescriptionCount + 1})`
            : 'Review & Send'}
        </button>
      </div>
      {rxSession.prescriptionCount > 0 && (
        <p className="text-center text-xs text-muted-foreground">
          {rxSession.prescriptionCount} prescription{rxSession.prescriptionCount !== 1 ? 's' : ''} already in session — this will add one more
        </p>
      )}

      {/* WO-77: Save as Draft — for provider to sign later */}
      <div className="border-t border-border pt-4">
        <button
          type="button"
          onClick={handleSaveDraft}
          disabled={!canContinue || isSavingDraft || !rxSession.isSessionStarted}
          className="w-full rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-muted-foreground shadow-sm hover:bg-muted/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {isSavingDraft ? 'Saving...' : 'Save as Draft — Provider Signs Later'}
        </button>
        <p className="mt-1 text-center text-[10px] text-muted-foreground">
          Creates the order without signing. The provider can review and sign from the dashboard.
        </p>
        {draftError && (
          <p className="mt-2 text-center text-xs text-red-600">{draftError}</p>
        )}
      </div>
    </form>
  )
}
