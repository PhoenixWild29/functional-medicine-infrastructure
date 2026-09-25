'use client'

// ============================================================
// WO-103 / WO-104: ☆ Save as favorite — shared by the builder, the
// margin page and every Review card
// ============================================================
//
// One click opens a name field and a scope choice; Save POSTs the dose
// as a structured preset to /api/favorites. WO-104: a favorite is the
// drug + formulation + pharmacy, so the name defaults to the medication
// (the dose is a chip under it), and saving a dose for a card the clinic
// already has adds the dose to that card instead of creating a second
// one. Scope defaults to the practice; when a patient is selected the
// provider may pin the favorite to that patient instead. The button only
// renders for V3.0 formulation lines — legacy catalog lines have no
// formulation_id to pin.
//
// react-query is optional here: the Review card renders outside a
// QueryClientProvider in its unit tests, so the favorites cache is
// invalidated only when a client is present.

import { useContext, useState } from 'react'
import { QueryClientContext } from '@tanstack/react-query'
import type { CycleSchedule } from '@/lib/orders/cycling'

export interface SaveFavoriteInput {
  providerId:     string
  formulationId:  string | null
  pharmacyId:     string | null
  medicationName: string
  doseAmount:     string
  doseUnit:       string
  frequencyCode:  string | null | undefined
  /** WO-104: builder timing code, when the caller knows it structurally */
  timingCode?:    string | null | undefined
  /** WO-104: preset duration — days as a string, "ONGOING" or '' */
  duration?:      string | null | undefined
  refills:        number
  /** WO-104: the session patient, offered as "Only for <name>" */
  patient?:       { patientId: string; name: string } | null | undefined
  /**
   * Cycling dose math: a cycling line's pattern and length. Saved on the
   * favorite, so it reopens as the same cycling line (before this every
   * favorite saved from the app was standard).
   */
  cycle?:         CycleSchedule | null | undefined
}

interface Props extends SaveFavoriteInput {
  disabled?: boolean
  /** Compact: icon-only trigger (builder action row). Default: "☆ Save as favorite". */
  compact?:  boolean
  /** Distinguishes multiple buttons on one page (Review cards). */
  idSuffix?: string
}

export function SaveFavoriteButton({
  providerId, formulationId, pharmacyId, medicationName,
  doseAmount, doseUnit, frequencyCode, timingCode, duration, refills, patient, cycle,
  disabled = false, compact = false, idSuffix,
}: Props) {
  const queryClient = useContext(QueryClientContext)
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [forPatient, setForPatient] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!formulationId) return null

  const suffix = idSuffix ? `-${idSuffix}` : ''
  const inputId = `favorite-name${suffix}`

  function openForm() {
    setLabel(medicationName.trim())
    setForPatient(false)
    setError(null)
    setOpen(true)
  }

  async function handleSave() {
    const name = label.trim()
    if (!formulationId || !providerId || !name || saving) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider_id:     providerId,
          formulation_id:  formulationId,
          pharmacy_id:     pharmacyId,
          patient_id:      forPatient && patient ? patient.patientId : null,
          label:           name,
          dose_presets:    [{
            dose:      doseAmount,
            unit:      doseUnit,
            frequency: frequencyCode ?? '',
            timing:    timingCode ?? '',
            duration:  duration ?? '',
            label:     null,
          }],
          default_refills: refills,
          ...(cycle
            ? { sig_mode: 'cycling', cycle_on_days: cycle.onDays, cycle_off_days: cycle.offDays, cycle_duration_days: cycle.lengthDays }
            : {}),
        }),
      })
      const json = await res.json().catch(() => ({})) as { error?: string; merged?: boolean; data?: { label?: string } }
      if (!res.ok) throw new Error(json.error ?? `Save failed (${res.status})`)
      setOpen(false)
      setSaved(json.merged && json.data?.label ? `Dose added to ${json.data.label}` : 'Saved to favorites')
      void queryClient?.invalidateQueries({ queryKey: ['provider-favorites'] })
      setTimeout(() => setSaved(null), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (saved) {
    return (
      <span role="status" className="inline-flex items-center gap-1 rounded-md border border-green-200 bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700">
        {saved}
      </span>
    )
  }

  if (open) {
    return (
      <div className="flex flex-wrap items-center gap-1" data-testid="save-favorite-form">
        <label htmlFor={inputId} className="sr-only">Favorite name</label>
        <input
          id={inputId}
          type="text"
          placeholder="Favorite name…"
          value={label}
          onChange={e => setLabel(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); void handleSave() }
            if (e.key === 'Escape') setOpen(false)
          }}
          autoFocus
          className="w-56 rounded-md border border-input bg-background px-2 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {patient && (
          <fieldset className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
            <legend className="sr-only">Save for</legend>
            <label className="flex items-center gap-1">
              <input type="radio" name={`favorite-scope${suffix}`} checked={!forPatient} onChange={() => setForPatient(false)} />
              For the practice
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" name={`favorite-scope${suffix}`} checked={forPatient} onChange={() => setForPatient(true)} />
              Only for {patient.name}
            </label>
          </fieldset>
        )}
        <button
          type="button"
          onClick={() => { void handleSave() }}
          disabled={!label.trim() || saving || !providerId}
          className="rounded-md bg-primary/10 px-2 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save favorite'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={saving}
          className="rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted/50"
        >
          Cancel
        </button>
        {error && <p role="alert" className="w-full text-xs text-red-600">{error}</p>}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={openForm}
      disabled={disabled || !providerId}
      title="Save as favorite"
      aria-label={compact ? `Save ${medicationName} as favorite` : undefined}
      className={`rounded-md border border-border text-sm transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50 ${
        compact ? 'px-3 py-2' : 'px-2.5 py-1 text-xs'
      }`}
    >
      {compact ? '☆' : '☆ Save as favorite'}
    </button>
  )
}
