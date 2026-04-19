'use client'

// ============================================================
// Patient & Provider Selector — WO-80
// ============================================================
//
// First step of the patient-centric prescription flow.
// MA selects a patient (with search) and a provider from the
// clinic's list. Both are stored in the PrescriptionSession
// context and persist throughout the flow.
//
// If the clinic has only one provider, it auto-selects.
// Patient search filters by name as the MA types.

import { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { usePrescriptionSession, type SessionPatient, type SessionProvider } from '../_context/prescription-session'

// ── Types (match server query) ────────────────────────────────

interface Patient {
  patient_id:    string
  first_name:    string
  last_name:     string
  date_of_birth: string
  phone:         string
  state:         string | null
  sms_opt_in:    boolean
}

interface Provider {
  provider_id:    string
  first_name:     string
  last_name:      string
  npi_number:     string
  signature_hash: string | null
}

interface Props {
  patients:  Patient[]
  providers: Provider[]
}

// ── Helpers ───────────────────────────────────────────────────

function formatDob(iso: string): string {
  try {
    const d = new Date(iso + 'T00:00:00')
    return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
  } catch {
    return iso
  }
}

// ── Component ─────────────────────────────────────────────────

export function PatientProviderSelector({ patients, providers }: Props) {
  const router = useRouter()
  const session = usePrescriptionSession()

  const [patientSearch, setPatientSearch] = useState('')
  const [selectedPatientId, setSelectedPatientId] = useState<string>(session.patient?.patient_id ?? '')
  const [selectedProviderId, setSelectedProviderId] = useState<string>(session.provider?.provider_id ?? '')

  // Auto-select provider if only one exists
  useEffect(() => {
    const single = providers.length === 1 ? providers[0] : undefined
    if (single && !selectedProviderId) {
      setSelectedProviderId(single.provider_id)
    }
  }, [providers, selectedProviderId])

  // If session already has patient + provider, pre-select them
  useEffect(() => {
    if (session.patient && !selectedPatientId) {
      setSelectedPatientId(session.patient.patient_id)
    }
    if (session.provider && !selectedProviderId) {
      setSelectedProviderId(session.provider.provider_id)
    }
  }, [session.patient, session.provider, selectedPatientId, selectedProviderId])

  // Filter patients by search query
  const filteredPatients = useMemo(() => {
    if (!patientSearch.trim()) return patients
    const q = patientSearch.toLowerCase().trim()
    return patients.filter(p =>
      `${p.first_name} ${p.last_name}`.toLowerCase().includes(q) ||
      `${p.last_name}, ${p.first_name}`.toLowerCase().includes(q) ||
      p.date_of_birth.includes(q) ||
      (p.phone && p.phone.includes(q))
    )
  }, [patients, patientSearch])

  const selectedPatient = patients.find(p => p.patient_id === selectedPatientId) ?? null
  const selectedProvider = providers.find(p => p.provider_id === selectedProviderId) ?? null

  const canProceed = !!(selectedPatient && selectedProvider)

  function handleContinue() {
    if (!selectedPatient || !selectedProvider) return

    // Store in session context
    session.setPatient({
      patient_id:    selectedPatient.patient_id,
      first_name:    selectedPatient.first_name,
      last_name:     selectedPatient.last_name,
      date_of_birth: selectedPatient.date_of_birth,
      phone:         selectedPatient.phone,
      state:         selectedPatient.state,
      sms_opt_in:    selectedPatient.sms_opt_in,
    })
    session.setProvider({
      provider_id:    selectedProvider.provider_id,
      first_name:     selectedProvider.first_name,
      last_name:      selectedProvider.last_name,
      npi_number:     selectedProvider.npi_number,
      signature_hash: selectedProvider.signature_hash,
    })

    // Navigate to pharmacy search
    router.push('/new-prescription/search')
  }

  // If there's already prescriptions in the session, show option to continue
  const hasExistingSession = session.isSessionStarted && session.prescriptionCount > 0

  return (
    <div className="space-y-6">

      {/* Existing session banner */}
      {hasExistingSession && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
          <p className="text-sm font-medium text-blue-800">
            You have an active session for {session.patient?.first_name} {session.patient?.last_name} with {session.prescriptionCount} prescription{session.prescriptionCount !== 1 ? 's' : ''}.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => router.push('/new-prescription/search')}
              className="min-h-[44px] rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              Continue Adding Prescriptions
            </button>
            <button
              type="button"
              onClick={() => router.push('/new-prescription/review')}
              className="min-h-[44px] rounded-md border border-blue-300 bg-white px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              Review & Send ({session.prescriptionCount})
            </button>
            <button
              type="button"
              onClick={() => {
                session.clearSession()
                setSelectedPatientId('')
                setSelectedProviderId('')
              }}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-blue-600 underline hover:text-blue-800 focus-visible:outline-none"
            >
              Start Over
            </button>
          </div>
        </div>
      )}

      {/* Patient selection */}
      <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Select Patient
        </h2>

        {/* Search input */}
        <div className="mt-3">
          <input
            type="text"
            placeholder="Search by name, DOB, or phone..."
            value={patientSearch}
            onChange={e => setPatientSearch(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Search patients"
          />
        </div>

        {/* Patient list */}
        <div className="mt-3 max-h-60 overflow-y-auto rounded-md border border-border">
          {filteredPatients.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              {patients.length === 0
                ? 'No patients found for this clinic.'
                : 'No patients match your search.'}
            </div>
          ) : (
            filteredPatients.map(patient => (
              <button
                key={patient.patient_id}
                type="button"
                onClick={() => setSelectedPatientId(patient.patient_id)}
                className={`w-full text-left px-4 py-3 border-b border-border last:border-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  selectedPatientId === patient.patient_id
                    ? 'bg-primary/10 border-l-4 border-l-primary'
                    : 'hover:bg-muted/50'
                }`}
                aria-pressed={selectedPatientId === patient.patient_id}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-medium text-foreground">
                      {patient.last_name}, {patient.first_name}
                    </span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      DOB: {formatDob(patient.date_of_birth)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {patient.state && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {patient.state}
                      </span>
                    )}
                    {!patient.state && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                        No state
                      </span>
                    )}
                  </div>
                </div>
                {patient.phone && (
                  <p className="mt-0.5 text-xs text-muted-foreground">{patient.phone}</p>
                )}
              </button>
            ))
          )}
        </div>

        {/* Selected patient summary */}
        {selectedPatient && (
          <div className="mt-3 flex items-center gap-2 rounded-md bg-primary/5 px-3 py-2 text-sm">
            <svg className="h-4 w-4 text-primary" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            <span className="font-medium text-foreground">
              {selectedPatient.first_name} {selectedPatient.last_name}
            </span>
            <span className="text-muted-foreground">
              — {selectedPatient.state ?? 'No state'} — DOB: {formatDob(selectedPatient.date_of_birth)}
            </span>
          </div>
        )}
      </div>

      {/* Provider selection */}
      <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Select Provider
        </h2>

        {providers.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No providers found for this clinic.
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {providers.map(provider => (
              <button
                key={provider.provider_id}
                type="button"
                onClick={() => setSelectedProviderId(provider.provider_id)}
                className={`w-full text-left rounded-md border px-4 py-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  selectedProviderId === provider.provider_id
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:bg-muted/50'
                }`}
                aria-pressed={selectedProviderId === provider.provider_id}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-medium text-foreground">
                      {provider.last_name}, {provider.first_name}
                    </span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      NPI: {provider.npi_number}
                    </span>
                  </div>
                  {selectedProviderId === provider.provider_id && (
                    <svg className="h-5 w-5 text-primary" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </div>
                {!provider.signature_hash && (
                  <p className="mt-1 text-[10px] text-amber-600">No signature on file — will capture during review</p>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Auto-select note */}
        {providers.length === 1 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Auto-selected (only provider in this clinic)
          </p>
        )}
      </div>

      {/* Continue button */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => router.push('/dashboard')}
          className="text-sm text-muted-foreground underline hover:text-foreground focus-visible:outline-none"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleContinue}
          disabled={!canProceed}
          className={`rounded-lg px-6 py-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            canProceed
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : 'bg-muted text-muted-foreground cursor-not-allowed'
          }`}
        >
          Continue to Pharmacy Search
        </button>
      </div>
    </div>
  )
}
