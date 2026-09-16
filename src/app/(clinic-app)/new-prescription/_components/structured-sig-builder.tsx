'use client'

// ============================================================
// WO-84: Structured Sig Builder + Titration Schedule Engine
// ============================================================
//
// Sub-component of CascadingPrescriptionBuilder. Manages:
// - Standard sig generation from dropdowns (dose, frequency, timing, duration)
// - Titration mode: multi-step dose escalation with start/increment/target
// - Cycling mode: on/off day schedules with cycle duration
// - Unit auto-conversion: mg ↔ mL ↔ syringe units (injectables) and mg ↔ mL (oral solutions)
// - Free text override with structured data preservation
// - NCPDP 1,000-character limit enforcement
//
// The parent owns dose/frequency/unit state (needed for canAdd + URL params).
// This component owns timing, duration, titration, cycling, and sig override state.

import { useState, useEffect, useMemo } from 'react'
import {
  FREQUENCY_OPTIONS,
  TIMING_OPTIONS,
  DURATION_OPTIONS,
  NCPDP_SIG_LIMIT,
  NCPDP_SIG_WARNING,
  type FormulationSigData,
  type CyclingConfig,
} from './structured-sig-builder.types'
import { computeDoseDisplay } from '@/lib/orders/dose-display'
import { timingAndDurationFromSig, type SigTimingAndDuration } from '../_lib/sig-recovery'
import { builderDurationFromPreset, presetChipText, type DosePreset } from '@/lib/orders/favorite-presets'
import {
  computeTitrationDispense,
  validateTitrationSteps,
  stepWeekLabel,
  titrationSigSummary,
  MAX_TITRATION_STEPS,
  type TitrationStep,
  type SigMode,
} from '@/lib/orders/titration'

// ── Props ───────────────────────────────────────────────────

interface StructuredSigBuilderProps {
  formulation: FormulationSigData
  doseAmount: string
  doseUnit: string
  frequency: string
  onDoseAmountChange: (val: string) => void
  onDoseUnitChange: (val: string) => void
  onFrequencyChange: (val: string) => void
  onSigChange: (sigText: string) => void
  /**
   * WO-101: the selected duration in days ("For 30 days" / Custom → the
   * number), or null for no duration, "Ongoing", titration and cycling.
   * A structured value, so the parent never has to read it back out of
   * the sig text.
   */
  onDurationDaysChange?: (days: number | null) => void
  /**
   * WO-98 edit-at-review: the sig the line currently carries. Used only
   * to seed timing + duration (which are not part of the line's
   * structured inputs) so re-editing a dose regenerates a sig with the
   * same "in the morning for 30 days" tail. Dose + frequency come from
   * the controlled props. The parent passes it only while the dose step
   * shows that line's own formulation and nothing else has been loaded,
   * so it never seeds a different medication.
   */
  initialSigText?: string | undefined
  /**
   * WO-104: timing + duration as structured values — a favorite's dose
   * preset or the Custom chip. When set, `initialSigText` is ignored and
   * no sig is parsed.
   */
  initialStructured?: SigTimingAndDuration | null | undefined
  /** WO-104: timing + duration as selected, for ☆ Save as favorite. */
  onTimingDurationChange?: (value: SigTimingAndDuration) => void
  /**
   * WO-104: the clinic's common doses for this formulation (from its
   * favorites). Shown as chips above the dose fields; a click fills
   * amount, unit, frequency, timing and duration. Free entry stays.
   */
  presets?: ReadonlyArray<DosePreset> | undefined
  /**
   * WO-105: the titration steps and the mode, as structured values. The
   * parent stores them on the order (orders.sig_mode /
   * orders.titration_steps) and carries them to the price step, so a
   * titration is never recovered by reading its sig text.
   */
  onSigModeChange?: (mode: SigMode) => void
  onTitrationStepsChange?: (steps: TitrationStep[]) => void
  /** WO-105: steps to open with — a titration favorite, or a reopened line. */
  initialTitrationSteps?: ReadonlyArray<TitrationStep> | null | undefined
  initialSigMode?: SigMode | null | undefined
}

// WO-104: moved to _lib/sig-recovery.ts (WO-98 edit path only); re-exported
// for existing imports.
export { timingAndDurationFromSig } from '../_lib/sig-recovery'

// ── Unit conversion helpers ─────────────────────────────────
// WO-103: computeDoseDisplay moved to the shared pure lib so the
// margin page, Review card and Favorites panel use the same arithmetic.

// ── Component ───────────────────────────────────────────────

export function StructuredSigBuilder({
  formulation,
  doseAmount,
  doseUnit,
  frequency,
  onDoseAmountChange,
  onDoseUnitChange,
  onFrequencyChange,
  onSigChange,
  onDurationDaysChange,
  initialSigText,
  initialStructured,
  onTimingDurationChange,
  presets,
  onSigModeChange,
  onTitrationStepsChange,
  initialTitrationSteps,
  initialSigMode,
}: StructuredSigBuilderProps) {

  // ── Internal state ──────────────────────────────────────
  // WO-104: structured values win; the sig is parsed only for a WO-98
  // reopened line that has no structured timing / duration.
  const [initial] = useState(() => initialStructured ?? timingAndDurationFromSig(initialSigText))
  const [timing, setTiming] = useState(initial.timing)
  const [duration, setDuration] = useState(initial.duration)
  const [customDurationDays, setCustomDurationDays] = useState(initial.customDurationDays)

  // Modes — mutually exclusive
  const [sigMode, setSigMode] = useState<'standard' | 'titration' | 'cycling'>(
    initialSigMode === 'titration' || initialSigMode === 'cycling' ? initialSigMode : 'standard',
  )

  // WO-105: titration state is the step list itself — "a different box
  // for like each next step" (Gina Rooks, 2026-09-11). What it replaced
  // (start / increment / interval / target) could only ever produce the
  // free-text sentence pharmacies push back on.
  const [steps, setSteps] = useState<TitrationStep[]>(() =>
    initialTitrationSteps && initialTitrationSteps.length > 0
      ? initialTitrationSteps.map(s => ({ ...s }))
      : [{ dose: '', unit: doseUnit || 'mL', frequency: frequency || 'QW', weeks: 4 }],
  )

  // Cycling state
  const [cycling, setCycling] = useState<CyclingConfig>({
    onDays: '5', offDays: '2',
    cycleDuration: '6', cycleDurationUnit: 'weeks',
    restPeriod: '',
  })

  // Free text override
  const [sigOverride, setSigOverride] = useState('')
  const [isManualEdit, setIsManualEdit] = useState(false)

  // ── Suppress duplicate timing when QHS selected ─────────
  // QHS already means "at bedtime" — don't append "at bedtime" again
  const effectiveTiming = useMemo(() => {
    if (frequency === 'QHS' && timing === 'BEDTIME') return ''
    return timing
  }, [frequency, timing])

  // ── Generate standard sig ───────────────────────────────
  const generatedSig = useMemo(() => {
    if (!doseAmount || !frequency) return ''

    const route = formulation.routes_of_administration
    const freq = FREQUENCY_OPTIONS.find(f => f.code === frequency)
    const timingOpt = TIMING_OPTIONS.find(t => t.code === effectiveTiming)
    const prefix = route?.sig_prefix ?? 'Take'
    const doseDisplay = computeDoseDisplay(doseAmount, doseUnit, formulation)
    const routeText = route?.name ? route.name.toLowerCase() : ''
    const sigRoute = routeText ? ` ${routeText}` : ''

    // Build base: "Inject 10 units (0.10mL / 0.50mg) subcutaneously once weekly"
    let sig = `${prefix} ${doseDisplay}${sigRoute} ${freq?.sig ?? frequency}`.trim()

    // Append timing: "at bedtime"
    if (timingOpt?.sig) {
      sig += ` ${timingOpt.sig}`
    }

    // Append duration: "for 30 days"
    if (duration === 'CUSTOM' && customDurationDays) {
      sig += ` for ${customDurationDays} days`
    } else if (duration === 'ONGOING') {
      sig += ', ongoing'
    } else if (duration) {
      const durOpt = DURATION_OPTIONS.find(d => d.code === duration)
      if (durOpt?.sig) sig += ` ${durOpt.sig}`
    }

    return sig
  }, [doseAmount, doseUnit, frequency, effectiveTiming, duration, customDurationDays, formulation])

  // ── WO-105: titration steps → derived numbers + sig ─────
  // Everything shown about a titration is computed from the steps and
  // read-only (phase rule 3). The sig sentence is generated FROM the
  // steps so the fax still reads as a sentence; the steps themselves
  // travel to the pharmacy as fields.
  const titrationFormulation = useMemo(() => ({
    concentrationValue: formulation.concentration_value,
    concentrationUnit:  formulation.concentration_unit,
    dosageFormName:     formulation.dosage_forms?.name ?? null,
  }), [formulation])

  const titrationDerived = useMemo(
    () => (sigMode === 'titration' ? computeTitrationDispense(steps, titrationFormulation) : null),
    [sigMode, steps, titrationFormulation],
  )

  // Only complain once the provider has filled a step in — an empty new
  // step is not an error, it is an empty field.
  const titrationProblem = useMemo(() => {
    if (sigMode !== 'titration') return null
    if (steps.every(st => !st.dose)) return null
    const v = validateTitrationSteps(steps, titrationFormulation)
    return v.ok ? null : v
  }, [sigMode, steps, titrationFormulation])

  const titrationSig = useMemo(() => {
    if (sigMode !== 'titration') return ''
    if (titrationProblem) return ''
    const route = formulation.routes_of_administration
    const timingOpt = TIMING_OPTIONS.find(t => t.code === effectiveTiming)
    return titrationSigSummary(steps, titrationFormulation, {
      prefix:    route?.sig_prefix ?? 'Take',
      routeName: route?.name ?? null,
      timingSig: timingOpt?.sig ?? null,
    })
  }, [sigMode, steps, titrationProblem, titrationFormulation, formulation, effectiveTiming])

  // ── Generate cycling sig ────────────────────────────────
  const cyclingSig = useMemo(() => {
    if (sigMode !== 'cycling') return ''
    if (!doseAmount || !cycling.onDays || !cycling.offDays) return ''

    const route = formulation.routes_of_administration
    const prefix = route?.sig_prefix ?? 'Take'
    const doseDisplay = computeDoseDisplay(doseAmount, doseUnit, formulation)
    const routeText = route?.name ? route.name.toLowerCase() : ''
    const sigRoute = routeText ? ` ${routeText}` : ''
    const freq = FREQUENCY_OPTIONS.find(f => f.code === frequency)

    // "Inject 1.0mg (0.33mL) subcutaneously daily, 5 days on / 2 days off"
    let sig = `${prefix} ${doseDisplay}${sigRoute} ${freq?.sig ?? 'daily'}, ${cycling.onDays} days on / ${cycling.offDays} days off`

    // Duration: "for 6 weeks then reassess"
    if (cycling.cycleDuration) {
      sig += `, for ${cycling.cycleDuration} ${cycling.cycleDurationUnit} then reassess`
    }

    // Rest period: "Rest 2-4 weeks between cycles"
    if (cycling.restPeriod) {
      sig += `. Rest ${cycling.restPeriod} between cycles`
    }

    return sig
  }, [sigMode, doseAmount, doseUnit, frequency, cycling, formulation])

  // ── Final sig text ──────────────────────────────────────
  const computedSig = useMemo(() => {
    if (isManualEdit && sigOverride) return sigOverride
    if (sigMode === 'titration') return titrationSig
    if (sigMode === 'cycling') return cyclingSig
    return generatedSig
  }, [isManualEdit, sigOverride, sigMode, generatedSig, titrationSig, cyclingSig])

  // ── Propagate sig to parent ─────────────────────────────
  useEffect(() => {
    onSigChange(computedSig)
  }, [computedSig, onSigChange])

  // ── WO-101: propagate the structured duration ───────────
  const durationDays = useMemo(() => {
    if (sigMode !== 'standard') return null
    const days = parseInt(duration === 'CUSTOM' ? customDurationDays : duration, 10)
    return Number.isFinite(days) && days > 0 ? days : null
  }, [sigMode, duration, customDurationDays])
  useEffect(() => {
    onDurationDaysChange?.(durationDays)
  }, [durationDays, onDurationDaysChange])
  useEffect(() => {
    onTimingDurationChange?.({ timing, duration, customDurationDays })
  }, [timing, duration, customDurationDays, onTimingDurationChange])

  // WO-105: the mode and the steps are structured values the parent
  // stores on the order. Steps are sent only for a titration whose steps
  // are valid — an order must never carry a schedule the app refused to
  // price. Cycling sends none, and nothing here changes for it.
  useEffect(() => {
    onSigModeChange?.(sigMode)
  }, [sigMode, onSigModeChange])
  useEffect(() => {
    onTitrationStepsChange?.(
      sigMode === 'titration' && !titrationProblem && titrationDerived ? steps.map(st => ({ ...st })) : [],
    )
  }, [sigMode, steps, titrationProblem, titrationDerived, onTitrationStepsChange])

  // ── WO-104: common-dose chip ────────────────────────────
  function applyPreset(p: DosePreset) {
    const d = builderDurationFromPreset(p.duration)
    handleModeChange('standard')
    onDoseAmountChange(p.dose)
    onDoseUnitChange(p.unit)
    onFrequencyChange(p.frequency)
    setTiming(p.timing)
    setDuration(d.duration)
    setCustomDurationDays(d.customDurationDays)
  }

  // ── Character count ─────────────────────────────────────
  const charCount = computedSig.length
  const isOverLimit = charCount > NCPDP_SIG_LIMIT
  const isNearLimit = charCount > NCPDP_SIG_WARNING

  // ── WO-105: step table mutators ─────────────────────────
  function updateStep(index: number, patch: Partial<TitrationStep>) {
    setSteps(list => list.map((st, i) => (i === index ? { ...st, ...patch } : st)))
  }
  function addStep() {
    setSteps(list => {
      if (list.length >= MAX_TITRATION_STEPS) return list
      const last = list[list.length - 1]
      // A new step continues the schedule: same unit and frequency, same
      // length, empty dose — the dose is the only thing that changes.
      return [...list, { dose: '', unit: last?.unit ?? doseUnit ?? 'mL', frequency: last?.frequency ?? frequency ?? 'QW', weeks: last?.weeks ?? 4 }]
    })
  }
  function removeStep(index: number) {
    setSteps(list => (list.length <= 1 ? list : list.filter((_, i) => i !== index)))
  }

  // ── Mode toggle handler ─────────────────────────────────
  function handleModeChange(mode: 'standard' | 'titration' | 'cycling') {
    setSigMode(mode)
    setIsManualEdit(false)
    setSigOverride('')
  }

  // ── Render ──────────────────────────────────────────────

  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm space-y-4">
      <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Dose & Directions
      </label>

      {/* WO-104: the clinic's common doses for this formulation */}
      {presets && presets.length > 0 && (
        <div data-testid="dose-step-presets">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Common doses</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {presets.map(p => {
              const text = presetChipText(p, formulation)
              return (
                <button
                  key={[p.dose, p.unit, p.frequency, p.timing, p.duration].join('|')}
                  type="button"
                  onClick={() => applyPreset(p)}
                  title={p.label ?? undefined}
                  className="rounded-full border border-primary/40 bg-background px-2.5 py-1 text-xs text-primary hover:bg-primary/5"
                >
                  <span className="font-medium">{text.primary}</span>
                  {text.secondary && <span className="text-muted-foreground">{' '}{text.secondary}</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Row 1: Dose Amount + Unit + Frequency.
          WO-105: a titration has no single dose — its steps each carry
          their own dose and frequency, and two dose fields on one screen
          is how the money math and the sig came to disagree. */}
      {sigMode !== 'titration' && (
      <div className="flex gap-2">
        <input
          type="text"
          aria-label="Dose amount"
          placeholder="Amount"
          value={doseAmount}
          onChange={e => onDoseAmountChange(e.target.value)}
          className="w-24 rounded-md border border-input bg-background px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <select
          aria-label="Dose unit"
          value={doseUnit}
          onChange={e => onDoseUnitChange(e.target.value)}
          className="rounded-md border border-input bg-background px-2 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">Unit</option>
          <option value="mg">mg</option>
          <option value="mL">mL</option>
          <option value="units">units</option>
          <option value="mcg">mcg</option>
          <option value="tablet">tablet(s)</option>
          <option value="capsule">capsule(s)</option>
          <option value="click">click(s)</option>
        </select>
        <select
          aria-label="Frequency"
          value={frequency}
          onChange={e => onFrequencyChange(e.target.value)}
          className="flex-1 rounded-md border border-input bg-background px-2 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">Select frequency</option>
          {FREQUENCY_OPTIONS.map(f => (
            <option key={f.code} value={f.code}>{f.display}</option>
          ))}
        </select>
      </div>

      )}

      {/* Row 2: Timing + Duration */}
      <div className="flex gap-2">
        <select
          aria-label="Timing"
          value={timing}
          onChange={e => setTiming(e.target.value)}
          className="flex-1 rounded-md border border-input bg-background px-2 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {TIMING_OPTIONS.map(t => (
            <option key={t.code} value={t.code}>{t.display}</option>
          ))}
        </select>
        {sigMode !== 'titration' && (
        <select
          aria-label="Duration"
          value={duration}
          onChange={e => setDuration(e.target.value)}
          className="flex-1 rounded-md border border-input bg-background px-2 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {DURATION_OPTIONS.map(d => (
            <option key={d.code} value={d.code}>{d.display}</option>
          ))}
        </select>
        )}
        {sigMode !== 'titration' && duration === 'CUSTOM' && (
          <input
            type="number"
            placeholder="Days"
            min={1}
            value={customDurationDays}
            onChange={e => setCustomDurationDays(e.target.value)}
            className="w-20 rounded-md border border-input bg-background px-2 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        )}
      </div>

      {/* Mode toggles: Standard / Titration / Cycling */}
      <div className="flex gap-1.5">
        {(['standard', 'titration', 'cycling'] as const).map(mode => (
          <button
            key={mode}
            type="button"
            onClick={() => handleModeChange(mode)}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
              sigMode === mode
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:bg-muted/50'
            }`}
          >
            {mode === 'standard' ? 'Standard' : mode === 'titration' ? 'Titration' : 'Cycling'}
          </button>
        ))}
      </div>

      {/* ── WO-105: Titration step table ────────────────── */}
      {sigMode === 'titration' && (
        <div
          data-testid="titration-builder"
          className="space-y-3 rounded-md border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-800 dark:bg-amber-950/20"
        >
          <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">
            Titration schedule — one step per dose change
          </p>

          <div className="space-y-2">
            {steps.map((step, i) => (
              <div key={i} data-testid={`titration-step-${i}`} className="flex flex-wrap items-center gap-2">
                <span className="w-16 text-xs text-muted-foreground">
                  {stepWeekLabel({
                    weekFrom: steps.slice(0, i).reduce((w, st) => w + (st.weeks || 0), 1),
                    weekTo:   steps.slice(0, i).reduce((w, st) => w + (st.weeks || 0), 1) + (step.weeks || 1) - 1,
                  })}
                </span>
                <input
                  type="text"
                  aria-label={`Step ${i + 1} dose`}
                  placeholder="10"
                  value={step.dose}
                  onChange={e => updateStep(i, { dose: e.target.value })}
                  className="w-20 rounded-md border border-input bg-background px-2 py-1.5 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <select
                  aria-label={`Step ${i + 1} unit`}
                  value={step.unit}
                  onChange={e => updateStep(i, { unit: e.target.value })}
                  className="rounded-md border border-input bg-background px-2 py-1.5 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="mg">mg</option>
                  <option value="mL">mL</option>
                  <option value="units">units</option>
                  <option value="mcg">mcg</option>
                  <option value="tablet">tablet(s)</option>
                  <option value="capsule">capsule(s)</option>
                </select>
                <select
                  aria-label={`Step ${i + 1} frequency`}
                  value={step.frequency}
                  onChange={e => updateStep(i, { frequency: e.target.value })}
                  className="flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {FREQUENCY_OPTIONS.map(f => (
                    <option key={f.code} value={f.code}>{f.display}</option>
                  ))}
                </select>
                <input
                  type="number"
                  min={1}
                  aria-label={`Step ${i + 1} weeks`}
                  value={step.weeks}
                  onChange={e => updateStep(i, { weeks: parseInt(e.target.value, 10) || 0 })}
                  className="w-16 rounded-md border border-input bg-background px-2 py-1.5 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <span className="text-xs text-muted-foreground">weeks</span>
                <span data-testid={`titration-step-${i}-quantity`} className="w-24 text-right text-xs tabular-nums text-muted-foreground">
                  {titrationDerived?.steps[i]?.quantity != null
                    ? `${titrationDerived.steps[i]!.quantity} ${titrationDerived.dispenseUnit}`
                    : '—'}
                </span>
                {steps.length > 1 && (
                  <button
                    type="button"
                    aria-label={`Remove step ${i + 1}`}
                    onClick={() => removeStep(i)}
                    className="rounded border border-border px-2 py-1 text-[10px] hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>

          {steps.length < MAX_TITRATION_STEPS && (
            <button
              type="button"
              data-testid="titration-add-step"
              onClick={addStep}
              className="rounded-full border border-amber-400 px-3 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-amber-200 dark:hover:bg-amber-900/40"
            >
              + Add step
            </button>
          )}

          {/* Derived, never typed (phase rule 3). */}
          {titrationDerived && !titrationProblem && (
            <p data-testid="titration-total" className="text-xs font-medium text-amber-900 dark:text-amber-200">
              Total {titrationDerived.totalQuantity} {titrationDerived.dispenseUnit} over {titrationDerived.totalDays} days
            </p>
          )}

          {titrationProblem?.message && (
            <p data-testid="titration-problem" role="alert" className="text-xs font-medium text-red-700 dark:text-red-400">
              {titrationProblem.message}
            </p>
          )}
        </div>
      )}

      {/* ── Cycling Builder ─────────────────────────────── */}
      {sigMode === 'cycling' && (
        <div className="space-y-3 rounded-md border border-blue-200 bg-blue-50/50 p-3 dark:border-blue-800 dark:bg-blue-950/20">
          <p className="text-xs font-semibold text-blue-800 dark:text-blue-200">
            Cycling Schedule — On/Off Pattern
          </p>

          {/* On/Off days */}
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              placeholder="5"
              value={cycling.onDays}
              onChange={e => setCycling(c => ({ ...c, onDays: e.target.value }))}
              className="w-16 rounded-md border border-input bg-background px-2 py-1.5 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <span className="text-xs text-muted-foreground">days on /</span>
            <input
              type="number"
              min={1}
              placeholder="2"
              value={cycling.offDays}
              onChange={e => setCycling(c => ({ ...c, offDays: e.target.value }))}
              className="w-16 rounded-md border border-input bg-background px-2 py-1.5 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <span className="text-xs text-muted-foreground">days off</span>
          </div>

          {/* Cycle duration */}
          <div className="flex items-center gap-2">
            <span className="w-20 text-xs text-muted-foreground">Cycle for</span>
            <input
              type="number"
              min={1}
              placeholder="6"
              value={cycling.cycleDuration}
              onChange={e => setCycling(c => ({ ...c, cycleDuration: e.target.value }))}
              className="w-16 rounded-md border border-input bg-background px-2 py-1.5 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <select
              value={cycling.cycleDurationUnit}
              onChange={e => setCycling(c => ({ ...c, cycleDurationUnit: e.target.value }))}
              className="rounded-md border border-input bg-background px-2 py-1.5 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="days">days</option>
              <option value="weeks">weeks</option>
              <option value="months">months</option>
            </select>
            <span className="text-xs text-muted-foreground">then reassess</span>
          </div>

          {/* Rest period (optional) */}
          <div className="flex items-center gap-2">
            <span className="w-20 text-xs text-muted-foreground">Rest period</span>
            <input
              type="text"
              placeholder="e.g. 2-4 weeks"
              value={cycling.restPeriod}
              onChange={e => setCycling(c => ({ ...c, restPeriod: e.target.value }))}
              className="flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>
      )}

      {/* ── Sig Preview / Free Text Override ────────────── */}
      {computedSig && (
        <div className="rounded-md border border-border bg-muted/30 p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Sig (Directions)
            </p>
            <button
              type="button"
              onClick={() => {
                if (isManualEdit) {
                  // Switching back to auto — clear override
                  setSigOverride('')
                  setIsManualEdit(false)
                } else {
                  // Switching to manual — seed with current sig
                  setSigOverride(computedSig)
                  setIsManualEdit(true)
                }
              }}
              className="text-[10px] text-primary underline"
            >
              {isManualEdit ? 'Use auto-generated' : 'Edit manually'}
            </button>
          </div>
          {isManualEdit ? (
            <textarea
              value={sigOverride}
              onChange={e => setSigOverride(e.target.value)}
              rows={3}
              maxLength={NCPDP_SIG_LIMIT}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          ) : (
            <p className="mt-1 text-sm text-foreground italic">&ldquo;{computedSig}&rdquo;</p>
          )}

          {/* Character counter + NCPDP limit */}
          <div className="mt-1 flex items-center justify-between">
            <span className={`text-[10px] ${
              isOverLimit ? 'font-semibold text-red-600' :
              isNearLimit ? 'text-amber-600' :
              'text-muted-foreground'
            }`}>
              {charCount} / {NCPDP_SIG_LIMIT} characters
              {isOverLimit && ' — exceeds NCPDP limit'}
              {!isOverLimit && isNearLimit && ' — approaching limit'}
            </span>
            {sigMode !== 'standard' && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                {sigMode === 'titration' ? 'Titration' : 'Cycling'}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
