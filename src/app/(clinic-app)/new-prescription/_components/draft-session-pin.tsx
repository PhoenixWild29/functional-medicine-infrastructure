'use client'

// ============================================================
// Draft Session Pin — WO-98
// ============================================================
//
// When the builder is opened FROM a draft (Edit / + Add prescription),
// the draft's patient and provider are pinned on the session so the
// existing search → margin pages work unchanged: the SessionBanner
// shows them, pharmacy options filter on the patient's state, and the
// margin page's POST/PATCH sends the draft's ids.
//
// If the session already holds a different patient, that session (and
// its unsaved lines) is replaced — the draft's patient is authoritative.
// Same patient → the session lines are left alone.
//
// Children (the SessionBanner + builder / margin form) mount only once
// the pin has been applied: a provider who opens a draft with no session
// of their own would otherwise be bounced to /new-prescription by the
// banner's "no session" redirect before this effect ran.

import { useEffect, type ReactNode } from 'react'
import { usePrescriptionSession, type SessionPatient, type SessionProvider } from '../_context/prescription-session'

interface Props {
  patient:  SessionPatient
  provider: SessionProvider
  children?: ReactNode
}

export function DraftSessionPin({ patient, provider, children }: Props) {
  const session = usePrescriptionSession()
  const { setPatient, setProvider, clearSession } = session
  const currentPatientId  = session.patient?.patient_id ?? null
  const currentProviderId = session.provider?.provider_id ?? null
  const pinned = currentPatientId === patient.patient_id && currentProviderId === provider.provider_id
  // If the sessionStorage restore briefly swaps the ids back, the
  // children unmount for one tick and the effect below re-pins.

  // Re-runs whenever the session's ids drift from the pinned ones —
  // including right after PrescriptionSessionProvider restores an older
  // session from sessionStorage on mount — so the pin always wins.
  useEffect(() => {
    if (currentPatientId === patient.patient_id && currentProviderId === provider.provider_id) return
    if (currentPatientId !== null && currentPatientId !== patient.patient_id) {
      clearSession()
    }
    setPatient(patient)
    setProvider(provider)
  }, [currentPatientId, currentProviderId, patient, provider, setPatient, setProvider, clearSession])

  if (!pinned) return null
  return <>{children}</>
}
