'use client'

// ============================================================
// Allergy chip + inline editor — WO-97
// ============================================================
//
// One small chip, three states, rendered wherever the patient is
// pinned on screen (patient selector card, session banner):
//
//   NKDA                          — green
//   Allergies: penicillin, sulfa  — red
//   Allergies: not recorded       — amber
//
// Clicking the chip opens an inline editor under it (no page, no
// modal). Save writes to the patient through
// PATCH /api/patients/[patientId]/allergies and hands the stored values
// back to the caller, which is responsible for updating whatever copy
// of the patient it holds (the session, the selector list). Allergies
// are stored once on the patient and attached to every Rx — nothing in
// here is per-prescription.
//
// Copy says "provider", never "doctor".

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import {
  allergyChipLabel,
  allergyStatus,
  normalizeAllergies,
  type PatientAllergyFields,
} from '@/lib/patients/allergies'

// ── Shared result shape ───────────────────────────────────────

/** What the API returns and what callers receive on save. */
export interface SavedAllergies {
  allergies:          string[]
  nkda:               boolean
  allergiesUpdatedAt: string | null
}

export async function saveAllergies(
  patientId: string,
  patch: { allergies: string[]; nkda: boolean },
): Promise<SavedAllergies> {
  const res = await fetch(`/api/patients/${patientId}/allergies`, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(patch),
  })
  const body = await res.json().catch(() => ({})) as Partial<SavedAllergies> & { error?: string }
  if (!res.ok) {
    throw new Error(body.error ?? `Could not save allergies (${res.status})`)
  }
  return {
    allergies:          Array.isArray(body.allergies) ? body.allergies : [],
    nkda:               body.nkda === true,
    allergiesUpdatedAt: body.allergiesUpdatedAt ?? null,
  }
}

// ── Chip ──────────────────────────────────────────────────────

const CHIP_TONE: Record<ReturnType<typeof allergyStatus>['kind'], string> = {
  nkda:         'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  recorded:     'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300',
  not_recorded: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
}

interface AllergyChipProps {
  patient:   PatientAllergyFields | null | undefined
  /** When set the chip is a button; otherwise a plain span (safe inside another button). */
  onClick?:  () => void
  expanded?: boolean
  className?: string
}

export function AllergyChip({ patient, onClick, expanded, className = '' }: AllergyChipProps) {
  const status = allergyStatus(patient)
  const label  = allergyChipLabel(patient)
  const base   = `inline-flex max-w-full items-center gap-1 truncate rounded-full px-2 py-0.5 text-[11px] font-medium leading-4 ${CHIP_TONE[status.kind]} ${className}`

  if (!onClick) {
    return (
      <span className={base} data-testid="allergy-chip" data-allergy-status={status.kind} title={label}>
        {label}
      </span>
    )
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded ?? false}
      className={`${base} cursor-pointer underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
      data-testid="allergy-chip"
      data-allergy-status={status.kind}
      title={`${label} — click to edit`}
    >
      {label}
      <span aria-hidden className="text-[10px] opacity-70">✎</span>
    </button>
  )
}

// ── Inline editor ─────────────────────────────────────────────

interface AllergyEditorProps {
  patientId: string
  patient:   PatientAllergyFields | null | undefined
  onSaved:   (saved: SavedAllergies) => void
  onCancel:  () => void
}

export function AllergyEditor({ patientId, patient, onSaved, onCancel }: AllergyEditorProps) {
  const initial = allergyStatus(patient)
  const [text, setText]     = useState(initial.kind === 'recorded' ? initial.allergies.join(', ') : '')
  const [nkda, setNkda]     = useState(initial.kind === 'nkda')
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const inputId  = useId()
  const nkdaId   = useId()

  useEffect(() => { inputRef.current?.focus() }, [])

  const entries = normalizeAllergies(text)
  // NKDA and a list are mutually exclusive — ticking NKDA clears the
  // list; typing an allergy un-ticks NKDA.
  function handleNkda(checked: boolean) {
    setNkda(checked)
    if (checked) setText('')
  }
  function handleText(value: string) {
    setText(value)
    if (value.trim()) setNkda(false)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const saved = await saveAllergies(patientId, { allergies: nkda ? [] : entries, nkda })
      onSaved(saved)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save allergies')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="mt-2 rounded-md border border-border bg-background p-3 text-sm"
      data-testid="allergy-editor"
      onKeyDown={e => { if (e.key === 'Escape') onCancel() }}
    >
      <label htmlFor={inputId} className="block text-xs font-medium text-foreground">
        Drug allergies
      </label>
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        value={text}
        disabled={nkda || saving}
        onChange={e => handleText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void handleSave() } }}
        placeholder="penicillin, sulfa"
        aria-describedby={`${inputId}-hint`}
        className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      />
      <p id={`${inputId}-hint`} className="mt-1 text-[11px] text-muted-foreground">
        Separate with commas. Saved to the patient and attached to every prescription.
      </p>

      <label htmlFor={nkdaId} className="mt-2 flex items-center gap-2 text-xs text-foreground">
        <input
          id={nkdaId}
          type="checkbox"
          checked={nkda}
          disabled={saving}
          onChange={e => handleNkda(e.target.checked)}
          className="h-4 w-4 rounded border-input"
        />
        No known drug allergies (NKDA)
      </label>

      {error && (
        <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save allergies'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground underline hover:text-foreground focus-visible:outline-none"
        >
          Cancel
        </button>
        {!nkda && entries.length === 0 && (
          <span className="text-[11px] text-muted-foreground">Leave empty to keep &ldquo;not recorded&rdquo;.</span>
        )}
      </div>
    </div>
  )
}

// ── Chip that toggles the editor ──────────────────────────────

interface EditableAllergyChipProps {
  patientId: string
  patient:   PatientAllergyFields | null | undefined
  onSaved:   (saved: SavedAllergies) => void
  className?: string
  /** Rendered next to the chip (e.g. a hint) — stays outside the button. */
  trailing?: ReactNode
}

export function EditableAllergyChip({ patientId, patient, onSaved, className, trailing }: EditableAllergyChipProps) {
  const [open, setOpen] = useState(false)
  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2">
        <AllergyChip patient={patient} expanded={open} onClick={() => setOpen(o => !o)} />
        {trailing}
      </div>
      {open && (
        <AllergyEditor
          patientId={patientId}
          patient={patient}
          onSaved={saved => { setOpen(false); onSaved(saved) }}
          onCancel={() => setOpen(false)}
        />
      )}
    </div>
  )
}
