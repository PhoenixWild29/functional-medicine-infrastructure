'use client'

// ============================================================
// Requirement 19: "Make favorite" from Frequently used
// ============================================================
//
// Gina Rooks, 2026-09-11: a frequently used section "with the ability to
// then convert it to a favorite", and favorites for a specific patient as
// well as the practice. The dialog asks the two things a favorite needs:
//   - who it is for: the practice, or the patient in this session;
//   - which doses: the dose that was used, ticked; the drug's other doses
//     (its other frequently used doses, the clinic's favorites for the
//     formulation) offered unticked, so they group under the one drug
//     (requirement 17); and a dose can be added.
// Saving is POST /api/favorites, which adds the doses to the card the
// clinic already has for this drug, pharmacy and scope, or makes one.

import { useEffect, useId, useRef, useState } from 'react'
import { DOSE_UNITS } from '@/lib/orders/dose-display'
import type { ConcentrationSource } from '@/lib/orders/dose-display'
import { FREQUENCY_OPTIONS } from './structured-sig-builder.types'
import {
  mergePresets,
  presetChipText,
  presetKey,
  validateDosePreset,
  type DosePreset,
} from '@/lib/orders/favorite-presets'

export interface MakeFavoriteTarget {
  formulation_id:   string
  pharmacy_id:      string | null
  formulation_name: string
  preset:           DosePreset
  formulations:     ConcentrationSource | null
}

interface Props {
  target:      MakeFavoriteTarget
  /** The drug's other doses, offered unticked. */
  otherDoses:  ReadonlyArray<DosePreset>
  /** The session patient, when there is one. */
  patient:     { patientId: string; name: string } | null
  providerId:  string
  onClose:     () => void
  /** Called after the favorite is saved. */
  onSaved:     () => Promise<void> | void
}

export function MakeFavoriteDialog({ target, otherDoses, patient, providerId, onClose, onSaved }: Props) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const [doses, setDoses] = useState<DosePreset[]>(() => mergePresets([target.preset], otherDoses))
  const [ticked, setTicked] = useState<Set<string>>(() => new Set([presetKey(target.preset)]))
  const [scope, setScope] = useState<'practice' | 'patient'>('practice')
  const [newDose, setNewDose] = useState({ dose: '', unit: target.preset.unit, frequency: target.preset.frequency })
  const [newDoseError, setNewDoseError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { dialogRef.current?.focus() }, [])

  const doseText = (p: DosePreset) => {
    const t = presetChipText(p, target.formulations)
    return `${t.primary} ${t.secondary}`.trim()
  }

  function toggle(p: DosePreset) {
    const key = presetKey(p)
    setTicked(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function addDose() {
    const v = validateDosePreset({ ...newDose, timing: '', duration: '', label: null })
    if (!v.ok) {
      setNewDoseError('Enter a dose amount, a unit and a frequency.')
      return
    }
    setNewDoseError(null)
    setDoses(prev => mergePresets(prev, [v.preset]))
    setTicked(prev => new Set([...prev, presetKey(v.preset)]))
    setNewDose(d => ({ ...d, dose: '' }))
  }

  async function save() {
    const chosen = doses.filter(p => ticked.has(presetKey(p)))
    if (chosen.length === 0 || saving) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider_id:    providerId,
          formulation_id: target.formulation_id,
          pharmacy_id:    target.pharmacy_id,
          patient_id:     scope === 'patient' && patient ? patient.patientId : null,
          label:          target.formulation_name,
          dose_presets:   chosen,
        }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(json.error ?? `Save failed (${res.status})`)
      }
      await onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const tickedCount = doses.filter(p => ticked.has(presetKey(p))).length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}
        className="w-full max-w-md space-y-4 rounded-lg border border-border bg-card p-4 shadow-lg focus:outline-none"
      >
        <h2 id={titleId} className="text-sm font-semibold text-foreground">Make {target.formulation_name} a favorite</h2>

        <fieldset className="space-y-1">
          <legend className="text-xs font-medium text-muted-foreground">Save it for</legend>
          {patient ? (
            <>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name={`${titleId}-scope`} checked={scope === 'practice'} onChange={() => setScope('practice')} />
                The practice
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name={`${titleId}-scope`} checked={scope === 'patient'} onChange={() => setScope('patient')} />
                Only for {patient.name}
              </label>
            </>
          ) : (
            <p className="text-sm text-foreground">Saved for the practice.</p>
          )}
        </fieldset>

        <fieldset className="space-y-1">
          <legend className="text-xs font-medium text-muted-foreground">Doses on this favorite</legend>
          {doses.map(p => (
            <label key={presetKey(p)} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={ticked.has(presetKey(p))} onChange={() => toggle(p)} />
              {doseText(p)}
            </label>
          ))}
          <div className="flex flex-wrap items-end gap-2 pt-1">
            <input
              aria-label="New dose amount"
              inputMode="decimal"
              value={newDose.dose}
              onChange={e => setNewDose(d => ({ ...d, dose: e.target.value }))}
              placeholder="Dose"
              className="w-20 rounded-md border border-input bg-background px-2 py-1 text-sm"
            />
            <select
              aria-label="New dose unit"
              value={newDose.unit}
              onChange={e => setNewDose(d => ({ ...d, unit: e.target.value }))}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm"
            >
              {DOSE_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
            <select
              aria-label="New dose frequency"
              value={newDose.frequency}
              onChange={e => setNewDose(d => ({ ...d, frequency: e.target.value }))}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm"
            >
              <option value="">No frequency</option>
              {FREQUENCY_OPTIONS.map(f => <option key={f.code} value={f.code}>{f.display}</option>)}
            </select>
            <button type="button" onClick={addDose} className="rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-muted/50">
              Add dose
            </button>
          </div>
          {newDoseError && <p className="text-xs text-red-700" data-testid="make-favorite-dose-error">{newDoseError}</p>}
        </fieldset>

        {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" data-testid="make-favorite-error">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted/50">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => { void save() }}
            disabled={tickedCount === 0 || saving}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save favorite'}
          </button>
        </div>
      </div>
    </div>
  )
}
