'use client'

// ============================================================
// Allergy notice on Review & Send — WO-97
// ============================================================
//
// Shown only while the session patient has no allergies recorded
// (neither NKDA nor a list). Amber, non-blocking: the provider may
// confirm NKDA inline — one click, written to the patient through the
// same PATCH the chip editor uses — or record allergies via the banner
// chip, or simply proceed. Sign & Send and Save as Draft never gate on
// it. Once anything is recorded the notice disappears; the banner chip
// carries the state from then on.

import { useState } from 'react'
import { hasRecordedAllergies, type PatientAllergyFields } from '@/lib/patients/allergies'
import { saveAllergies, loadAllergies } from '../../_components/allergy-chip'

interface Props {
  patient: PatientAllergyFields & { patient_id: string; first_name: string; last_name: string }
  onSaved: (patch: {
    allergies: string[]; nkda: boolean; allergies_updated_at: string | null; allergiesLoadFailed?: boolean
  }) => void
}

export function AllergyNotice({ patient, onSaved }: Props) {
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  // Retry re-runs the one read in place. The failure state stays up
  // while it is in flight, so there is never a moment where this notice
  // falls back to "not recorded" and offers Confirm NKDA.
  const [retrying, setRetrying] = useState(false)
  async function retryLoad() {
    setRetrying(true)
    try {
      const loaded = await loadAllergies(patient.patient_id)
      onSaved({ allergies: loaded.allergies, nkda: loaded.nkda, allergies_updated_at: loaded.allergiesUpdatedAt, allergiesLoadFailed: false })
    } catch (err) {
      console.error('[allergies] retry failed:', err instanceof Error ? err.message : err, '| patient=', patient.patient_id)
    } finally {
      setRetrying(false)
    }
  }

  // Batch 1, finding 1: when the read FAILED we do not know what this
  // patient is allergic to, so the "not recorded" notice — and above all
  // its Confirm NKDA button, which PATCHes {allergies: [], nkda: true}
  // over whatever is stored — must not appear. Sending is blocked
  // upstream until the status is known; saving a draft never is.
  if ((patient as { allergiesLoadFailed?: boolean | null }).allergiesLoadFailed) {
    return (
      <div
        role="alert"
        data-testid="allergy-load-error"
        className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/20 dark:text-red-200"
      >
        <p className="font-semibold">
          Allergies could not be loaded for {patient.first_name} {patient.last_name}.
        </p>
        <p className="mt-0.5 text-xs">
          This is an error, not an empty record — they may have allergies on file. Nothing about this patient
          has been changed.
        </p>
        <button
          type="button"
          onClick={retryLoad}
          disabled={retrying}
          className="mt-2 rounded-md border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-800 hover:bg-red-100 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-transparent dark:text-red-200"
        >
          {retrying ? 'Retrying…' : 'Retry'}
        </button>
      </div>
    )
  }

  // Not read yet: the status is unknown. "Not recorded" — and above all
  // Confirm NKDA — waits for the read to resolve.
  if ((patient as { allergies?: unknown }).allergies === undefined) {
    return (
      <div
        role="status"
        data-testid="allergy-loading"
        className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground"
      >
        Loading allergies for {patient.first_name} {patient.last_name}…
      </div>
    )
  }

  if (hasRecordedAllergies(patient)) return null

  async function confirmNkda() {
    setSaving(true)
    setError(null)
    try {
      // confirmNkda: the server refuses the shortcut (409) if a list is
      // on file, so this button can never erase one.
      const saved = await saveAllergies(patient.patient_id, { allergies: [], nkda: true, confirmNkda: true })
      onSaved({ allergies: saved.allergies, nkda: saved.nkda, allergies_updated_at: saved.allergiesUpdatedAt })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      role="status"
      data-testid="allergy-notice"
      className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/20"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            Allergies not recorded for {patient.first_name} {patient.last_name}
          </p>
          <p className="mt-0.5 text-xs text-amber-800 dark:text-amber-300">
            The pharmacy will receive &ldquo;Allergies: not recorded&rdquo;. Confirm NKDA here, or add allergies
            from the chip in the banner above. You can also proceed as is.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void confirmNkda()}
          disabled={saving}
          className="rounded-md border border-amber-400 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:opacity-50 dark:bg-amber-950/40 dark:text-amber-100"
        >
          {saving ? 'Saving…' : 'Confirm NKDA'}
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>
      )}
    </div>
  )
}
