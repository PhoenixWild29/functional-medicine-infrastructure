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
import { saveAllergies } from '../../_components/allergy-chip'

interface Props {
  patient: PatientAllergyFields & { patient_id: string; first_name: string; last_name: string }
  onSaved: (patch: { allergies: string[]; nkda: boolean; allergies_updated_at: string | null }) => void
}

export function AllergyNotice({ patient, onSaved }: Props) {
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  if (hasRecordedAllergies(patient)) return null

  async function confirmNkda() {
    setSaving(true)
    setError(null)
    try {
      const saved = await saveAllergies(patient.patient_id, { allergies: [], nkda: true })
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
