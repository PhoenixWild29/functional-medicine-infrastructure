'use client'

// ============================================================
// WO-96: Rx details row (Review card)
// ============================================================
//
// One collapsed row per prescription on the Review page. Expanding it
// shows every per-Rx detail field pre-filled: refills (0), substitution
// (allowed), syringe option and shipping (from the formulation),
// clinical difference (pre-selected when required), diagnosis and
// special instructions (optional).
//
// The row starts expanded ONLY when a rule requires confirmation —
// controlled substance → diagnosis, requires_clinical_difference →
// statement — and focuses the field in question. A prescription with
// neither rule (e.g. BPC-157) sends with zero interaction here.
//
// Phase 21 rule 1: this is a row on the existing Review card, not a
// step. Rule 5: copy says "provider", never "doctor".

import { useEffect, useId, useRef, useState } from 'react'
import {
  formatDispenseWithPackage,
  MAX_REFILLS,
  rxDetailsNeedConfirmation,
  SHIPPING_TYPES,
  shippingTypeLabel,
  SYRINGE_OPTIONS,
  syringeOptionLabel,
  type MissingRxDetail,
  type RxDetails,
  type RxRules,
  type ShippingType,
  type SyringeOption,
} from '@/lib/orders/rx-details'
import { dosingDaysIn, type CyclePattern } from '@/lib/orders/cycling'

interface Props {
  /** Stable per-line id — used for input ids and test hooks. */
  lineId:    string
  details:   RxDetails
  rules:     RxRules
  missing:   MissingRxDetail[]
  disabled:  boolean
  onChange:  (patch: Partial<RxDetails>) => void
  /** WO-101a: the package the line is filled from and how many — shown with the dispense total. */
  packageLabel?: string | null
  packageCount?: number | null
  /** Cycling dose math: the line's on/off pattern — its dosing days are shown with the days supply. */
  cycle?: CyclePattern | null
}

const OTHER = '__other__'

function summaryLine(d: RxDetails, rules: RxRules, packageLabel: string | null | undefined, packageCount: number | null | undefined): string {
  const parts: string[] = []
  const dispense = formatDispenseWithPackage(d.dispenseQuantity, d.dispenseUnit, packageLabel, packageCount)
  if (d.daysSupply != null) parts.push(`${d.daysSupply}-day supply`)
  if (dispense) parts.push(`dispense ${dispense}`)
  parts.push(`${d.refills} refill${d.refills === 1 ? '' : 's'}`)
  parts.push(d.substitutionAllowed ? 'substitution OK' : 'DAW')
  if (d.syringeOption !== 'none') parts.push(syringeOptionLabel(d.syringeOption))
  parts.push(shippingTypeLabel(d.shippingType).replace(' (refrigerated)', ''))
  if (rules.requiresClinicalDifference) parts.push(d.clinicalDifference ? 'clinical difference set' : 'clinical difference needed')
  if (rules.isControlled) parts.push(d.diagnosisCode || d.diagnosisText ? 'diagnosis set' : 'diagnosis needed')
  return parts.join(' · ')
}

export function RxDetailsRow({ lineId, details, rules, missing, disabled, onChange, packageLabel = null, packageCount = null, cycle = null }: Props) {
  // Auto-expand only when a rule requires confirmation.
  const [open, setOpen] = useState<boolean>(() => rxDetailsNeedConfirmation(rules))
  const diagnosisRef = useRef<HTMLInputElement>(null)
  const clinicalRef = useRef<HTMLSelectElement>(null)
  const ids = {
    refills:      useId(),
    substitution: useId(),
    syringe:      useId(),
    shipping:     useId(),
    clinical:     useId(),
    clinicalText: useId(),
    dxCode:       useId(),
    dxText:       useId(),
    special:      useId(),
  }

  // Rules can arrive after mount (lines resolved from /api/formulations
  // level=rx_defaults) — open the row once we learn confirmation is needed.
  const needsConfirmation = rxDetailsNeedConfirmation(rules)
  useEffect(() => {
    if (needsConfirmation) setOpen(true)
  }, [needsConfirmation])

  // Focus the first rule-required empty field when the row opens for it.
  useEffect(() => {
    if (!open) return
    if (missing.includes('diagnosis')) diagnosisRef.current?.focus()
    else if (missing.includes('clinical_difference')) clinicalRef.current?.focus()
    // Only on open/rule change — not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, needsConfirmation])

  const options = rules.clinicalDifferenceOptions
  const clinicalIsPicklist = details.clinicalDifference != null && options.includes(details.clinicalDifference)
  const [clinicalOther, setClinicalOther] = useState<boolean>(
    () => details.clinicalDifference != null && details.clinicalDifference !== '' && !options.includes(details.clinicalDifference),
  )

  const missingDiagnosis = missing.includes('diagnosis')
  const missingClinical = missing.includes('clinical_difference')

  return (
    <div
      className={`mt-3 rounded-md border ${missing.length > 0 ? 'border-amber-300 bg-amber-50/40' : 'border-border bg-muted/20'}`}
      data-testid={`rx-details-${lineId}`}
      data-expanded={open ? 'true' : 'false'}
    >
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-controls={`rx-details-panel-${lineId}`}
        className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left"
      >
        <span>
          <span className="text-xs font-semibold text-foreground">Rx details</span>
          <span className="ml-2 text-[11px] text-muted-foreground">{summaryLine(details, rules, packageLabel, packageCount)}</span>
          {/* Cycling dose math: what the dispense was counted over (rule 3). */}
          {cycle && details.daysSupply != null && (
            <span className="ml-1 text-[11px] font-medium text-foreground" data-testid={`rx-dosing-days-${lineId}`}>
              · {dosingDaysIn(details.daysSupply, cycle)} dosing days ({cycle.onDays} on / {cycle.offDays} off)
            </span>
          )}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div id={`rx-details-panel-${lineId}`} className="space-y-3 border-t border-border/60 px-3 pb-3 pt-2">
          {missing.length > 0 && (
            <p className="text-[11px] font-medium text-amber-800" role="alert">
              {missingDiagnosis && 'A diagnosis is required for a controlled substance. '}
              {missingClinical && 'A clinical difference statement is required for this medication. '}
              Confirm below to enable sending.
            </p>
          )}

          {/* Derived (read-only here; overridden on the margin page) */}
          <div className="grid grid-cols-2 gap-x-4 text-[11px] text-muted-foreground">
            <span>Days supply: <strong className="text-foreground">{details.daysSupply != null ? `${details.daysSupply} days` : '—'}</strong></span>
            <span>Dispense: <strong className="text-foreground" data-testid={`rx-dispense-${lineId}`}>{formatDispenseWithPackage(details.dispenseQuantity, details.dispenseUnit, packageLabel, packageCount) ?? '—'}</strong></span>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label htmlFor={ids.refills} className="block text-[11px] text-muted-foreground">Refills</label>
              <select
                id={ids.refills}
                value={details.refills}
                disabled={disabled}
                onChange={e => onChange({ refills: parseInt(e.target.value, 10) })}
                className="mt-0.5 w-full rounded-md border border-input bg-background px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                {Array.from({ length: MAX_REFILLS + 1 }, (_, n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>

            <div>
              <span className="block text-[11px] text-muted-foreground">Substitution</span>
              <label htmlFor={ids.substitution} className="mt-1.5 flex items-center gap-2 text-sm text-foreground">
                <input
                  id={ids.substitution}
                  type="checkbox"
                  checked={details.substitutionAllowed}
                  disabled={disabled}
                  onChange={e => onChange({ substitutionAllowed: e.target.checked })}
                  className="rounded border-input"
                />
                <span>{details.substitutionAllowed ? 'Allowed' : 'Dispense as written'}</span>
              </label>
            </div>

            <div>
              <label htmlFor={ids.syringe} className="block text-[11px] text-muted-foreground">Syringe option</label>
              <select
                id={ids.syringe}
                value={details.syringeOption}
                disabled={disabled}
                onChange={e => onChange({ syringeOption: e.target.value as SyringeOption })}
                className="mt-0.5 w-full rounded-md border border-input bg-background px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                {SYRINGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            <div>
              <label htmlFor={ids.shipping} className="block text-[11px] text-muted-foreground">Shipping</label>
              <select
                id={ids.shipping}
                value={details.shippingType}
                disabled={disabled}
                onChange={e => onChange({ shippingType: e.target.value as ShippingType })}
                className="mt-0.5 w-full rounded-md border border-input bg-background px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                {SHIPPING_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          {/* Clinical difference — picklist when the formulation offers one, free text otherwise */}
          <div>
            <label htmlFor={ids.clinical} className="block text-[11px] text-muted-foreground">
              Clinical difference{rules.requiresClinicalDifference ? ' (required)' : ' (optional)'}
            </label>
            {options.length > 0 ? (
              <>
                <select
                  id={ids.clinical}
                  ref={clinicalRef}
                  value={clinicalOther ? OTHER : (clinicalIsPicklist ? details.clinicalDifference ?? '' : '')}
                  disabled={disabled}
                  aria-invalid={missingClinical ? 'true' : undefined}
                  onChange={e => {
                    if (e.target.value === OTHER) {
                      setClinicalOther(true)
                      onChange({ clinicalDifference: null })
                    } else {
                      setClinicalOther(false)
                      onChange({ clinicalDifference: e.target.value || null })
                    }
                  }}
                  className={`mt-0.5 w-full rounded-md border bg-background px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${missingClinical ? 'border-amber-500' : 'border-input'}`}
                >
                  <option value="">Select a reason…</option>
                  {options.map(o => <option key={o} value={o}>{o}</option>)}
                  <option value={OTHER}>Other (describe)</option>
                </select>
                {clinicalOther && (
                  <input
                    id={ids.clinicalText}
                    type="text"
                    aria-label="Clinical difference (other)"
                    placeholder="Describe the clinical difference"
                    value={details.clinicalDifference ?? ''}
                    disabled={disabled}
                    onChange={e => onChange({ clinicalDifference: e.target.value || null })}
                    className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  />
                )}
              </>
            ) : (
              <input
                id={ids.clinical}
                type="text"
                placeholder="Why a compounded preparation (503A)"
                value={details.clinicalDifference ?? ''}
                disabled={disabled}
                aria-invalid={missingClinical ? 'true' : undefined}
                onChange={e => onChange({ clinicalDifference: e.target.value || null })}
                className={`mt-0.5 w-full rounded-md border bg-background px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${missingClinical ? 'border-amber-500' : 'border-input'}`}
              />
            )}
          </div>

          {/* Diagnosis */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label htmlFor={ids.dxCode} className="block text-[11px] text-muted-foreground">
                Diagnosis code{rules.isControlled ? ' (required)' : ''}
              </label>
              <input
                id={ids.dxCode}
                ref={diagnosisRef}
                type="text"
                placeholder="ICD-10"
                maxLength={16}
                value={details.diagnosisCode ?? ''}
                disabled={disabled}
                aria-invalid={missingDiagnosis ? 'true' : undefined}
                onChange={e => onChange({ diagnosisCode: e.target.value || null })}
                className={`mt-0.5 w-full rounded-md border bg-background px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${missingDiagnosis ? 'border-amber-500' : 'border-input'}`}
              />
            </div>
            <div className="col-span-2">
              <label htmlFor={ids.dxText} className="block text-[11px] text-muted-foreground">Diagnosis</label>
              <input
                id={ids.dxText}
                type="text"
                placeholder="Description"
                maxLength={200}
                value={details.diagnosisText ?? ''}
                disabled={disabled}
                onChange={e => onChange({ diagnosisText: e.target.value || null })}
                className={`mt-0.5 w-full rounded-md border bg-background px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${missingDiagnosis ? 'border-amber-500' : 'border-input'}`}
              />
            </div>
          </div>

          {/* Special instructions */}
          <div>
            <label htmlFor={ids.special} className="block text-[11px] text-muted-foreground">Special instructions (optional)</label>
            <textarea
              id={ids.special}
              rows={2}
              maxLength={1000}
              placeholder="Notes to the pharmacy"
              value={details.specialInstructions ?? ''}
              disabled={disabled}
              onChange={e => onChange({ specialInstructions: e.target.value || null })}
              className="mt-0.5 w-full resize-none rounded-md border border-input bg-background px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            />
          </div>
        </div>
      )}
    </div>
  )
}
