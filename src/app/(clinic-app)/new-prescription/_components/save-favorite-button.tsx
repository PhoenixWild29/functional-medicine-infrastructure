'use client'

// ============================================================
// WO-103: ☆ Save as favorite — shared by the builder, the margin
// page and every Review card
// ============================================================
//
// One click opens a name field pre-filled with "<Drug> <dose> <freq>"
// (defaultFavoriteName); Save POSTs to /api/favorites. Favorites are
// clinic-wide (WO-85), saved under the session provider. The button
// only renders for V3.0 formulation lines — legacy catalog lines have
// no formulation_id to pin.
//
// react-query is optional here: the Review card renders outside a
// QueryClientProvider in its unit tests, so the favorites cache is
// invalidated only when a client is present.

import { useContext, useState } from 'react'
import { QueryClientContext } from '@tanstack/react-query'
import { defaultFavoriteName } from '@/lib/orders/dose-display'

export interface SaveFavoriteInput {
  providerId:     string
  formulationId:  string | null
  pharmacyId:     string | null
  medicationName: string
  doseAmount:     string
  doseUnit:       string
  frequencyCode:  string | null | undefined
  sigText:        string
  quantity:       string | null | undefined
  refills:        number
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
  doseAmount, doseUnit, frequencyCode, sigText, quantity, refills,
  disabled = false, compact = false, idSuffix,
}: Props) {
  const queryClient = useContext(QueryClientContext)
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!formulationId) return null

  const suggested = defaultFavoriteName(medicationName, doseAmount, doseUnit, frequencyCode)
  const inputId = `favorite-name${idSuffix ? `-${idSuffix}` : ''}`

  function openForm() {
    setLabel(suggested)
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
          provider_id:      providerId,
          formulation_id:   formulationId,
          pharmacy_id:      pharmacyId,
          label:            name,
          dose_amount:      doseAmount,
          dose_unit:        doseUnit,
          frequency_code:   frequencyCode ?? null,
          sig_text:         sigText,
          default_quantity: quantity ?? null,
          default_refills:  refills,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(err.error ?? `Save failed (${res.status})`)
      }
      setOpen(false)
      setSaved(true)
      void queryClient?.invalidateQueries({ queryKey: ['provider-favorites'] })
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (saved) {
    return (
      <span role="status" className="inline-flex items-center gap-1 rounded-md border border-green-200 bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700">
        Saved to favorites
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
