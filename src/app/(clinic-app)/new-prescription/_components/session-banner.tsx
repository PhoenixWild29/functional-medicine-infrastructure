'use client'

// ============================================================
// Prescription Session Banner — WO-80
// ============================================================
//
// Persistent banner showing the selected patient and provider
// at the top of all prescription flow pages. Also shows the
// count of prescriptions added to the current session.
//
// WO-97: carries the patient's allergy chip (NKDA / Allergies: … /
// Allergies: not recorded). Clicking the chip opens the inline editor;
// Save writes to the patient and updates the session copy, so every
// subsequent Rx in this session and every later session sees it.
//
// If no patient/provider is selected (session not started),
// redirects back to /new-prescription to select them.

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { usePrescriptionSession } from '../_context/prescription-session'
import { EditableAllergyChip, type SavedAllergies } from './allergy-chip'

function formatDob(iso: string): string {
  try {
    const d = new Date(iso + 'T00:00:00')
    return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
  } catch {
    return iso
  }
}

export function SessionBanner() {
  const router = useRouter()
  const { patient, provider, prescriptionCount, isSessionStarted, isRestored, updatePatient } = usePrescriptionSession()

  // Redirect if session not started — once the provider has read storage.
  // Before that, an empty session means "not restored yet": this effect
  // runs before the provider's restore on a freshly mounted provider
  // (Refill → Review, or a hard refresh), and redirecting then sent a
  // refill to step 1 with its session still sitting in storage.
  useEffect(() => {
    if (isRestored && !isSessionStarted) {
      router.replace('/new-prescription')
    }
  }, [isRestored, isSessionStarted, router])

  // WO-97: a session persisted before allergies rode along has
  // `allergies` undefined. Hydrate from the patient row rather than
  // showing "not recorded" for a patient who has allergies on file —
  // otherwise the Review notice could invite a stale "Confirm NKDA".
  const patientId = patient?.patient_id ?? null
  const needsHydration = !!patient && patient.allergies === undefined
  useEffect(() => {
    if (!patientId || !needsHydration) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/patients/${patientId}/allergies`)
        if (!res.ok) {
          console.error('[allergies] hydration failed:', res.status, '| patient=', patientId)
          if (!cancelled) updatePatient({ allergiesLoadFailed: true })
          return
        }
        const body = await res.json() as Partial<SavedAllergies>
        if (cancelled) return
        updatePatient({
          allergies:            Array.isArray(body.allergies) ? body.allergies : [],
          nkda:                 body.nkda === true,
          allergies_updated_at: body.allergiesUpdatedAt ?? null,
          allergiesLoadFailed:  false,
        })
      } catch (err) {
        // Batch 1, finding 1: this used to fall back to "not recorded",
        // which reads as a clinical fact and invites a Confirm NKDA that
        // overwrites the patient's real list.
        console.error('[allergies] hydration failed:', err instanceof Error ? err.message : err, '| patient=', patientId)
        if (!cancelled) updatePatient({ allergiesLoadFailed: true })
      }
    })()
    return () => { cancelled = true }
  }, [patientId, needsHydration, updatePatient])

  if (!patient || !provider) return null

  function handleAllergiesSaved(saved: SavedAllergies) {
    updatePatient({
      allergies:            saved.allergies,
      nkda:                 saved.nkda,
      allergies_updated_at: saved.allergiesUpdatedAt,
    })
  }

  return (
    <div className="mb-4 rounded-lg border border-border bg-muted/30 px-4 py-3" data-testid="session-banner">
      <div className="flex items-start justify-between gap-4">

        {/* Patient info */}
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
            {patient.first_name[0]}{patient.last_name[0]}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              {patient.first_name} {patient.last_name}
            </p>
            <p className="text-[11px] text-muted-foreground">
              DOB: {formatDob(patient.date_of_birth)} — {patient.state ?? 'No state'} — {patient.phone || 'No phone'}
            </p>
            {/* WO-97: allergy chip + inline editor */}
            <EditableAllergyChip
              className="mt-1"
              patientId={patient.patient_id}
              patient={patient}
              onSaved={handleAllergiesSaved}
            />
          </div>
        </div>

        {/* Provider info */}
        <div className="shrink-0 text-right">
          <p className="text-sm font-medium text-foreground">
            {provider.first_name} {provider.last_name}
          </p>
          <p className="text-[11px] text-muted-foreground">
            NPI: {provider.npi_number}
          </p>
        </div>
      </div>

      {/* Prescription count badge */}
      {prescriptionCount > 0 && (
        <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
          <p className="text-xs text-muted-foreground">
            <span className="inline-flex items-center justify-center rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground">
              {prescriptionCount}
            </span>
            <span className="ml-1.5">
              prescription{prescriptionCount !== 1 ? 's' : ''} in this session
            </span>
          </p>
          <button
            type="button"
            onClick={() => router.push('/new-prescription/review')}
            className="text-xs font-medium text-primary underline hover:text-primary/80 focus-visible:outline-none"
          >
            Review & Send
          </button>
        </div>
      )}
    </div>
  )
}
