'use client'

// ============================================================
// Prescription Session Banner — WO-80
// ============================================================
//
// Persistent banner showing the selected patient and provider
// at the top of all prescription flow pages. Also shows the
// count of prescriptions added to the current session.
//
// If no patient/provider is selected (session not started),
// redirects back to /new-prescription to select them.

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { usePrescriptionSession } from '../_context/prescription-session'

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
  const { patient, provider, prescriptionCount, isSessionStarted } = usePrescriptionSession()

  // Redirect if session not started
  useEffect(() => {
    if (!isSessionStarted) {
      router.replace('/new-prescription')
    }
  }, [isSessionStarted, router])

  if (!patient || !provider) return null

  return (
    <div className="mb-4 rounded-lg border border-border bg-muted/30 px-4 py-3">
      <div className="flex items-center justify-between gap-4">

        {/* Patient info */}
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
            {patient.first_name[0]}{patient.last_name[0]}
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">
              {patient.first_name} {patient.last_name}
            </p>
            <p className="text-[11px] text-muted-foreground">
              DOB: {formatDob(patient.date_of_birth)} — {patient.state ?? 'No state'} — {patient.phone || 'No phone'}
            </p>
          </div>
        </div>

        {/* Provider info */}
        <div className="text-right">
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
