'use client'

// ============================================================
// Cascading Prescription Builder — WO-83
// ============================================================
//
// Progressive disclosure dropdown system for configuring
// compounded medication prescriptions. Each dropdown selection
// filters the next level. Replaces the card-based pharmacy search.
//
// Cascade: Category → Ingredient → Salt Form → Dosage Form →
//          Route → Concentration/Formulation → Dose → Frequency →
//          Quantity → Pharmacy
//
// Outputs to the WO-80 PrescriptionSession via addPrescription().
//
// WO-103: the medication search is the first element under the session
// banner, with Favorites (N) / Protocols (N) buttons beside it that
// open panels (see quick-actions-panel.tsx).
//
// WO-104: a favorite's dose chip, its Custom chip and a Recent item load
// HERE, on the dose step, with the cascade and every dropdown populated
// from structured values (amount, unit, frequency, timing, duration) —
// never the margin page with a free-text sig. The provider then continues
// to price as normal. The clinic's common doses for the selected
// formulation also show as chips on the dose step.

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { usePrescriptionSession } from '../_context/prescription-session'
import { StructuredSigBuilder } from './structured-sig-builder'
import {
  computeTitrationDispense,
  type TitrationStep,
  type SigMode,
} from '@/lib/orders/titration'
import { QuickActionsPanel, useClinicFavorites, type Favorite, type RecentItem } from './quick-actions-panel'
import { SaveFavoriteButton } from './save-favorite-button'
import { builderStateFromLine, editTargetToParams, type EditTarget } from '../_lib/edit-target'
import type { BuilderInitialState } from '@/lib/orders/draft-edit'
import type { SigTimingAndDuration } from '../_lib/sig-recovery'
import {
  builderLoadFromFavorite,
  mergePresets,
  presetDurationFromBuilder,
  type DosePreset,
  type FavoriteBuilderLoad,
} from '@/lib/orders/favorite-presets'
import {
  computeDispense,
  defaultQuantityLabel,
  dispenseUnitFor,
  suggestPackage,
  suggestPackageForDispense,
  formatPackageCount,
  pharmacySizeLabels,
  type PackageOption,
} from '@/lib/orders/rx-details'

// ── Types ─────────────────────────────────────────────────────

interface Ingredient {
  ingredient_id: string
  common_name: string
  therapeutic_category: string | null
  dea_schedule: number | null
  fda_alert_status: string | null
  fda_alert_message: string | null
  description: string | null
}

interface SaltForm {
  salt_form_id: string
  salt_name: string
  abbreviation: string | null
}

interface DosageForm {
  dosage_form_id: string
  name: string
  is_sterile: boolean
  requires_injection_supplies: boolean
  sort_order: number
}

interface Route {
  route_id: string
  name: string
  abbreviation: string
  sig_prefix: string
  sort_order: number
}

interface Formulation {
  formulation_id: string
  name: string
  concentration: string | null
  concentration_value: number | null
  concentration_unit: string | null
  excipient_base: string | null
  is_combination: boolean
  total_ingredients: number
  description: string | null
  dosage_forms: { name: string; is_sterile: boolean; requires_injection_supplies: boolean } | null
  routes_of_administration: { name: string; abbreviation: string; sig_prefix: string } | null
  formulation_ingredients: Array<{
    ingredient_id: string
    concentration_per_unit: string
    role: string
    ingredients: { common_name: string; dea_schedule: number | null; fda_alert_status: string | null } | null
  }>
}

interface PharmacyOption {
  pharmacy_formulation_id: string
  wholesale_price: number
  estimated_turnaround_days: number | null
  /**
   * WO-101: active packages (vial sizes) with their own prices, smallest
   * first. WO-101b: the ONLY source for the sizes this option shows.
   */
  packages?: PackageOption[]
  pharmacies: {
    pharmacy_id: string
    name: string
    slug: string
    integration_tier: string
    fax_number: string | null
    supports_real_time_status: boolean
  } | null
}

// Frequency options moved to structured-sig-builder.types.ts (WO-84)

// ── Helpers ───────────────────────────────────────────────────

/**
 * No timing, no duration. What the dose step starts from for anything
 * the provider picks by hand — never the values of an earlier line.
 */
const NO_TIMING_DURATION: SigTimingAndDuration = { timing: '', duration: '', customDurationDays: '' }

function toCurrency(dollars: number): string {
  return '$' + dollars.toFixed(2)
}

function toCents(dollars: number): number {
  return Math.round(dollars * 100)
}

/** Default dose unit for a dosage form — what picking a formulation pre-selects. */
function defaultUnitFor(f: Formulation): string {
  const form = f.dosage_forms?.name ?? ''
  if (form.includes('Injectable')) return 'units'
  if (form.includes('Capsule') || form.includes('Tablet')) return 'tablet'
  if (form.includes('Solution')) return 'mL'
  return ''
}

// ── Fetcher ───────────────────────────────────────────────────

async function fetchLevel<T>(level: string, params: Record<string, string> = {}): Promise<T[]> {
  const search = new URLSearchParams({ level, ...params })
  const res = await fetch(`/api/formulations?${search.toString()}`)
  if (!res.ok) throw new Error(`Failed to fetch ${level}`)
  const json = await res.json()
  return json.data ?? []
}

// ── Props ─────────────────────────────────────────────────────
//
// WO-98: the builder can reopen an existing line. `editTarget` says
// which line (session line at Review, draft order, or "append to
// draft") and travels to the margin page in the URL; `initial` is the
// line's current values for a draft (resolved server-side). For a
// session line the values come from the session itself.
interface Props {
  editTarget?: EditTarget | null
  initial?:    BuilderInitialState | null
}

interface FormulationContext {
  formulation: Formulation | null
  salt_form:   SaltForm | null
  ingredient:  Ingredient | null
}

export function CascadingPrescriptionBuilder({ editTarget = null, initial = null }: Props = {}) {
  const router = useRouter()
  const session = usePrescriptionSession()

  // WO-98: values to reopen with. Session lines are read from the
  // session (restored from sessionStorage after mount, hence the memo).
  const sessionLine = editTarget?.kind === 'session'
    ? session.prescriptions.find(rx => rx.id === editTarget.lineId) ?? null
    : null
  const effectiveInitial = useMemo<BuilderInitialState | null>(
    () => initial ?? (sessionLine ? builderStateFromLine(sessionLine) : null),
    [initial, sessionLine],
  )

  // ── Selection state ─────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedIngredient, setSelectedIngredient] = useState<Ingredient | null>(null)
  const [selectedSaltForm, setSelectedSaltForm] = useState<SaltForm | null>(null)
  const [selectedFormulation, setSelectedFormulation] = useState<Formulation | null>(null)
  const [selectedPharmacyState, setSelectedPharmacy] = useState<PharmacyOption | null>(null)
  const [selectedFrequency, setSelectedFrequency] = useState('')
  const [doseAmount, setDoseAmount] = useState('')
  const [doseUnit, setDoseUnit] = useState('')
  // WO-96 fix: `quantity` is the provider's explicit pick. Until they pick
  // one (quantityPicked), the dropdown shows a computed default package
  // instead of an empty "Select quantity" (rule 2).
  const [quantity, setQuantity] = useState('')
  const [quantityPicked, setQuantityPicked] = useState(false)
  const [refills, setRefills] = useState('0')
  const [currentSig, setCurrentSig] = useState('')
  // WO-101: the duration selected on the dose step, as reported by the
  // sig builder (structured — not read back out of the sig).
  const [durationDays, setDurationDays] = useState<number | null>(null)
  // WO-105: the sig mode and the titration steps, structured. The steps
  // are what days supply, dispense and the package suggestion are summed
  // from; a titration has no single dose for computeDispense to use.
  const [sigMode, setSigMode] = useState<SigMode>('standard')
  const [titrationSteps, setTitrationSteps] = useState<TitrationStep[]>([])
  // WO-98: pharmacy of the reopened line. Until the user picks one, the
  // matching option (once pharmacy_options load) counts as selected.
  const [pendingPharmacyId, setPendingPharmacyId] = useState<string | null>(null)
  const hydratedRef = useRef(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  // WO-104: a favorite / Recent load re-mounts the sig builder with its
  // timing + duration as structured initial values (loadNonce is part of
  // the sig builder's key), and the dose step is scrolled into view.
  //
  // null means "not set yet": only then may the sig builder recover timing
  // + duration from the reopened line's sig (WO-98). Every medication the
  // provider picks by hand sets NO_TIMING_DURATION, so a line being edited
  // (say "in the morning for 90 days") can never hand its timing and
  // duration to a different medication.
  const [structuredInit, setStructuredInit] = useState<SigTimingAndDuration | null>(null)
  const [loadNonce, setLoadNonce] = useState(0)
  const [timingDuration, setTimingDuration] = useState<SigTimingAndDuration>(NO_TIMING_DURATION)
  const doseStepRef = useRef<HTMLDivElement>(null)
  const pendingScrollRef = useRef(false)

  // ── Cascading queries ───────────────────────────────────

  const { data: categories = [] } = useQuery({
    queryKey: ['formulation-categories'],
    queryFn: () => fetchLevel<string>('categories'),
  })

  const { data: ingredients = [] } = useQuery({
    queryKey: ['formulation-ingredients', searchQuery],
    queryFn: () => fetchLevel<Ingredient>('ingredients', searchQuery.length >= 2 ? { q: searchQuery } : {}),
    enabled: true,
  })

  const { data: saltForms = [] } = useQuery({
    queryKey: ['formulation-salt-forms', selectedIngredient?.ingredient_id],
    queryFn: () => fetchLevel<SaltForm>('salt_forms', { ingredient_id: selectedIngredient!.ingredient_id }),
    enabled: !!selectedIngredient,
  })

  const { data: formulations = [] } = useQuery({
    queryKey: ['formulation-list', selectedSaltForm?.salt_form_id, selectedIngredient?.ingredient_id],
    queryFn: () => {
      const params: Record<string, string> = {}
      if (selectedSaltForm) params.salt_form_id = selectedSaltForm.salt_form_id
      return fetchLevel<Formulation>('formulations', params)
    },
    enabled: !!selectedSaltForm || !!selectedIngredient,
  })

  const { data: pharmacyOptions = [] } = useQuery({
    queryKey: ['formulation-pharmacies', selectedFormulation?.formulation_id, session.patient?.state],
    queryFn: () => fetchLevel<PharmacyOption>('pharmacy_options', {
      formulation_id: selectedFormulation!.formulation_id,
      ...(session.patient?.state ? { state: session.patient.state } : {}),
    }),
    enabled: !!selectedFormulation,
  })

  // ── WO-104: the clinic's common doses for the selected formulation ──
  const { favorites } = useClinicFavorites()
  const doseStepPresets = useMemo<DosePreset[]>(() => {
    if (!selectedFormulation) return []
    return favorites
      .filter(f => f.formulation_id === selectedFormulation.formulation_id)
      .reduce<DosePreset[]>((acc, f) => mergePresets(acc, f.dose_presets), [])
  }, [favorites, selectedFormulation])

  // ── Auto-select salt form if only one ───────────────────
  useEffect(() => {
    if (saltForms.length === 1 && !selectedSaltForm) {
      setSelectedSaltForm(saltForms[0] ?? null)
    }
  }, [saltForms, selectedSaltForm])

  // ── WO-98: reopen an existing line with the cascade pre-selected ──
  // One fetch resolves formulation + salt form + ingredient; the
  // pharmacy is matched once pharmacy_options arrive (effect below).
  useEffect(() => {
    if (!effectiveInitial || hydratedRef.current) return
    hydratedRef.current = true
    if (!effectiveInitial.formulationId) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/formulations?level=formulation&formulation_id=${encodeURIComponent(effectiveInitial.formulationId as string)}`)
        if (!res.ok) return
        const json = await res.json() as { data?: FormulationContext }
        if (cancelled || !json.data?.formulation) return
        const { formulation, salt_form, ingredient } = json.data
        if (ingredient) setSelectedIngredient(ingredient)
        if (salt_form) setSelectedSaltForm(salt_form)
        setSelectedFormulation(formulation)
        setDoseAmount(effectiveInitial.doseAmount)
        setDoseUnit(effectiveInitial.doseUnit)
        setSelectedFrequency(effectiveInitial.frequency)
        setQuantity(effectiveInitial.quantity)
        // WO-96 fix: a reopened line keeps its own quantity rather than
        // being re-defaulted.
        setQuantityPicked(!!effectiveInitial.quantity)
        setRefills(String(effectiveInitial.refills))
        setPendingPharmacyId(effectiveInitial.pharmacyId || null)
        // WO-105: a reopened titration reopens as a titration, with its
        // steps — not as a standard sig with the schedule stranded in
        // sig_text.
        setSigMode(effectiveInitial.sigMode)
        setTitrationSteps(effectiveInitial.titrationSteps)
      } catch (err) {
        console.warn('[builder] could not reopen line (non-fatal):', err instanceof Error ? err.message : err)
      }
    })()
    return () => { cancelled = true }
  }, [effectiveInitial])

  const selectedPharmacy: PharmacyOption | null = selectedPharmacyState
    ?? (pendingPharmacyId
      ? pharmacyOptions.find(po => po.pharmacies?.pharmacy_id === pendingPharmacyId) ?? null
      : null)

  // ── Stable callback for sig changes from StructuredSigBuilder ──
  const handleSigChange = useCallback((sig: string) => {
    setCurrentSig(sig)
  }, [])
  const handleTimingDurationChange = useCallback((value: SigTimingAndDuration) => {
    setTimingDuration(value)
  }, [])

  useEffect(() => {
    if (!pendingScrollRef.current || !selectedFormulation) return
    pendingScrollRef.current = false
    doseStepRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }, [selectedFormulation, loadNonce])

  // ── Reset downstream selections ─────────────────────────
  // Everything the dose step derives belongs to ONE medication, and is
  // cleared when the medication changes: timing, duration, durationDays,
  // and — WO-105 — the sig mode and the titration steps. All of them
  // drive days supply, the default quantity and the suggested vial
  // count, so none may outlive the dose step it came from. A titration
  // schedule that survived a medication change would hand the next drug
  // the previous drug's steps, in the previous drug's units.
  //
  // Callers that legitimately carry state (a favorite, a protocol, a
  // reopened draft) call this first and then apply their own values.
  function resetDoseStepState(next: SigTimingAndDuration) {
    setStructuredInit(next)
    setTimingDuration(next)
    setDurationDays(null)
    setSigMode('standard')
    setTitrationSteps([])
  }

  function selectIngredient(ing: Ingredient) {
    resetDoseStepState(NO_TIMING_DURATION)
    setSelectedIngredient(ing)
    setSelectedSaltForm(null)
    setSelectedFormulation(null)
    setSelectedPharmacy(null)
    setPendingPharmacyId(null)
    setDoseAmount('')
    setDoseUnit('')
    setSelectedFrequency('')
    setQuantity('')
    setQuantityPicked(false)
    setCurrentSig('')
  }

  function selectSaltForm(sf: SaltForm) {
    setSelectedSaltForm(sf)
    setSelectedFormulation(null)
    setSelectedPharmacy(null)
  }

  function selectFormulation(f: Formulation) {
    // Re-clicking the selected formulation keeps the sig builder mounted
    // (same key), so its timing + duration — and the parent's copies —
    // stay as they are.
    if (selectedFormulation?.formulation_id !== f.formulation_id) resetDoseStepState(NO_TIMING_DURATION)
    setSelectedFormulation(f)
    setSelectedPharmacy(null)
    setPendingPharmacyId(null)
    setQuantityPicked(false)
    // Set default dose unit based on dosage form
    setDoseUnit(defaultUnitFor(f))
    if (f.dosage_forms?.name.includes('Capsule') || f.dosage_forms?.name.includes('Tablet')) {
      setDoseAmount('1')
    }
  }

  // ── WO-96 fix: default quantity from what the pharmacy sells ──
  // With a duration, dispense = doses in that many days × dose, and the
  // default package is the smallest one that covers it. Without it, the
  // smallest package in the dispense unit. Recomputed whenever dose,
  // frequency, duration, formulation or pharmacy change.
  // WO-101b: the pharmacy's priced packages only — a size with no package
  // row has no known price and is never offered.
  // WO-105: the summed quantity across the steps (0.4 + 0.8 + 1.6 mL),
  // never the target dose for the whole duration — that overshoots by
  // the size of the titration.
  const titrationDispense = useMemo(
    () => (sigMode === 'titration' && titrationSteps.length > 0 && selectedFormulation
      ? computeTitrationDispense(titrationSteps, {
          concentrationValue: selectedFormulation.concentration_value,
          concentrationUnit:  selectedFormulation.concentration_unit,
          dosageFormName:     selectedFormulation.dosage_forms?.name ?? null,
        })
      : null),
    [sigMode, titrationSteps, selectedFormulation],
  )

  const pharmacyQuantities = pharmacySizeLabels(selectedPharmacy?.packages)
  const defaultQuantity = useMemo(() => {
    if (!selectedFormulation) return ''
    const dosageFormName = selectedFormulation.dosage_forms?.name ?? null
    const fromDuration = durationDays != null
      ? computeDispense({
          doseAmount,
          doseUnit,
          frequencyCode:      selectedFrequency,
          quantityLabel:      null,
          concentrationValue: selectedFormulation.concentration_value,
          concentrationUnit:  selectedFormulation.concentration_unit,
          dosageFormName,
          durationDays,
        })
      : null
    const derived = titrationDispense
      ? { quantity: titrationDispense.totalQuantity, unit: titrationDispense.dispenseUnit }
      : fromDuration
        ? { quantity: fromDuration.dispenseQuantity, unit: fromDuration.dispenseUnit }
        : { quantity: null, unit: dispenseUnitFor(dosageFormName, doseUnit) }
    return defaultQuantityLabel(pharmacyQuantities, derived, dosageFormName)
    // pharmacyQuantities is derived from selectedPharmacy each render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFormulation, selectedPharmacy, doseAmount, doseUnit, selectedFrequency, durationDays, titrationDispense])
  // ── WO-101: priced packages ─────────────────────────────
  // A pharmacy that sells this formulation in more than one priced package
  // gets a suggested package (smallest that covers the dispense quantity
  // for the duration) and its price. The provider changes it on the price
  // step, where wholesale / retail / margin recompute; here it replaces
  // the interim Quantity dropdown.
  function packageSuggestionFor(po: PharmacyOption | null) {
    const pkgs = po?.packages ?? []
    if (!selectedFormulation || pkgs.length === 0) return null
    // WO-105: a titration is sized from its summed quantity.
    if (titrationDispense) {
      const t = suggestPackageForDispense(
        pkgs,
        {
          dispenseQuantity: titrationDispense.totalQuantity,
          dispenseUnit:     titrationDispense.dispenseUnit,
          daysSupply:       titrationDispense.totalDays,
        },
        selectedFormulation.dosage_forms?.name ?? null,
      )
      if (!t || (pkgs.length < 2 && t.count <= 1)) return null
      return t
    }
    const s = suggestPackage(pkgs, {
      doseAmount,
      doseUnit,
      frequencyCode:      selectedFrequency,
      concentrationValue: selectedFormulation.concentration_value,
      concentrationUnit:  selectedFormulation.concentration_unit,
      dosageFormName:     selectedFormulation.dosage_forms?.name ?? null,
      durationDays,
    })
    // WO-101a: a single package matters only when more than one is needed.
    if (!s || (pkgs.length < 2 && s.count <= 1)) return null
    return s
  }
  const selectedSuggestion = packageSuggestionFor(selectedPharmacy)
  const quantityOptions = pharmacyQuantities.length > 0 ? [...pharmacyQuantities] : ['1']
  // WO-101b: a picked (or reopened) quantity counts only while this
  // pharmacy still prices that size; otherwise the computed default.
  const effectiveQuantity = selectedSuggestion
    ? selectedSuggestion.package.label
    : quantityPicked && quantity && quantityOptions.includes(quantity) ? quantity : defaultQuantity

  // ── Can add to session? ─────────────────────────────────
  // WO-105: a titration is complete when its steps are — the single dose
  // field is not part of one. An invalid titration generates no sig, so
  // the sig-length check alone would already block it; this says why.
  const canAdd = !!(
    selectedFormulation &&
    selectedPharmacy &&
    currentSig.length >= 10 &&
    (sigMode === 'titration'
      ? titrationSteps.length > 0 && titrationDispense != null
      : doseAmount && selectedFrequency)
  )

  // ── WO-104: load a favorite / Recent item onto the dose step ──
  // Everything comes from structured values: the formulation context is
  // fetched (as the WO-98 reopen does), the pharmacy is matched once
  // pharmacy_options arrive, and timing + duration go to the sig builder
  // as initialStructured. The sig is generated there, never parsed. The
  // quantity is left to the computed default package.
  async function loadOntoDoseStep(load: FavoriteBuilderLoad) {
    try {
      const res = await fetch(`/api/formulations?level=formulation&formulation_id=${encodeURIComponent(load.formulationId)}`)
      if (!res.ok) return
      const json = await res.json() as { data?: FormulationContext }
      if (!json.data?.formulation) return
      const { formulation, salt_form, ingredient } = json.data
      setSearchQuery('')
      setSelectedIngredient(ingredient)
      setSelectedSaltForm(salt_form)
      setSelectedFormulation(formulation)
      setSelectedPharmacy(null)
      setPendingPharmacyId(load.pharmacyId || null)
      // Custom (no dose): the unit defaults from the dosage form exactly as
      // picking the formulation by hand does; amount and frequency stay empty.
      setDoseAmount(load.doseAmount)
      setDoseUnit(load.doseUnit || defaultUnitFor(formulation))
      setSelectedFrequency(load.frequency)
      setQuantity('')
      setQuantityPicked(false)
      setRefills(String(load.refills))
      setCurrentSig('')
      // Exactly what the preset carries — '' where it has no timing or
      // duration, never what the dose step held before.
      resetDoseStepState({ timing: load.timing, duration: load.duration, customDurationDays: load.customDurationDays })
      // WO-105: a titration favorite comes back as a titration. The
      // remount below (loadNonce) is what seeds the builder's step table
      // from initialTitrationSteps.
      setSigMode(load.sigMode)
      setTitrationSteps(load.titrationSteps)
      setLoadNonce(n => n + 1)
      pendingScrollRef.current = true
    } catch (err) {
      console.warn('[builder] could not load favorite (non-fatal):', err instanceof Error ? err.message : err)
    }
  }

  function handleLoadFavorite(fav: Favorite, preset: DosePreset | null) {
    if (!fav.formulation_id) return
    void loadOntoDoseStep(builderLoadFromFavorite(fav, preset))
  }

  function handleLoadRecent(item: RecentItem) {
    void loadOntoDoseStep(builderLoadFromFavorite(
      { formulation_id: item.formulation_id, pharmacy_id: item.pharmacy_id, default_refills: 0 },
      item.preset,
    ))
  }

  // ── Navigate to margin builder (where retail price is set) ──
  // BLK-01 fix: Don't add to session here — the margin builder handles
  // addPrescription after the retail price is set. We pass all config
  // via URL params so the margin builder has everything it needs.
  function navigateToMargin() {
    if (!selectedFormulation || !selectedPharmacy?.pharmacies) return

    const params = new URLSearchParams({
      pharmacyId: selectedPharmacy.pharmacies.pharmacy_id,
      formulation_id: selectedFormulation.formulation_id,
      // WO-105: a titration's dose line is the step it starts on; the
      // whole schedule travels in titrationSteps.
      dose: sigMode === 'titration' && titrationSteps[0]
        ? `${titrationSteps[0].dose} ${titrationSteps[0].unit}`.trim()
        : `${doseAmount} ${doseUnit}`.trim(),
      frequency: sigMode === 'titration' && titrationSteps[0] ? titrationSteps[0].frequency : selectedFrequency,
      sigText: currentSig,
      // WO-96: the margin page derives days supply + dispense (from the
      // duration in the sig, else dose × frequency × quantity) and
      // defaults refills from here. Never empty: the default package.
      quantity: effectiveQuantity,
      refills,
      // WO-101: the selected duration, structured, for the package
      // suggestion and days supply on the price step ('' = no duration).
      durationDays: durationDays != null ? String(durationDays) : '',
      // WO-104: the selected timing, structured, so Save as favorite on
      // the price step stores it with the dose.
      timing: timingDuration.timing,
      // WO-105: the mode and, for a titration, the steps — structured, so
      // the price step and the order never re-read them from sig text.
      sigMode,
      // WO-98: keep the edit / add-to-draft target through the margin page.
      ...editTargetToParams(editTarget),
    })

    if (sigMode === 'titration' && titrationSteps.length > 0) {
      params.set('titrationSteps', JSON.stringify(titrationSteps))
    }

    // WO-86: Pass DEA schedule so margin builder can thread it to the session
    if (selectedIngredient?.dea_schedule) {
      params.set('deaSchedule', String(selectedIngredient.dea_schedule))
    }

    router.push(`/new-prescription/margin?${params.toString()}`)
  }

  // ── Render ──────────────────────────────────────────────

  return (
    <div className="space-y-4">

      {/* WO-103: Level 1 — medication search FIRST, with the Favorites /
          Protocols buttons beside it (WO-85 quick actions as panels). */}
      <QuickActionsPanel
        onLoadFavorite={handleLoadFavorite}
        onLoadRecent={handleLoadRecent}
        onNewFavorite={() => searchInputRef.current?.focus()}
      >
        <input
          id="medication-search"
          ref={searchInputRef}
          type="text"
          aria-label="Search medications"
          placeholder="Search medication name..."
          value={selectedIngredient ? selectedIngredient.common_name : searchQuery}
          onChange={e => {
            setSearchQuery(e.target.value)
            if (selectedIngredient) {
              resetDoseStepState(NO_TIMING_DURATION)
              setSelectedIngredient(null)
              setSelectedSaltForm(null)
              setSelectedFormulation(null)
              setSelectedPharmacy(null)
            }
          }}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {!selectedIngredient && searchQuery.length >= 2 && ingredients.length > 0 && (
          <div className="mt-1 max-h-48 overflow-y-auto rounded-md border border-border">
            {ingredients.map(ing => (
              <button
                key={ing.ingredient_id}
                type="button"
                onClick={() => selectIngredient(ing)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 border-b border-border last:border-0"
              >
                <span className="font-medium text-foreground">{ing.common_name}</span>
                {ing.therapeutic_category && (
                  <span className="ml-2 text-xs text-muted-foreground">{ing.therapeutic_category}</span>
                )}
                {ing.dea_schedule && (
                  <span className="ml-1 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
                    DEA {ing.dea_schedule}
                  </span>
                )}
                {ing.fda_alert_status && (
                  <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                    {ing.fda_alert_status}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </QuickActionsPanel>

      {/* FDA Alert */}
      {selectedIngredient?.fda_alert_status && (
        <div className="rounded-lg border-2 border-amber-400 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-800">
            FDA Alert: {selectedIngredient.fda_alert_status}
          </p>
          <p className="mt-1 text-xs text-amber-700">{selectedIngredient.fda_alert_message}</p>
        </div>
      )}

      {/* DEA Schedule Warning */}
      {selectedIngredient?.dea_schedule && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
          <p className="text-xs font-medium text-red-700">
            DEA Schedule {selectedIngredient.dea_schedule} — Controlled substance. EPCS requirements apply at signing.
          </p>
        </div>
      )}

      {/* Level 2: Salt Form (if multiple) */}
      {selectedIngredient && saltForms.length > 1 && (
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Salt / Ester Form
          </label>
          <div className="mt-1 flex flex-wrap gap-2">
            {saltForms.map(sf => (
              <button
                key={sf.salt_form_id}
                type="button"
                onClick={() => selectSaltForm(sf)}
                className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                  selectedSaltForm?.salt_form_id === sf.salt_form_id
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-foreground hover:bg-muted/50'
                }`}
              >
                {sf.salt_name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Level 3: Formulation (concentration + dosage form) */}
      {selectedSaltForm && formulations.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Formulation
          </label>
          <div className="mt-1 space-y-2">
            {formulations.map(f => (
              <button
                key={f.formulation_id}
                type="button"
                onClick={() => selectFormulation(f)}
                className={`w-full text-left rounded-md border px-3 py-2.5 transition-colors ${
                  selectedFormulation?.formulation_id === f.formulation_id
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:bg-muted/50'
                }`}
              >
                <p className="text-sm font-medium text-foreground">{f.name}</p>
                <p className="text-xs text-muted-foreground">
                  {f.dosage_forms?.name} — {f.routes_of_administration?.name}
                  {f.excipient_base && ` — ${f.excipient_base}`}
                  {f.dosage_forms?.is_sterile && ' — Sterile'}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Level 4: Dose + Frequency + Sig Builder (WO-84) */}
      {selectedFormulation && (
        <div ref={doseStepRef} data-testid="dose-step">
        <StructuredSigBuilder
          key={`${selectedFormulation.formulation_id}:${loadNonce}`}
          formulation={selectedFormulation}
          doseAmount={doseAmount}
          doseUnit={doseUnit}
          frequency={selectedFrequency}
          onDoseAmountChange={setDoseAmount}
          onDoseUnitChange={setDoseUnit}
          onFrequencyChange={setSelectedFrequency}
          onSigChange={handleSigChange}
          onDurationDaysChange={setDurationDays}
          onTimingDurationChange={handleTimingDurationChange}
          initialSigText={effectiveInitial?.formulationId === selectedFormulation.formulation_id ? effectiveInitial.sigText : undefined}
          initialStructured={structuredInit}
          presets={doseStepPresets}
          onSigModeChange={setSigMode}
          onTitrationStepsChange={setTitrationSteps}
          initialSigMode={sigMode}
          initialTitrationSteps={titrationSteps}
        />
        </div>
      )}

      {/* Level 5: Pharmacy Selection */}
      {selectedFormulation && pharmacyOptions.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Pharmacy & Pricing
          </label>
          <div className="mt-1 space-y-2">
            {pharmacyOptions.map(po => {
              const suggestion = packageSuggestionFor(po)
              // WO-101a: the suggested package × how many of it.
              const shownPrice = suggestion ? Math.round(suggestion.package.wholesalePrice * 100) * suggestion.count / 100 : po.wholesale_price
              return (
              <button
                key={po.pharmacy_formulation_id}
                type="button"
                onClick={() => {
                  setSelectedPharmacy(po)
                  // Package labels are per pharmacy — re-default.
                  setQuantityPicked(false)
                }}
                className={`w-full text-left rounded-md border px-3 py-2.5 transition-colors ${
                  selectedPharmacy?.pharmacy_formulation_id === po.pharmacy_formulation_id
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:bg-muted/50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">{po.pharmacies?.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {po.pharmacies?.integration_tier?.replace('TIER_', 'Tier ').replace('_', ' ')}
                      {po.estimated_turnaround_days && ` — ~${po.estimated_turnaround_days} days`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-foreground">{toCurrency(shownPrice)}</p>
                    {suggestion && (
                      <p className="text-[10px] text-muted-foreground" data-testid="pharmacy-suggested-package">
                        {formatPackageCount(suggestion.package.label, suggestion.count)}
                      </p>
                    )}
                  </div>
                </div>
                {/* WO-101b: sizes come from the priced packages only. */}
                {po.packages && po.packages.length > 1 ? (
                  <p className="mt-1 text-[10px] text-muted-foreground" data-testid="pharmacy-package-prices">
                    {po.packages.map(p => `${p.label} ${toCurrency(p.wholesalePrice)}`).join(' · ')}
                  </p>
                ) : pharmacySizeLabels(po.packages).length === 1 && (
                  <p className="mt-1 text-[10px] text-muted-foreground" data-testid="pharmacy-sizes">
                    Available: {pharmacySizeLabels(po.packages).join(', ')}
                  </p>
                )}
              </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Quantity + Refills */}
      {selectedPharmacy && (
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {selectedSuggestion ? 'Refills' : 'Quantity & Refills'}
          </label>
          <div className="mt-1 flex gap-3">
            {/* WO-101: priced packages replace the Quantity dropdown — the
                suggested package shows on the pharmacy row and is changed
                on the price step. */}
            {!selectedSuggestion && (
            <div className="flex-1">
              <select
                aria-label="Quantity"
                value={effectiveQuantity}
                onChange={e => {
                  setQuantity(e.target.value)
                  setQuantityPicked(true)
                }}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {quantityOptions.map(q => (
                  <option key={q} value={q}>{q}</option>
                ))}
              </select>
              {!quantityPicked && (
                <p className="mt-1 text-[10px] text-muted-foreground" data-testid="quantity-default-hint">
                  {durationDays != null
                    ? `Smallest package that covers ${durationDays} days — change if needed.`
                    : 'Smallest package listed — change if needed.'}
                </p>
              )}
            </div>
            )}
            <div className="w-24">
              <select
                aria-label="Refills"
                value={refills}
                onChange={e => setRefills(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {[0, 1, 2, 3, 4, 5].map(n => (
                  <option key={n} value={String(n)}>{n} refill{n !== 1 ? 's' : ''}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Actions: Save Favorite + Continue to set retail price */}
      {selectedPharmacy && (
        <div className="flex gap-2">
          <SaveFavoriteButton
            compact
            providerId={session.provider?.provider_id ?? ''}
            formulationId={selectedFormulation?.formulation_id ?? null}
            pharmacyId={selectedPharmacy.pharmacies?.pharmacy_id ?? null}
            medicationName={selectedFormulation?.name ?? ''}
            doseAmount={doseAmount}
            doseUnit={doseUnit}
            frequencyCode={selectedFrequency}
            timingCode={timingDuration.timing}
            duration={presetDurationFromBuilder(timingDuration.duration, timingDuration.customDurationDays)}
            refills={parseInt(refills, 10)}
            patient={session.patient ? { patientId: session.patient.patient_id, name: `${session.patient.first_name} ${session.patient.last_name}` } : null}
            disabled={!canAdd}
          />
          <button
            type="button"
            onClick={navigateToMargin}
            disabled={!canAdd}
            className="flex-1 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Continue — Set Retail Price
          </button>
        </div>
      )}
    </div>
  )
}
