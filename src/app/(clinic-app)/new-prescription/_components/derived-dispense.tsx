'use client'

// ============================================================
// WO-96: Derived days supply + dispense (margin/sig page)
// ============================================================
//
// Phase 21 rule 3: nothing on screen the app could have computed. Days
// supply and dispense are derived from dose × frequency × quantity and
// shown read-only next to the sig; a click opens inline override inputs.
// The provider never types them unless the derivation is wrong.

import { useId, useState } from 'react'
import { formatDispense, type DerivedDispense } from '@/lib/orders/rx-details'

export interface DispenseOverride {
  daysSupply:       string   // '' = keep derived
  dispenseQuantity: string   // '' = keep derived
  dispenseUnit:     string   // '' = keep derived
}

export const EMPTY_OVERRIDE: DispenseOverride = { daysSupply: '', dispenseQuantity: '', dispenseUnit: '' }

interface Props {
  derived:    DerivedDispense | null
  /** True when no quantity was chosen upstream — nothing to derive from. */
  noQuantity: boolean
  override:   DispenseOverride
  onChange:   (next: DispenseOverride) => void
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

export function DerivedDispense({ derived, noQuantity, override, onChange }: Props) {
  const [editing, setEditing] = useState(false)
  const daysId = useId()
  const qtyId = useId()
  const unitId = useId()

  const resolved = resolveDispense(derived, override)
  const isOverridden = override.daysSupply !== '' || override.dispenseQuantity !== '' || override.dispenseUnit !== ''

  const daysText = resolved.daysSupply != null ? `${resolved.daysSupply} days` : '—'
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

      <p className="mt-1 text-[11px] text-muted-foreground">
        {noQuantity
          ? 'Computed once a quantity is selected. Override to enter values directly.'
          : derived?.daysSupply == null
            ? 'Dispense computed from the selected quantity; days supply could not be derived from this sig (as-needed or unmatched units).'
            : isOverridden
              ? 'Provider override in effect.'
              : 'Computed from dose × frequency × quantity.'}
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
