'use client'

// ============================================================
// Allergy notice on Review & Send — WO-97, coverage gap 9
// ============================================================
//
// Shown only while the session patient has no allergies recorded
// (neither NKDA nor a list). Gina Rooks NP asked for allergies or NKDA on
// every Rx, so a patient with neither cannot be signed for: the server
// refuses (lib/orders/batch-sign, ALLERGIES_REQUIRED) and Review and the
// sign page prompt first. Sign & Send stays enabled; pressing it shows the
// prompt (`prompting`) with the allergy entry open in place, so nothing is
// navigated away from and the Rx is kept. Saving NKDA or a list hands the
// stored values back through onSaved, and the caller carries on signing.
//
// Outside a sign attempt the notice offers Confirm NKDA (one click,
// written through the same PATCH the chip editor uses) and "Record
// allergies" (the chip's editor, inline). Save as Draft never gates on it.
// Once anything is recorded the notice disappears; the banner chip
// carries the state from then on.

import { patientName } from '@/lib/patients/display'
import { useState } from 'react'
import { ALLERGIES_REQUIRED_MESSAGE, PLAN_ALLERGIES_REQUIRED_MESSAGE, hasRecordedAllergies, type PatientAllergyFields } from '@/lib/patients/allergies'
import { AllergyEditor, saveAllergies, loadAllergies } from '../../_components/allergy-chip'
import { userMessage } from '@/lib/errors/user-message'

interface Props {
  patient: PatientAllergyFields & { patient_id: string; first_name: string; last_name: string; phone?: string | null }
  onSaved: (patch: {
    allergies: string[]; nkda: boolean; allergies_updated_at: string | null; allergiesLoadFailed?: boolean
  }) => void
  /**
   * A sign attempt found nothing recorded: show the prompt with the entry
   * open. Also used when the server refused (ALLERGIES_REQUIRED) although
   * this copy of the patient said otherwise.
   */
  prompting?: boolean
  /** Close the prompt without saving (the Rx stays as it was). */
  onCancelPrompt?: () => void
  /** What the prompt is for: signing (the default) or sending a plan. */
  promptFor?: 'signing' | 'plan'
}

export function AllergyNotice({ patient, onSaved, prompting = false, onCancelPrompt, promptFor = 'signing' }: Props) {
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [editing, setEditing] = useState(false)

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
          Allergies could not be loaded for {patientName(patient)}.
        </p>
        <p className="mt-0.5 text-xs">
          This is an error, not an empty record. They may have allergies on file. Nothing about this patient
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
        Loading allergies for {patientName(patient)}…
      </div>
    )
  }

  const saved = (s: { allergies: string[]; nkda: boolean; allergiesUpdatedAt: string | null }) => {
    setEditing(false)
    onSaved({ allergies: s.allergies, nkda: s.nkda, allergies_updated_at: s.allergiesUpdatedAt })
  }

  // ── The prompt, on a sign attempt ──
  if (prompting) {
    return (
      <div
        role="status"
        data-testid="allergies-required-prompt"
        className="rounded-lg border-2 border-amber-400 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950/20"
      >
        <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
          {promptFor === 'plan' ? PLAN_ALLERGIES_REQUIRED_MESSAGE : ALLERGIES_REQUIRED_MESSAGE}
        </p>
        <p className="mt-0.5 text-xs text-amber-800 dark:text-amber-300">
          {promptFor === 'plan'
            ? `${patientName(patient)}: the pharmacy receives allergies or NKDA on every prescription. The plan has not been sent, and your prescriptions are kept. Save, and the plan is sent.`
            : `${patientName(patient)}: the pharmacy receives allergies or NKDA on every prescription. Nothing has been signed, and your prescriptions are kept. Save, and signing continues.`}
        </p>
        <AllergyEditor
          patientId={patient.patient_id}
          patient={patient}
          onSaved={saved}
          onCancel={() => onCancelPrompt?.()}
        />
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
      saved(await saveAllergies(patient.patient_id, { allergies: [], nkda: true, confirmNkda: true }))
      // The notice (and the focused button) goes away once NKDA is
      // recorded: focus moves to the session banner's allergy chip, which
      // now reads NKDA, instead of being lost to the page.
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>('[data-testid="session-banner"] [data-testid="allergy-chip"]')?.closest<HTMLElement>('button')?.focus()
      })
    } catch (err) {
      setError(userMessage(err, 'Could not save'))
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
            Allergies not recorded for {patientName(patient)}
          </p>
          <p className="mt-0.5 text-xs text-amber-800 dark:text-amber-300">
            {ALLERGIES_REQUIRED_MESSAGE}. Confirm NKDA here, or record the allergies. You can still save as a draft.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void confirmNkda()}
            disabled={saving}
            className="rounded-md border border-amber-400 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:opacity-50 dark:bg-amber-950/40 dark:text-amber-100"
          >
            {saving ? 'Saving…' : 'Confirm NKDA'}
          </button>
          {!editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              disabled={saving}
              className="rounded-md border border-amber-400 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:opacity-50 dark:bg-amber-950/40 dark:text-amber-100"
            >
              Record allergies
            </button>
          )}
        </div>
      </div>
      {editing && (
        <AllergyEditor patientId={patient.patient_id} patient={patient} onSaved={saved} onCancel={() => setEditing(false)} />
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>
      )}
    </div>
  )
}
