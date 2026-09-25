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
//
// WO-96: days supply + dispense are derived from dose × frequency ×
// quantity and shown read-only next to the sig (overridable); the
// per-Rx detail fields are pre-filled from the formulation defaults and
// travel to the Review card on the session line.
//
// WO-103: the dose line shows the computed mg equivalent
// ("10 units (0.5 mg)") and carries a ☆ Save as favorite action.
//
// WO-101: when the pharmacy sells the formulation in more than one priced
// package (vial size), "Package: 2.5 mL vial (suggested for 30 days)"
// sits under the formulation line with its price and a dropdown. The
// package drives wholesale, and with it retail, platform fee, clinic
// margin and the quantity the order stores. One package → no control.
//
// WO-101a: when no single vial holds the Rx, the suggestion is a count of
// one package — "Package: 2 × 5 mL vials (suggested for 90 days) ·
// $570.00" — and a number control beside the dropdown changes the count.
// Wholesale is package price × count. The control stays hidden only when
// the pharmacy has one package and one of it covers the Rx.
//
// WO-102: shipping shows as a line under wholesale, outside the margin
// calculation (the platform fee is never charged on it). It is what this
// line adds to the session's shipping — once per pharmacy, so a second
// prescription to the same pharmacy adds nothing unless it upgrades the
// shipment to cold chain.

import { withOrderSelected } from '@/lib/orders/batch-sign-view'
import { useState, useMemo, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { usePrescriptionSession, type SessionPrescription } from '../../_context/prescription-session'
import type { EditTarget } from '../../_lib/edit-target'
import { nextAfterReprice } from '../../_lib/reprice'
import {
  computeDispense,
  defaultQuantityLabel,
  dispenseUnitFor,
  dosesInDays,
  durationDaysForLink,
  suggestPackage,
  packageCountFor,
  formatPackageCount,
  MAX_PACKAGE_COUNT,
  type PackageOption,
  defaultRxDetails,
  missingRxDetails,
  MISSING_RX_DETAIL_LABEL,
  rulesFromFormulation,
  type RxDetails,
  type RxRules,
  pharmacySizeLabels,
} from '@/lib/orders/rx-details'
import {
  computeTitrationDispense,
  type TitrationStep,
  type SigMode,
} from '@/lib/orders/titration'
import type { RxFormulationDefaults } from '@/lib/orders/rx-defaults-loader'
import { splitDose } from '@/lib/orders/dose'
import { DerivedDispense, EMPTY_OVERRIDE, resolveDispense, type DispenseOverride } from '../../_components/derived-dispense'
import { SaveFavoriteButton } from '../../_components/save-favorite-button'
import { formatDoseWithMg } from '@/lib/orders/dose-display'
import { presetDurationFromDays } from '@/lib/orders/favorite-presets'
import { dosingDaysIn, type CyclePattern } from '@/lib/orders/cycling'
import { computeBundleShipping, type PharmacyShippingRates } from '@/lib/orders/shipping'

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
// WO-87: itemId is the legacy flat catalog ID; formulationId is the V3.0
// hierarchical catalog ID. Exactly one of the two will be set, never both.
interface Props {
  pharmacyId:       string
  itemId:           string | null
  formulationId:    string | null
  pharmacyName:     string
  medicationName:   string
  form:             string
  dose:             string
  wholesalePrice:   number         // NUMERIC(10,2) from DB
  deaSchedule:      number
  defaultMarkupPct: number | null  // NUMERIC(5,2) from DB — e.g. 50.00 = 50%
  presetSigText?:   string | undefined  // WO-83: Pre-filled sig from cascading builder
  // WO-96 — inputs for the derived fields + formulation defaults.
  presetFrequency?:    string | undefined   // structured-sig frequency code (QD, QW, …)
  presetQuantity?:     string | undefined   // pharmacy quantity label ("5mL vial")
  presetRefills?:      number | undefined   // builder refills (default 0)
  formulationDetails?: {
    concentrationValue: number | null
    concentrationUnit:  string | null
    dosageFormName:     string | null
  } | null
  rxDefaults?:         RxFormulationDefaults | null
  // WO-98 — which existing line this form saves back to. Absent → add a
  // new session line (the original flow).
  editTarget?:         EditTarget | null
  /** Current values of the draft line being edited (editTarget.kind === 'draft'). */
  draftLine?:          { retailCents: number; rxDetails: RxDetails } | null
  /** Where to land after a draft edit / add (provider → the draft, others → dashboard). */
  draftReturnTo?:      string | null
  /** The builder's dose string ("15 units") — stored on the order for reopening. */
  presetDose?:         string | undefined
  /** WO-101: the pharmacy's active packages for this formulation, smallest first. */
  packages?:           PackageOption[]
  /**
   * WO-101: duration selected on the dose step (structured). undefined only
   * for a legacy saved link that predates the parameter; null = no duration.
   */
  presetDurationDays?: number | null | undefined
  /** WO-104: timing selected on the dose step (structured), for ☆ Save as favorite. */
  presetTiming?:       string | undefined
  /**
   * WO-105: the sig mode and, for a titration, its steps. A titration's
   * days supply, dispense quantity and package are summed across the
   * steps — computeDispense's single dose does not describe it.
   */
  presetSigMode?:      SigMode | undefined
  presetTitrationSteps?: ReadonlyArray<TitrationStep> | undefined
  /**
   * Cycling dose math: a cycling line's on/off pattern. Days supply is
   * the duration (calendar span); dispense and the package are counted
   * over its dosing days only. null on a cycling line = no pattern, and
   * the line cannot continue.
   */
  presetCycle?:        CyclePattern | null | undefined
  /** WO-101: package the draft line being edited was priced from. */
  existingPackageId?:  string | null
  /** WO-101a: how many of that package the draft line carries. */
  existingPackageCount?: number | null
  /** WO-102: this pharmacy's shipping rates (stored on the pharmacy). */
  shippingRates?:      PharmacyShippingRates | null
  /** WO-102: clinics.absorb_shipping */
  absorbShipping?:     boolean
}

// splitDose moved to @/lib/orders/dose (WO-98; WO-103 uses the same helper) — re-exported for existing imports.
export { splitDose }

// WO-101 / WO-101a: why this package (and count) is the suggestion.
function packageSuggestionText(s: NonNullable<ReturnType<typeof suggestPackage>>): string {
  if (s.reason === 'covers' || s.reason === 'multiple') return s.daysSupply != null ? `suggested for ${s.daysSupply} days` : 'suggested'
  if (s.reason === 'capped') {
    return s.daysSupply != null
      ? `${MAX_PACKAGE_COUNT} is the most per prescription — does not cover ${s.daysSupply} days`
      : `${MAX_PACKAGE_COUNT} is the most per prescription`
  }
  return 'default package — no duration selected'
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
  formulationId,
  pharmacyName,
  medicationName,
  form,
  dose,
  wholesalePrice,
  deaSchedule,
  defaultMarkupPct,
  presetSigText,
  presetFrequency,
  presetQuantity,
  presetRefills,
  formulationDetails,
  rxDefaults,
  editTarget = null,
  draftLine = null,
  draftReturnTo = null,
  presetDose,
  packages = [],
  presetDurationDays,
  presetTiming,
  presetSigMode,
  presetTitrationSteps,
  presetCycle = null,
  existingPackageId = null,
  existingPackageCount = null,
  shippingRates = null,
  absorbShipping = false,
}: Props) {
  const router = useRouter()
  const rxSession = usePrescriptionSession()

  // ── WO-98: the line being edited, if any ─────────────────────
  // Session line: read from the session (restored after mount, so the
  // seed values below re-resolve once it is present). Draft line: the
  // server page passed its current values.
  const sessionLine: SessionPrescription | null = editTarget?.kind === 'session'
    ? rxSession.prescriptions.find(rx => rx.id === editTarget.lineId) ?? null
    : null
  // WO-108: a line whose wholesale moved since the source order arrives
  // here to BE priced, so its stale retail must not seed the input. The
  // margin-preserving suggestion does; with no margin worth preserving
  // (no source wholesale, or a source already below its own cost) there
  // is no suggestion and the clinic's default markup seeds it as usual.
  const needsReprice = editTarget?.kind === 'session' && sessionLine?.repriceRequired === true
  const existingRetailCents = editTarget?.kind === 'draft'
    ? draftLine?.retailCents ?? null
    : needsReprice
      ? sessionLine?.suggestedRetailCents ?? null
      : sessionLine?.retailCents ?? null
  const existingDetails: RxDetails | null = editTarget?.kind === 'draft'
    ? draftLine?.rxDetails ?? null
    : sessionLine?.rxDetails ?? null
  const isEditing   = editTarget?.kind === 'session' || editTarget?.kind === 'draft'
  const isDraftMode = editTarget?.kind === 'draft' || editTarget?.kind === 'draft-add'

  // WO-83: Pre-fill sig from cascading builder if available. Declared
  // before the derivation: the duration the provider picked lives in it.
  const [sigText, setSigText] = useState(presetSigText ?? '')

  // ── WO-96: derived days supply + dispense ─────────────────────
  // WO-96 fix: days supply = the selected duration; dispense = doses in
  // that many days × dose. With no duration, both come from the quantity
  // — which is never empty: an absent one defaults to the smallest listed
  // package (or "1"). Recomputes when the dose, frequency, duration,
  // quantity, package or formulation change.
  //
  // WO-101: the builder sends the selected duration as a structured value,
  // used as is — editing the sig text on this page cannot change it.
  // WO-104: favorites now load onto the builder's dose step, so they
  // always arrive with it too. Only a legacy saved link without the
  // parameter falls back, to the sig that link carried (never the sig
  // being edited here) — see durationDaysForLink.
  const durationDays = useMemo(
    () => durationDaysForLink(presetDurationDays, presetSigText),
    [presetDurationDays, presetSigText],
  )
  // Cycling dose math: the pattern every quantity below is counted over.
  const cycle = presetSigMode === 'cycling' ? presetCycle : null

  // ── WO-101: package (vial size) ───────────────────────────────
  const doseForPackages = splitDose(dose)
  const suggestion = useMemo(() => {
    if (packages.length === 0 || !formulationDetails) return null
    const s = suggestPackage(packages, {
      doseAmount:         doseForPackages.amount,
      doseUnit:           doseForPackages.unit,
      frequencyCode:      presetFrequency ?? null,
      concentrationValue: formulationDetails.concentrationValue,
      concentrationUnit:  formulationDetails.concentrationUnit,
      dosageFormName:     formulationDetails.dosageFormName,
      durationDays,
      cycle,
    })
    // One package, and one of it covers the Rx: nothing to choose.
    if (!s || (packages.length < 2 && s.count <= 1)) return null
    return s
  }, [packages, formulationDetails, doseForPackages.amount, doseForPackages.unit, presetFrequency, durationDays, cycle])
  // The line being edited keeps its package when it is still offered.
  const carriedPackageId = editTarget?.kind === 'draft'
    ? existingPackageId
    : sessionLine?.packageId ?? null
  const [pickedPackageId, setPickedPackageId] = useState<string | null>(null)
  const selectedPackage: PackageOption | null = suggestion
    ? packages.find(p => p.id === (pickedPackageId ?? carriedPackageId)) ?? suggestion.package
    : null
  // WO-101a: how many. A picked count wins; a line being edited keeps its
  // own count for its own package; otherwise the whole packages of the
  // selected package that hold the dispense quantity.
  const carriedPackageCount = editTarget?.kind === 'draft'
    ? existingPackageCount
    : sessionLine?.packageCount ?? null
  const [pickedCount, setPickedCount] = useState<number | null>(null)
  const usingCarriedPackage = !!selectedPackage && pickedPackageId == null && selectedPackage.id === carriedPackageId
  const packageCount = !selectedPackage || !suggestion
    ? 1
    : pickedCount
      ?? (usingCarriedPackage && carriedPackageCount ? carriedPackageCount : packageCountFor(selectedPackage, suggestion.dispenseQuantity))
  const packageIsSuggested = !!suggestion && selectedPackage?.id === suggestion.package.id && packageCount === suggestion.count

  // WO-96 fix / WO-101b: the quantity defaults from the pharmacy's priced
  // packages (never pharmacy_formulations.available_quantities). A preset
  // label the pharmacy does not price is not used.
  const sizeLabels = pharmacySizeLabels(packages)
  const effectiveQuantity = useMemo(() => {
    if (selectedPackage) return selectedPackage.label
    if (presetQuantity && (sizeLabels.length === 0 || sizeLabels.includes(presetQuantity))) return presetQuantity
    if (!formulationDetails) return ''
    const { amount, unit } = splitDose(dose)
    const fromDuration = durationDays != null
      ? computeDispense({
          doseAmount: amount, doseUnit: unit, frequencyCode: presetFrequency ?? null, quantityLabel: null,
          concentrationValue: formulationDetails.concentrationValue,
          concentrationUnit:  formulationDetails.concentrationUnit,
          dosageFormName:     formulationDetails.dosageFormName,
          durationDays,
          cycle,
        })
      : null
    return defaultQuantityLabel(
      sizeLabels,
      fromDuration
        ? { quantity: fromDuration.dispenseQuantity, unit: fromDuration.dispenseUnit }
        : { quantity: null, unit: dispenseUnitFor(formulationDetails.dosageFormName, unit) },
      formulationDetails.dosageFormName,
    )
    // sizeLabels is derived from packages each render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPackage, presetQuantity, formulationDetails, dose, durationDays, presetFrequency, packages, cycle])

  // WO-105: a titration's days supply and dispense are the sum over its
  // steps. computeDispense stays exactly as it is for standard and
  // cycling lines — this branches before it, it does not change it.
  const titrationSteps: TitrationStep[] = useMemo(
    () => (presetSigMode === 'titration' && presetTitrationSteps ? presetTitrationSteps.map(t => ({ ...t })) : []),
    [presetSigMode, presetTitrationSteps],
  )

  const titrationDispense = useMemo(
    () => (presetSigMode === 'titration' && presetTitrationSteps && presetTitrationSteps.length > 0 && formulationDetails
      ? computeTitrationDispense(presetTitrationSteps, {
          concentrationValue: formulationDetails.concentrationValue,
          concentrationUnit:  formulationDetails.concentrationUnit,
          dosageFormName:     formulationDetails.dosageFormName,
        })
      : null),
    [presetSigMode, presetTitrationSteps, formulationDetails],
  )

  const derived = useMemo(() => {
    if (!formulationDetails) return null
    if (titrationDispense) {
      return {
        daysSupply:       titrationDispense.totalDays,
        dispenseQuantity: titrationDispense.totalQuantity,
        dispenseUnit:     titrationDispense.dispenseUnit,
      }
    }
    const { amount, unit } = splitDose(dose)
    return computeDispense({
      doseAmount:         amount,
      doseUnit:           unit,
      frequencyCode:      presetFrequency ?? null,
      quantityLabel:      effectiveQuantity || null,
      concentrationValue: formulationDetails.concentrationValue,
      concentrationUnit:  formulationDetails.concentrationUnit,
      dosageFormName:     formulationDetails.dosageFormName,
      durationDays,
      cycle,
    })
  }, [dose, presetFrequency, effectiveQuantity, formulationDetails, durationDays, titrationDispense, cycle])
  const derivedBasis = titrationDispense != null
    ? { kind: 'duration' as const, days: titrationDispense.totalDays, doses: null }
    : durationDays != null
    ? { kind: 'duration' as const, days: durationDays, doses: dosesInDays(durationDays, presetFrequency ?? null, cycle), ...(cycle ? { cycle } : {}) }
    : { kind: 'quantity' as const, label: effectiveQuantity, ...(cycle ? { cycle } : {}) }
  const [dispenseOverride, setDispenseOverride] = useState<DispenseOverride>(EMPTY_OVERRIDE)

  // ── WO-96: pre-filled Rx details + the rules that govern them ──
  const rxRules: RxRules = useMemo(
    () => rulesFromFormulation(rxDefaults?.defaults ?? null, deaSchedule || null),
    [rxDefaults, deaSchedule],
  )
  const rxDetails: RxDetails = useMemo(() => {
    const base = defaultRxDetails(rxDefaults?.defaults ?? null, {
      refills:       presetRefills ?? 0,
      diagnosisCode: rxDefaults?.suggestedDiagnosis?.code ?? null,
      diagnosisText: rxDefaults?.suggestedDiagnosis?.text ?? null,
    })
    // WO-98: when editing, the line's confirmed fields (diagnosis,
    // clinical difference, special instructions, syringe, shipping,
    // substitution) carry over; refills follow the builder; days supply
    // and dispense are re-derived from the (possibly changed) dose unless
    // there is nothing to derive from.
    const carried: Partial<RxDetails> = existingDetails
      ? {
          substitutionAllowed: existingDetails.substitutionAllowed,
          syringeOption:       existingDetails.syringeOption,
          shippingType:        existingDetails.shippingType,
          clinicalDifference:  existingDetails.clinicalDifference ?? base.clinicalDifference,
          diagnosisCode:       existingDetails.diagnosisCode ?? base.diagnosisCode,
          diagnosisText:       existingDetails.diagnosisText ?? base.diagnosisText,
          specialInstructions: existingDetails.specialInstructions,
        }
      : {}
    const dispense = derived || !existingDetails
      ? resolveDispense(derived, dispenseOverride)
      : { daysSupply: existingDetails.daysSupply, dispenseQuantity: existingDetails.dispenseQuantity, dispenseUnit: existingDetails.dispenseUnit }
    return { ...base, ...carried, ...dispense }
  }, [rxDefaults, presetRefills, derived, dispenseOverride, existingDetails])
  // Rule-required fields the Review card will ask the provider to confirm.
  // The draft path below can't collect them here, so it points at Review.
  const missingForDraft = missingRxDetails(rxDetails, rxRules)

  // WO-101: the selected package's price, else the pharmacy formulation's
  // (= its default package's). WO-101a: × the package count.
  const wholesaleCents = useMemo(
    () => selectedPackage ? toCents(selectedPackage.wholesalePrice) * packageCount : toCents(wholesalePrice),
    [selectedPackage, packageCount, wholesalePrice],
  )

  // ── WO-102: shipping this line adds to the session ────────────
  // The session's other lines (not the one being edited) plus this one,
  // once per pharmacy; the difference is what this line adds.
  const shippingLine = useMemo(() => {
    if (!shippingRates) return null
    const rates = new Map([[shippingRates.pharmacyId, shippingRates]])
    const others = rxSession.prescriptions
      .filter(rx => rx.id !== sessionLine?.id && rx.pharmacyId === pharmacyId)
      .map(rx => ({ pharmacyId: rx.pharmacyId, shippingType: rx.rxDetails?.shippingType ?? null, wholesaleCents: rx.wholesaleCents }))
    const self = { pharmacyId, shippingType: rxDetails.shippingType, wholesaleCents }
    const without = computeBundleShipping(others, rates).totalCents
    const withLine = computeBundleShipping([...others, self], rates)
    const pharmacyShipping = withLine.byPharmacy[0]!
    return {
      addsCents:    withLine.totalCents - without,
      totalCents:   withLine.totalCents,
      coldChain:    pharmacyShipping.shippingType === 'cold_chain',
      sharedWith:   others.length,
      waived:       pharmacyShipping.waived,
    }
  }, [shippingRates, rxSession.prescriptions, sessionLine?.id, pharmacyId, rxDetails.shippingType, wholesaleCents])

  // WO-103: dose with its computed mg equivalent, when the formulation
  // has an mg/mL concentration ("10 units (0.5 mg)").
  const concentration = formulationDetails
    ? { concentration_value: formulationDetails.concentrationValue, concentration_unit: formulationDetails.concentrationUnit }
    : null
  const doseParts = splitDose(dose)
  const doseDisplay = formulationDetails ? formatDoseWithMg(doseParts.amount, doseParts.unit, concentration) : dose

  // Retail price input — stored as formatted string so user can type freely.
  // WO-98: an edited line keeps its price until the user changes it.
  const [retailInput, setRetailInput] = useState<string>(() =>
    toCurrency(existingRetailCents ?? defaultRetailCents(wholesaleCents, defaultMarkupPct))
  )
  const [retailSeededFromLine, setRetailSeededFromLine] = useState(existingRetailCents != null)
  if (!retailSeededFromLine && existingRetailCents != null) {
    // Session line arrived after mount (sessionStorage restore) — seed once.
    setRetailSeededFromLine(true)
    setRetailInput(toCurrency(existingRetailCents))
  }
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
    sigTrimmed.length >= 10 &&
    // Cycling dose math: never price a cycling line without its pattern.
    !(presetSigMode === 'cycling' && !cycle)

  // ── WO-101: package change ───────────────────────────────────
  // Wholesale follows the package; retail keeps the markup the provider
  // had (retail ÷ wholesale), so platform fee and clinic margin recompute
  // with it.
  function repriceRetail(nextWholesaleCents: number) {
    if (wholesaleCents > 0 && retailCents > 0) {
      setRetailInput(toCurrency(Math.round(retailCents * nextWholesaleCents / wholesaleCents)))
    } else {
      setRetailInput(toCurrency(defaultRetailCents(nextWholesaleCents, defaultMarkupPct)))
    }
    setHighMarkupAcknowledged(false)
  }

  // WO-101a: a new package gets the count that package needs.
  function changePackage(nextId: string) {
    const next = packages.find(p => p.id === nextId)
    if (!next) return
    const nextCount = packageCountFor(next, suggestion?.dispenseQuantity ?? null)
    repriceRetail(toCents(next.wholesalePrice) * nextCount)
    setPickedPackageId(next.id)
    setPickedCount(null)
  }

  function changePackageCount(raw: string) {
    if (!selectedPackage) return
    const n = parseInt(raw, 10)
    if (!Number.isFinite(n)) return
    const nextCount = Math.min(MAX_PACKAGE_COUNT, Math.max(1, n))
    repriceRetail(toCents(selectedPackage.wholesalePrice) * nextCount)
    setPickedPackageId(selectedPackage.id)
    setPickedCount(nextCount)
  }

  // ── Multiplier handler ────────────────────────────────────────
  function applyMultiplier(factor: number) {
    // factor = 150 → 1.5× → Math.round(wholesaleCents * 150 / 100)
    const newCents = Math.round(wholesaleCents * factor / 100)
    setRetailInput(toCurrency(newCents))
    setHighMarkupAcknowledged(false)
  }

  // ── WO-80: Add prescription to session ─────────────────────────
  function lineFromForm(): Omit<SessionPrescription, 'id'> {
    return {
      pharmacyId,
      pharmacyName,
      itemId,
      formulationId,
      medicationName,
      form,
      dose,
      wholesaleCents,
      deaSchedule: deaSchedule || null,
      retailCents,
      sigText: sigTrimmed,
      integrationTier: '',
      // WO-96
      rxDetails,
      rxRules,
      frequencyCode: presetFrequency ?? null,
      quantityLabel: effectiveQuantity || null,
      // WO-103: lets the Review card show the mg equivalent
      concentrationValue: formulationDetails?.concentrationValue ?? null,
      concentrationUnit:  formulationDetails?.concentrationUnit ?? null,
      // WO-101
      packageId:    selectedPackage?.id ?? null,
      packageLabel: selectedPackage?.label ?? null,
      // WO-101a
      packageCount: selectedPackage ? packageCount : null,
      // WO-105
      sigMode:         presetSigMode ?? 'standard',
      titrationSteps:  titrationSteps,
      // Cycling dose math: the pattern, with the duration as its length.
      cycle:           cycle ? { ...cycle, lengthDays: durationDays } : null,
    }
  }

  function addToSession() {
    if (!canContinue) return
    rxSession.addPrescription(lineFromForm())
  }

  function handleAddAnother(e: React.MouseEvent) {
    e.preventDefault()
    addToSession()
    router.push('/new-prescription/search')
  }

  // Cycling dose math: the on/off pattern every POST / PATCH body carries.
  const cycleBody = cycle ? { cycleOnDays: cycle.onDays, cycleOffDays: cycle.offDays } : {}

  // WO-98: the line body PATCH /api/orders/[id] and POST /api/orders share.
  function lineBody() {
    return {
      catalogItemId: itemId,
      formulationId,
      pharmacyId,
      retailCents,
      sigText:       sigTrimmed,
      rxDetails,
      dose:          presetDose ?? null,
      frequencyCode: presetFrequency ?? null,
      quantityLabel: effectiveQuantity || null,
      packageId:     selectedPackage?.id ?? null,
      packageCount:  selectedPackage ? packageCount : null,
      sigMode:        presetSigMode ?? 'standard',
      titrationSteps: titrationSteps,
      ...cycleBody,
    }
  }

  const [isSavingLine, setIsSavingLine] = useState(false)
  const [lineError, setLineError] = useState<string | null>(null)

  async function handleReviewAll(e: React.FormEvent) {
    e.preventDefault()
    if (!canContinue) return

    // WO-98: edit at Review — patch the same session line, same id.
    if (editTarget?.kind === 'session') {
      const lineId = editTarget.lineId
      rxSession.updatePrescription(lineId, { ...lineFromForm(), repriceRequired: false })
      // WO-108: on to the next line whose price moved, or Review when
      // this was the last one. An ordinary edit has no flagged lines, so
      // it lands on Review exactly as before.
      router.push(nextAfterReprice(rxSession.prescriptions, lineId))
      return
    }

    // WO-98: draft edit / add — server round-trip, then back to the draft.
    if (editTarget?.kind === 'draft' || editTarget?.kind === 'draft-add') {
      if (!rxSession.patient || !rxSession.provider) return
      setIsSavingLine(true)
      setLineError(null)
      try {
        const res = editTarget.kind === 'draft'
          ? await fetch(`/api/orders/${editTarget.orderId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(lineBody()),
            })
          : await fetch('/api/orders', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ...lineBody(),
                patientId:         rxSession.patient.patient_id,
                providerId:        rxSession.provider.provider_id,
                patientState:      rxSession.patient.state ?? '',
                appendedToOrderId: editTarget.orderId,
              }),
            })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error((err as { error?: string }).error ?? 'Failed to save the draft line')
        }
        // WO-99 follow-up: an added line comes back selected on the batch
        // sign page, alongside the selection the provider left.
        const created = editTarget.kind === 'draft-add'
          ? (await res.json().catch(() => ({})) as { orderId?: string }).orderId
          : undefined
        const back = draftReturnTo ?? '/dashboard?draft=1'
        router.push(created ? withOrderSelected(back, created) : back)
      } catch (err) {
        setLineError(err instanceof Error ? err.message : 'An unexpected error occurred')
        setIsSavingLine(false)
      }
      return
    }

    addToSession()
    router.push('/new-prescription/review')
  }

  // ── WO-77: Save as Draft — create DRAFT order without signing ──
  const [isSavingDraft, setIsSavingDraft] = useState(false)
  const [draftError, setDraftError] = useState<string | null>(null)

  // ── Clear the session only once we have actually left this page ──
  //
  // Save as Draft navigates to /dashboard and then clears the session.
  // Clearing while the dashboard navigation is still pending flips
  // isSessionStarted to false on a page that is still mounted, and
  // SessionBanner's redirect effect fires
  // router.replace('/new-prescription'), which supersedes the dashboard
  // push. A timer (the previous "clear after a tick") only wins that
  // race when the dashboard RSC comes back within the tick, which CI
  // does not guarantee. Arming this ref and clearing in the unmount
  // cleanup is deterministic: the cleanup runs when the new route has
  // committed and no /new-prescription page can redirect any more.
  // Same pattern as batch-review-form.tsx.
  const clearSessionOnUnmountRef = useRef(false)
  const clearSessionRef = useRef(rxSession.clearSession)
  clearSessionRef.current = rxSession.clearSession
  useEffect(() => () => {
    if (clearSessionOnUnmountRef.current) clearSessionRef.current()
  }, [])

  async function handleSaveDraft(e: React.MouseEvent) {
    e.preventDefault()
    if (!canContinue) return
    if (!rxSession.patient || !rxSession.provider) return
    if (missingForDraft.length > 0) {
      setDraftError(
        `This prescription needs ${missingForDraft.map(m => MISSING_RX_DETAIL_LABEL[m]).join(' and ')} — ` +
        'use Review & Send to fill in Rx details before saving a draft.',
      )
      return
    }

    setIsSavingDraft(true)
    setDraftError(null)

    try {
      const orderRes = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientId:     rxSession.patient.patient_id,
          providerId:    rxSession.provider.provider_id,
          // WO-87: send whichever ID this rx came from. /api/orders requires
          // exactly one and rejects requests that set both or neither.
          catalogItemId: itemId,
          formulationId,
          pharmacyId,
          retailCents,
          sigText:       sigTrimmed,
          patientState:  rxSession.patient.state ?? '',
          // WO-96: derived + defaulted detail fields
          rxDetails,
          // WO-96 fix / WO-98: builder inputs stored on medication_snapshot
          // so a reopened draft keeps dose, frequency and quantity.
          dose:          presetDose ?? null,
          frequencyCode: presetFrequency ?? null,
          quantityLabel: effectiveQuantity || null,
          // WO-101: priced server-side from the package.
          packageId:     selectedPackage?.id ?? null,
          // WO-101a: priced server-side as package × count.
          packageCount:  selectedPackage ? packageCount : null,
          // WO-105: the sig mode and the titration steps. This body is
          // written out by hand rather than from lineBody(), so it lost
          // both when WO-105 added them: a titration saved as a draft
          // from this page landed sig_mode 'standard' with no steps and
          // the schedule was silently gone. It reopened as a standard
          // line at the first step's dose, which is a different
          // prescription from the one the provider wrote.
          sigMode:        presetSigMode ?? 'standard',
          titrationSteps: titrationSteps,
          // Cycling dose math: the pattern, so the draft reopens cycling.
          ...cycleBody,
        }),
      })

      if (!orderRes.ok) {
        const err = await orderRes.json()
        throw new Error(err.error ?? 'Failed to save draft')
      }

      // Navigate to the dashboard; the session is cleared in the unmount
      // cleanup once that navigation has committed (see
      // clearSessionOnUnmountRef) — clearing any earlier lets the
      // SessionBanner redirect race the dashboard push.
      clearSessionOnUnmountRef.current = true
      router.push('/dashboard?draft=1')
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
            <p className="text-sm text-muted-foreground">{form} · <span data-testid="dose-display">{doseDisplay}</span></p>
            <p className="text-xs text-muted-foreground mt-0.5">via {pharmacyName}</p>
            {/* WO-101: package (vial size) — only when there is a choice.
                WO-101a: or when one package takes more than one of it. */}
            {suggestion && selectedPackage && (
              <div className="mt-2 space-y-1" data-testid="package-control">
                <p className="text-sm text-foreground" data-testid="package-summary">
                  Package: <span className="font-medium">{formatPackageCount(selectedPackage.label, packageCount)}</span>
                  {' '}
                  <span className="text-muted-foreground">
                    {packageIsSuggested
                      ? `(${packageSuggestionText(suggestion)})`
                      : '(changed by provider)'}
                  </span>
                  {' · '}
                  <span className="font-medium" data-testid="package-price">${toCurrency(wholesaleCents)}</span>
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    aria-label="Number of packages"
                    min={1}
                    max={MAX_PACKAGE_COUNT}
                    step={1}
                    value={packageCount}
                    onChange={e => changePackageCount(e.target.value)}
                    onWheel={e => (e.currentTarget as HTMLInputElement).blur()}
                    className="w-16 rounded-md border border-input bg-background px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <span className="text-sm text-muted-foreground" aria-hidden="true">×</span>
                  <select
                    aria-label="Package"
                    value={selectedPackage.id}
                    onChange={e => changePackage(e.target.value)}
                    className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {packages.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.label} — ${toCurrency(toCents(p.wholesalePrice))}{p.id === suggestion.package.id ? ' (suggested)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
            {/* WO-102: shipping — under wholesale, outside the margin */}
            {shippingLine && (
              <p className="mt-2 text-xs text-muted-foreground" data-testid="shipping-line">
                Shipping ({shippingLine.coldChain ? 'cold chain' : 'standard'}):{' '}
                <span className="font-medium text-foreground" data-testid="shipping-line-amount">${toCurrency(shippingLine.addsCents)}</span>
                {' — '}
                {shippingLine.waived
                  ? `free: this pharmacy's order meets its $${toCurrency(shippingRates?.freeShippingThresholdCents ?? 0)} free-shipping threshold`
                  : shippingLine.sharedWith > 0 && shippingLine.addsCents === 0
                    ? `ships with the other ${pharmacyName} prescription${shippingLine.sharedWith > 1 ? 's' : ''} in this session ($${toCurrency(shippingLine.totalCents)} once)`
                    : shippingLine.sharedWith > 0
                      ? `upgrades this session's ${pharmacyName} shipment to cold chain ($${toCurrency(shippingLine.totalCents)} once)`
                      : `charged once for ${pharmacyName}, however many prescriptions it ships`}
                {'. '}
                {absorbShipping ? 'Absorbed by the clinic.' : 'Passed to the patient at cost; not part of the margin.'}
              </p>
            )}
            {/* WO-103: ☆ Save as favorite — name defaults to "<Drug> <dose> <freq>" */}
            <div className="mt-2">
              <SaveFavoriteButton
                providerId={rxSession.provider?.provider_id ?? ''}
                formulationId={formulationId}
                pharmacyId={pharmacyId}
                medicationName={medicationName}
                doseAmount={doseParts.amount}
                doseUnit={doseParts.unit}
                frequencyCode={presetFrequency ?? null}
                timingCode={presetTiming ?? ''}
                duration={presetDurationFromDays(durationDays)}
                cycle={cycle ? { ...cycle, lengthDays: durationDays } : null}
                refills={rxDetails.refills}
                patient={rxSession.patient ? { patientId: rxSession.patient.patient_id, name: `${rxSession.patient.first_name} ${rxSession.patient.last_name}` } : null}
                disabled={sigTrimmed.length < 10}
              />
            </div>
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

      {/* ── WO-108: why this line stopped here ── */}
      {needsReprice && (
        <div
          role="status"
          data-testid="reprice-notice"
          className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/20"
        >
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            This pharmacy&apos;s price has changed since the last fill.
          </p>
          {sessionLine?.priceNote && (
            <p className="mt-1 text-xs text-amber-800 dark:text-amber-300" data-testid="reprice-price-note">
              {sessionLine.priceNote}
            </p>
          )}
          <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
            {sessionLine?.marginBasis === 'clinic_default'
              ? 'The original order has no usable margin to carry forward, so the price below is your clinic’s default markup. Change it if it is wrong.'
              : 'The price below keeps the margin the original order was written at. Change it if it is wrong — the patient pays what you confirm here.'}
          </p>
        </div>
      )}

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
            className={`w-full rounded-md border pl-7 pr-3 py-2 text-base shadow-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring ${
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
          className={`w-full rounded-md border px-3 py-2 text-base shadow-sm bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none ${
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

        {/* WO-96: derived days supply + dispense, read-only with override.
            Only the V3.0 formulation path has the inputs to derive from. */}
        {formulationDetails && (
          <DerivedDispense
            derived={derived}
            basis={derivedBasis}
            override={dispenseOverride}
            onChange={setDispenseOverride}
          />
        )}
      </div>

      {/* ── WO-80: Session-aware action buttons ── */}
      {/* WO-98: editing a line offers exactly one action — save it back
          where it came from. Adding to a draft likewise. */}
      <div className="flex gap-3">
        {!isEditing && !isDraftMode && (
          <button
            type="button"
            onClick={handleAddAnother}
            disabled={!canContinue}
            className="flex-1 rounded-md border border-primary bg-background px-4 py-2 text-sm font-medium text-primary shadow-sm hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Add & Search Another
          </button>
        )}
        {(isEditing || isDraftMode) && (
          <button
            type="button"
            onClick={() => router.push(editTarget?.kind === 'session' ? '/new-prescription/review' : (draftReturnTo ?? '/dashboard'))}
            disabled={isSavingLine}
            className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm hover:bg-muted/50 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={!canContinue || isSavingLine}
          className="flex-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {isSavingLine
            ? 'Saving...'
            : editTarget?.kind === 'session'
              ? 'Save Changes — Back to Review'
              : editTarget?.kind === 'draft'
                ? 'Save Changes to Draft'
                : editTarget?.kind === 'draft-add'
                  ? 'Add to Draft'
                  : rxSession.prescriptionCount > 0
                    ? `Review & Send (${rxSession.prescriptionCount + 1})`
                    : 'Review & Send'}
        </button>
      </div>
      {lineError && (
        <p className="text-center text-xs text-red-600" role="alert">{lineError}</p>
      )}
      {!isEditing && !isDraftMode && rxSession.prescriptionCount > 0 && (
        <p className="text-center text-xs text-muted-foreground">
          {rxSession.prescriptionCount} prescription{rxSession.prescriptionCount !== 1 ? 's' : ''} already in session — this will add one more
        </p>
      )}

      {/* WO-77: Save as Draft — for provider to sign later */}
      {!isEditing && !isDraftMode && (
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
      )}
    </form>
  )
}
