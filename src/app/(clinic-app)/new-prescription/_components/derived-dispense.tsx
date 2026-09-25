'use client'

// ============================================================
// WO-96: Derived days supply + dispense (margin/sig page)
// ============================================================
//
// Phase 21 rule 3: nothing on screen the app could have computed. Days
// supply comes from the duration the provider picked (else from dose ×
// frequency × quantity) and dispense from dose × frequency × days
// supply; both are shown read-only next to the sig and a click opens
// inline override inputs. The provider never types them unless the
// derivation is wrong.

import { useId, useState } from 'react'
import { formatDispense, type DerivedDispense } from '@/lib/orders/rx-details'
import { dosingDaysSummary, type CyclePattern } from '@/lib/orders/cycling'

export interface DispenseOverride {
  daysSupply:       string   // '' = keep derived
  dispenseQuantity: string   // '' = keep derived
  dispenseUnit:     string   // '' = keep derived
}

export const EMPTY_OVERRIDE: DispenseOverride = { daysSupply: '', dispenseQuantity: '', dispenseUnit: '' }

/** What the derived values were computed from — drives the explanation line. */
/**
 * `cycle` is set on a cycling line: its doses were counted over the
 * on-days only, and the count is shown (rule 3).
 */
export type DerivedBasis =
  | { kind: 'duration'; days: number; doses: number | null; cycle?: CyclePattern }
  | { kind: 'quantity'; label: string; cycle?: CyclePattern }
  // WO-105: a titration's total, summed over its steps.
  | { kind: 'titration'; days: number; steps: number }

/**
 * The sentence under Days supply / Dispense: what was actually computed,
 * for the mode the line is in. Each mode has its own; the as-needed one
 * is only for a dose that cannot be counted (a titration total used to
 * borrow it, found on prod 2026-09-25).
 */
export function derivedHelpText(basis: DerivedBasis, derived: DerivedDispense | null, packageText: string): string {
  if (basis.kind === 'titration') {
    return `Days supply is the ${basis.days} days the ${basis.steps} titration step${basis.steps === 1 ? '' : 's'} add up to. ` +
      "Dispense is the sum over the steps: each step's doses × that step's dose."
  }
  if (basis.kind === 'duration') {
    if (basis.doses == null) {
      return `Days supply is the ${basis.days}-day duration selected on the dose step. As-needed doses can't be counted, so dispense is the selected package.`
    }
    if (basis.cycle) {
      return `Days supply is the ${basis.days}-day cycle length selected on the dose step. ` +
        `Dispense is ${basis.doses} dose${basis.doses === 1 ? '' : 's'} (the on-days in those ${basis.days} days) × the dose.`
    }
    return `Days supply is the ${basis.days}-day duration selected on the dose step. Dispense is ${basis.doses} dose${basis.doses === 1 ? '' : 's'} over those days × the dose.`
  }
  if (derived?.daysSupply == null) {
    return `No duration selected, and this dose can't be counted per day (as-needed or unmatched units). Dispense is the ${packageText}; use Override to set days supply.`
  }
  if (basis.cycle) {
    return `No cycle length (ongoing), so days supply is how long the ${packageText} package lasts, dosing on on-days only.`
  }
  return `No duration selected, so days supply is how long the ${packageText} package lasts at this dose and frequency. Select a duration on the dose step to set it directly.`
}

interface Props {
  derived:  DerivedDispense | null
  basis:    DerivedBasis
  override: DispenseOverride
  onChange: (next: DispenseOverride) => void
}

/** Apply the override on top of the derived values → the values actually sent. */
export function resolveDispense(
  derived: DerivedDispense | null,
  override: DispenseOverride,
): { daysSupply: number | null; dispenseQuantity: number | null; dispenseUnit: string | null } {
  const days = override.daysSupply.trim() !== '' ? parseInt(override.daysSupply, 10) : null
  const qty  = override.dispenseQuantity.trim() !== '' ? parseFloat(override.dispenseQuantity) : null
  const unit = override.dispenseUnit.trim() !== '' ? override.dispenseUnit.trim() : null
  return {
    daysSupply:       days != null && Number.isInteger(days) && days > 0 ? days : derived?.daysSupply ?? null,
    dispenseQuantity: qty != null && Number.isFinite(qty) && qty > 0 ? qty : derived?.dispenseQuantity ?? null,
    dispenseUnit:     unit ?? derived?.dispenseUnit ?? null,
  }
}

export function DerivedDispense({ derived, basis, override, onChange }: Props) {
  const [editing, setEditing] = useState(false)
  const daysId = useId()
  const qtyId = useId()
  const unitId = useId()

  const resolved = resolveDispense(derived, override)
  const isOverridden = override.daysSupply !== '' || override.dispenseQuantity !== '' || override.dispenseUnit !== ''

  // The package the no-duration fallback was computed from ("30 mL", "1 vial").
  const packageText = formatDispense(derived?.dispenseQuantity ?? null, derived?.dispenseUnit ?? null)
    ?? (basis.kind === 'quantity' && basis.label ? basis.label : 'selected')
  const daysText = resolved.daysSupply != null ? `${resolved.daysSupply} days` : '—'
  // Cycling dose math: the dosing days in the days supply.
  const dosingDaysText = basis.kind !== 'titration' && basis.cycle && resolved.daysSupply != null
    ? dosingDaysSummary(resolved.daysSupply, basis.cycle)
    : null
  const dispenseText = formatDispense(resolved.dispenseQuantity, resolved.dispenseUnit) ?? '—'

  return (
    <div
      className="rounded-lg border border-border bg-muted/30 p-3"
      data-testid="derived-dispense"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-sm">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Days supply</span>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Dispense</span>
          <span className="font-semibold text-foreground" data-testid="days-supply-value">{daysText}</span>
          <span className="font-semibold text-foreground" data-testid="dispense-value">{dispenseText}</span>
        </div>
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="shrink-0 text-xs text-primary underline hover:text-primary/80"
          >
            {isOverridden ? 'Edit override' : 'Override'}
          </button>
        )}
      </div>

      {dosingDaysText && (
        <p className="mt-1 text-xs font-medium text-foreground" data-testid="dosing-days">{dosingDaysText}</p>
      )}

      <p className="mt-1 text-[11px] text-muted-foreground" data-testid="derived-help">
        {isOverridden ? 'Provider override in effect.' : derivedHelpText(basis, derived, packageText)}
      </p>

      {editing && (
        <div className="mt-3 grid grid-cols-3 gap-2">
          <div>
            <label htmlFor={daysId} className="block text-[11px] text-muted-foreground">Days supply</label>
            <input
              id={daysId}
              type="number"
              min="1"
              step="1"
              inputMode="numeric"
              placeholder={derived?.daysSupply != null ? String(derived.daysSupply) : '—'}
              value={override.daysSupply}
              onChange={e => onChange({ ...override, daysSupply: e.target.value })}
              className="mt-0.5 w-full rounded-md border border-input bg-background px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div>
            <label htmlFor={qtyId} className="block text-[11px] text-muted-foreground">Dispense qty</label>
            <input
              id={qtyId}
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              placeholder={derived ? String(derived.dispenseQuantity) : '—'}
              value={override.dispenseQuantity}
              onChange={e => onChange({ ...override, dispenseQuantity: e.target.value })}
              className="mt-0.5 w-full rounded-md border border-input bg-background px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div>
            <label htmlFor={unitId} className="block text-[11px] text-muted-foreground">Unit</label>
            <input
              id={unitId}
              type="text"
              placeholder={derived?.dispenseUnit ?? 'mL'}
              value={override.dispenseUnit}
              onChange={e => onChange({ ...override, dispenseUnit: e.target.value })}
              className="mt-0.5 w-full rounded-md border border-input bg-background px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div className="col-span-3 flex justify-end gap-3">
            {isOverridden && (
              <button
                type="button"
                onClick={() => { onChange(EMPTY_OVERRIDE); setEditing(false) }}
                className="text-xs text-muted-foreground underline hover:text-foreground"
              >
                Use computed values
              </button>
            )}
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="text-xs text-primary underline hover:text-primary/80"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
