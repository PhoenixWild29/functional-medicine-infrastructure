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
//
// Coverage gap 6: the clinic's saved clinical difference statements for
// the line's formulation are listed as one-click choices (this patient's
// first) next to the standard list, and a typed statement can be saved
// for the practice or the patient. Nothing is chosen automatically.

import { useEffect, useId, useRef, useState } from 'react'
import {
  formatDispenseWithPackage,
  MIN_OTHER_REASON_LENGTH,
  MISSING_RX_DETAIL_LABEL,
  REFILL_CHOICES,
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
import { SAVED_STATEMENT_MAX, SAVED_STATEMENT_MIN } from '@/lib/clinical-statements/limits'

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
  /** Gap 6: the line's formulation; its saved clinical difference statements are offered. None (a catalog line) → none. */
  formulationId?: string | null
  /** Gap 6: the session patient, for statements saved for this patient only. */
  patient?: { patientId: string; name: string } | null
}

interface SavedStatement {
  statement_id: string
  statement:    string
  scope:        'patient' | 'practice'
}

/**
 * Gap 6: the saved statements for this formulation as one-click choices,
 * and an offer to save the statement typed in the field. Choosing one
 * only fills the field (onPick); nothing is chosen on load.
 */
function SavedClinicalStatements({ lineId, formulationId, patient, current, standardOptions, disabled, onPick }: {
  lineId:          string
  formulationId:   string
  patient:         { patientId: string; name: string } | null
  current:         string | null
  standardOptions: ReadonlyArray<string>
  disabled:        boolean
  onPick:          (statement: string) => void
}) {
  const [saved, setSaved] = useState<SavedStatement[]>([])
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const patientId = patient?.patientId ?? null

  useEffect(() => {
    let cancelled = false
    const qs = new URLSearchParams({ formulation_id: formulationId })
    if (patientId) qs.set('patient_id', patientId)
    void (async () => {
      try {
        const res = await fetch(`/api/clinical-statements?${qs.toString()}`)
        const json = res.ok ? await res.json() as { data?: SavedStatement[] } : { data: [] }
        if (!cancelled) setSaved(json.data ?? [])
      } catch {
        if (!cancelled) setSaved([])
      } finally {
        if (!cancelled) setLoaded(true)
      }
    })()
    return () => { cancelled = true }
  }, [formulationId, patientId])

  const typed = (current ?? '').trim()
  const offerSave = loaded
    && typed.length >= SAVED_STATEMENT_MIN && typed.length <= SAVED_STATEMENT_MAX
    && !standardOptions.includes(typed)
    && !saved.some(s => s.statement.trim().toLowerCase() === typed.toLowerCase())

  async function save(forPatient: boolean) {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/clinical-statements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formulation_id: formulationId, statement: typed, patient_id: forPatient ? patientId : null }),
      })
      const json = await res.json().catch(() => ({})) as { data?: SavedStatement; error?: string }
      if (!res.ok || !json.data) throw new Error(json.error ?? 'The statement could not be saved.')
      const row = json.data
      setSaved(prev => prev.some(s => s.statement_id === row.statement_id) ? prev : [...prev, row])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The statement could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  if (saved.length === 0 && !offerSave && !error) return null
  return (
    <div className="mt-1 space-y-1">
      {saved.length > 0 && (
        <div data-testid={`saved-clinical-statements-${lineId}`}>
          <p className="text-[11px] text-muted-foreground">Saved statements</p>
          <div className="mt-0.5 flex flex-wrap gap-1">
            {saved.map(s => (
              <button
                key={s.statement_id}
                type="button"
                aria-label={`Use: ${s.statement}`}
                disabled={disabled}
                onClick={() => onPick(s.statement)}
                className="rounded-md border border-border bg-background px-2 py-0.5 text-left text-[11px] hover:bg-muted/50 disabled:opacity-50"
              >
                {s.statement}
                {s.scope === 'patient' && patient && <span className="ml-1 text-muted-foreground">For {patient.name}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
      {offerSave && (
        <div data-testid={`save-clinical-statement-${lineId}`} className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
          <span>Save this statement for next time:</span>
          <button type="button" disabled={disabled || saving} onClick={() => { void save(false) }} className="rounded-md border border-border px-2 py-0.5 font-medium text-foreground hover:bg-muted/50 disabled:opacity-50">
            Save for the practice
          </button>
          {patient && (
            <button type="button" disabled={disabled || saving} onClick={() => { void save(true) }} className="rounded-md border border-border px-2 py-0.5 font-medium text-foreground hover:bg-muted/50 disabled:opacity-50">
              Save for {patient.name} only
            </button>
          )}
        </div>
      )}
      {error && <p className="text-[11px] text-red-700" data-testid={`save-clinical-statement-error-${lineId}`}>{error}</p>}
    </div>
  )
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

export function RxDetailsRow({ lineId, details, rules, missing, disabled, onChange, packageLabel = null, packageCount = null, cycle = null, formulationId = null, patient = null }: Props) {
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
  // Adjusted while rendering (not in an effect) when the answer changes.
  const needsConfirmation = rxDetailsNeedConfirmation(rules)
  const [sawConfirmation, setSawConfirmation] = useState(needsConfirmation)
  if (sawConfirmation !== needsConfirmation) {
    setSawConfirmation(needsConfirmation)
    if (needsConfirmation) setOpen(true)
  }

  // Focus the first rule-required empty field when the row opens for it.
  useEffect(() => {
    if (!open) return
    if (missing.includes('diagnosis')) diagnosisRef.current?.focus()
    else if (missing.some(m => m.startsWith('clinical_difference'))) clinicalRef.current?.focus()
    // Only on open/rule change — not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, needsConfirmation])

  const options = rules.clinicalDifferenceOptions
  const clinicalIsPicklist = details.clinicalDifference != null && options.includes(details.clinicalDifference)
  const [clinicalOther, setClinicalOther] = useState<boolean>(
    () => details.clinicalDifference != null && details.clinicalDifference !== '' && !options.includes(details.clinicalDifference),
  )

  const missingDiagnosis = missing.includes('diagnosis')
  // C8: missing, a shortage reason that is not allowed, or a short "Other".
  const missingClinical = missing.some(m => m.startsWith('clinical_difference'))
  const clinicalProblem = missing.find(m => m === 'clinical_difference_shortage' || m === 'clinical_difference_other')

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
                {REFILL_CHOICES.map(n => (
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
                {clinicalOther && <p className="mt-0.5 text-[11px] text-muted-foreground">At least {MIN_OTHER_REASON_LENGTH} characters.</p>}
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
            {formulationId && (
              <SavedClinicalStatements
                lineId={lineId}
                formulationId={formulationId}
                patient={patient}
                current={details.clinicalDifference}
                standardOptions={options}
                disabled={disabled}
                onPick={statement => {
                  // A saved statement is not one of the standard reasons: it
                  // goes in "Other (describe)", where it stays editable.
                  if (options.length > 0 && !options.includes(statement)) setClinicalOther(true)
                  onChange({ clinicalDifference: statement })
                }}
              />
            )}
            {clinicalProblem && (
              <p className="mt-0.5 text-[11px] text-amber-700" data-testid={`clinical-difference-problem-${lineId}`}>
                Needs {MISSING_RX_DETAIL_LABEL[clinicalProblem]}.
              </p>
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
