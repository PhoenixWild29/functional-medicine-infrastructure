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
  TITRATION_INTERVALS,
  NCPDP_SIG_LIMIT,
  NCPDP_SIG_WARNING,
  type FormulationSigData,
  type TitrationConfig,
  type CyclingConfig,
} from './structured-sig-builder.types'

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
}

// ── Unit conversion helpers ─────────────────────────────────

function computeDoseDisplay(
  doseAmount: string,
  doseUnit: string,
  formulation: FormulationSigData,
): string {
  const doseNum = parseFloat(doseAmount)
  if (!doseAmount || isNaN(doseNum)) return `${doseAmount} ${doseUnit}`.trim()

  const concVal = formulation.concentration_value
  const concUnit = formulation.concentration_unit
  const isInjectable = formulation.dosage_forms?.name?.includes('Injectable') ?? false
  const isOralSolution = (formulation.dosage_forms?.name?.includes('Solution') ?? false) && !isInjectable

  if (concVal && concUnit === 'mg/mL') {
    if (isInjectable) {
      // Injectable: show 3-way units (mL / mg)
      if (doseUnit === 'mg') {
        const mL = doseNum / concVal
        const units = Math.round(mL * 100)
        return `${units} units (${mL.toFixed(2)}mL / ${doseNum}mg)`
      } else if (doseUnit === 'units') {
        const mL = doseNum / 100
        const mg = mL * concVal
        return `${doseNum} units (${mL.toFixed(2)}mL / ${mg.toFixed(2)}mg)`
      } else if (doseUnit === 'mL') {
        const mg = doseNum * concVal
        const units = Math.round(doseNum * 100)
        return `${units} units (${doseNum}mL / ${mg.toFixed(2)}mg)`
      }
    } else if (isOralSolution) {
      // Oral solution: show 2-way mL (mg) — no syringe units
      if (doseUnit === 'mg') {
        const mL = doseNum / concVal
        return `${mL.toFixed(1)}mL (${doseNum}mg)`
      } else if (doseUnit === 'mL') {
        const mg = doseNum * concVal
        return `${doseNum}mL (${mg.toFixed(2)}mg)`
      }
    }
  }

  // Fallback: plain dose display
  const unitLabel = doseUnit === 'tablet' ? (doseNum === 1 ? 'tablet' : 'tablets')
    : doseUnit === 'capsule' ? (doseNum === 1 ? 'capsule' : 'capsules')
    : doseUnit === 'click' ? (doseNum === 1 ? 'click' : 'clicks')
    : doseUnit
  return `${doseAmount} ${unitLabel}`.trim()
}

function computeTargetDoseDisplay(
  targetDose: string,
  targetUnit: string,
  formulation: FormulationSigData,
): string {
  const num = parseFloat(targetDose)
  if (!targetDose || isNaN(num)) return `${targetDose} ${targetUnit}`.trim()

  const concVal = formulation.concentration_value
  const concUnit = formulation.concentration_unit

  if (concVal && concUnit === 'mg/mL') {
    if (targetUnit === 'mL') {
      const mg = num * concVal
      return `${num}mL (${mg.toFixed(2)}mg)`
    } else if (targetUnit === 'mg') {
      const mL = num / concVal
      return `${mL.toFixed(1)}mL (${num}mg)`
    }
  }

  return `${targetDose} ${targetUnit}`.trim()
}

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
}: StructuredSigBuilderProps) {

  // ── Internal state ──────────────────────────────────────
  const [timing, setTiming] = useState('')
  const [duration, setDuration] = useState('')
  const [customDurationDays, setCustomDurationDays] = useState('')

  // Modes — mutually exclusive
  const [sigMode, setSigMode] = useState<'standard' | 'titration' | 'cycling'>('standard')

  // Titration state
  const [titration, setTitration] = useState<TitrationConfig>({
    startDose: '', startUnit: 'mL',
    increment: '', incrementUnit: 'mL',
    interval: 'Q3-4D', customInterval: '',
    targetDose: '', targetUnit: 'mL',
  })

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

  // ── Generate titration sig ──────────────────────────────
  const titrationSig = useMemo(() => {
    if (sigMode !== 'titration') return ''
    if (!titration.startDose || !titration.increment || !titration.targetDose) return ''

    const route = formulation.routes_of_administration
    const prefix = route?.sig_prefix ?? 'Take'
    const freq = FREQUENCY_OPTIONS.find(f => f.code === frequency)
    const timingOpt = TIMING_OPTIONS.find(t => t.code === effectiveTiming)
    const routeText = route?.name ? route.name.toLowerCase() : ''

    // Start dose display with unit conversion
    const startDisplay = computeDoseDisplay(titration.startDose, titration.startUnit, formulation)
    const targetDisplay = computeTargetDoseDisplay(titration.targetDose, titration.targetUnit, formulation)
    const incrementDisplay = `${titration.increment}${titration.incrementUnit}`

    // Interval text
    const intervalOpt = TITRATION_INTERVALS.find(i => i.code === titration.interval)
    const intervalText = titration.interval === 'CUSTOM' && titration.customInterval
      ? titration.customInterval
      : intervalOpt?.sig ?? ''

    // "Take 0.1mL by mouth every night at bedtime."
    let basePart = `${prefix} ${startDisplay}`
    if (routeText) basePart += ` ${routeText}`
    if (freq?.sig) basePart += ` ${freq.sig}`
    if (timingOpt?.sig) basePart += ` ${timingOpt.sig}`

    // "Titrate up by 0.1mL every 3-4 days as tolerated up to 0.5mL (0.5mg)"
    const titratePart = `Titrate up by ${incrementDisplay} ${intervalText} as tolerated up to ${targetDisplay}`

    return `${basePart}. ${titratePart}`
  }, [sigMode, titration, frequency, effectiveTiming, formulation])

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

  // ── Character count ─────────────────────────────────────
  const charCount = computedSig.length
  const isOverLimit = charCount > NCPDP_SIG_LIMIT
  const isNearLimit = charCount > NCPDP_SIG_WARNING

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

      {/* Row 1: Dose Amount + Unit + Frequency */}
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Amount"
          value={doseAmount}
          onChange={e => onDoseAmountChange(e.target.value)}
          className="w-24 rounded-md border border-input bg-background px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <select
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

      {/* Row 2: Timing + Duration */}
      <div className="flex gap-2">
        <select
          value={timing}
          onChange={e => setTiming(e.target.value)}
          className="flex-1 rounded-md border border-input bg-background px-2 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {TIMING_OPTIONS.map(t => (
            <option key={t.code} value={t.code}>{t.display}</option>
          ))}
        </select>
        <select
          value={duration}
          onChange={e => setDuration(e.target.value)}
          className="flex-1 rounded-md border border-input bg-background px-2 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {DURATION_OPTIONS.map(d => (
            <option key={d.code} value={d.code}>{d.display}</option>
          ))}
        </select>
        {duration === 'CUSTOM' && (
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

      {/* ── Titration Builder ───────────────────────────── */}
      {sigMode === 'titration' && (
        <div className="space-y-3 rounded-md border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-800 dark:bg-amber-950/20">
          <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">
            Titration Schedule — Dose Escalation
          </p>

          {/* Start dose */}
          <div className="flex items-center gap-2">
            <span className="w-20 text-xs text-muted-foreground">Start at</span>
            <input
              type="text"
              placeholder="0.1"
              value={titration.startDose}
              onChange={e => setTitration(t => ({ ...t, startDose: e.target.value }))}
              className="w-20 rounded-md border border-input bg-background px-2 py-1.5 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <select
              value={titration.startUnit}
              onChange={e => setTitration(t => ({ ...t, startUnit: e.target.value }))}
              className="rounded-md border border-input bg-background px-2 py-1.5 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="mL">mL</option>
              <option value="mg">mg</option>
              <option value="units">units</option>
              <option value="tablet">tablet(s)</option>
              <option value="capsule">capsule(s)</option>
            </select>
          </div>

          {/* Increment */}
          <div className="flex items-center gap-2">
            <span className="w-20 text-xs text-muted-foreground">Increase by</span>
            <input
              type="text"
              placeholder="0.1"
              value={titration.increment}
              onChange={e => setTitration(t => ({ ...t, increment: e.target.value }))}
              className="w-20 rounded-md border border-input bg-background px-2 py-1.5 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <select
              value={titration.incrementUnit}
              onChange={e => setTitration(t => ({ ...t, incrementUnit: e.target.value }))}
              className="rounded-md border border-input bg-background px-2 py-1.5 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="mL">mL</option>
              <option value="mg">mg</option>
              <option value="units">units</option>
              <option value="tablet">tablet(s)</option>
            </select>
          </div>

          {/* Interval */}
          <div className="flex items-center gap-2">
            <span className="w-20 text-xs text-muted-foreground">Every</span>
            <select
              value={titration.interval}
              onChange={e => setTitration(t => ({ ...t, interval: e.target.value }))}
              className="flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {TITRATION_INTERVALS.map(i => (
                <option key={i.code} value={i.code}>{i.display}</option>
              ))}
            </select>
            {titration.interval === 'CUSTOM' && (
              <input
                type="text"
                placeholder="e.g. every 5 days"
                value={titration.customInterval}
                onChange={e => setTitration(t => ({ ...t, customInterval: e.target.value }))}
                className="flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            )}
          </div>

          {/* Target dose */}
          <div className="flex items-center gap-2">
            <span className="w-20 text-xs text-muted-foreground">Up to</span>
            <input
              type="text"
              placeholder="0.5"
              value={titration.targetDose}
              onChange={e => setTitration(t => ({ ...t, targetDose: e.target.value }))}
              className="w-20 rounded-md border border-input bg-background px-2 py-1.5 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <select
              value={titration.targetUnit}
              onChange={e => setTitration(t => ({ ...t, targetUnit: e.target.value }))}
              className="rounded-md border border-input bg-background px-2 py-1.5 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="mL">mL</option>
              <option value="mg">mg</option>
              <option value="units">units</option>
            </select>
            <span className="text-xs text-muted-foreground">as tolerated</span>
          </div>
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
