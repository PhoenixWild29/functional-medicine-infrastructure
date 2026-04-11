'use client'

// ============================================================
// Prescription Session Context — WO-80
// ============================================================
//
// Manages the patient-centric prescription session. Stores the
// selected patient, selected provider, and a list of configured
// prescriptions (pharmacy + price + sig) that accumulate as the
// MA works through the flow.
//
// The session persists across route navigations within the
// /new-prescription/* pages via React context + sessionStorage
// backup (for browser refresh resilience).
//
// Lifecycle:
//   1. MA selects patient + provider → stored in context
//   2. MA searches pharmacy, sets price, adds prescription → pushed to list
//   3. MA can add more prescriptions or proceed to batch review
//   4. Provider signs all prescriptions at once → session cleared

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'

// ── Types ─────────────────────────────────────────────────────

export interface SessionPatient {
  patient_id:    string
  first_name:    string
  last_name:     string
  date_of_birth: string
  phone:         string
  state:         string | null
  sms_opt_in:    boolean
}

export interface SessionProvider {
  provider_id:    string
  first_name:     string
  last_name:      string
  npi_number:     string
  signature_hash: string | null
}

export interface SessionPrescription {
  id:              string   // client-side UUID for list key
  pharmacyId:      string
  pharmacyName:    string
  // WO-87: itemId is the legacy flat catalog ID; formulationId is the V3.0
  // hierarchical catalog ID. Exactly one must be set per prescription.
  itemId:          string | null
  formulationId:   string | null
  medicationName:  string
  form:            string
  dose:            string
  wholesaleCents:  number   // HC-01: integer cents (wholesale_price * 100)
  deaSchedule:     number | null
  retailCents:     number   // integer cents
  sigText:         string
  integrationTier: string
}

interface PrescriptionSessionState {
  patient:       SessionPatient | null
  provider:      SessionProvider | null
  prescriptions: SessionPrescription[]
}

interface PrescriptionSessionContextValue extends PrescriptionSessionState {
  /** Set the patient for this session (step 1) */
  setPatient:         (patient: SessionPatient) => void
  /** Set the provider for this session (step 1) */
  setProvider:        (provider: SessionProvider) => void
  /** Add a configured prescription to the session */
  addPrescription:    (rx: Omit<SessionPrescription, 'id'>) => void
  /** Remove a prescription by its client-side ID */
  removePrescription: (id: string) => void
  /** Clear the entire session (after successful send or cancel) */
  clearSession:       () => void
  /** Whether patient + provider are both selected */
  isSessionStarted:   boolean
  /** Number of prescriptions added so far */
  prescriptionCount:  number
}

// ── Storage key ───────────────────────────────────────────────

const STORAGE_KEY = 'compoundiq-rx-session'

function generateId(): string {
  return crypto.randomUUID()
}

// ── Default state ─────────────────────────────────────────────

const EMPTY_STATE: PrescriptionSessionState = {
  patient: null,
  provider: null,
  prescriptions: [],
}

// ── Context ───────────────────────────────────────────────────

const PrescriptionSessionContext = createContext<PrescriptionSessionContextValue | null>(null)

// ── Provider component ────────────────────────────────────────

export function PrescriptionSessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PrescriptionSessionState>(EMPTY_STATE)

  // Restore from sessionStorage on mount
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved) as PrescriptionSessionState
        if (parsed.patient && parsed.provider) {
          setState(parsed)
        }
      }
    } catch { /* ignore corrupt storage */ }
  }, [])

  // Persist to sessionStorage on every state change
  useEffect(() => {
    try {
      if (state.patient || state.prescriptions.length > 0) {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state))
      } else {
        sessionStorage.removeItem(STORAGE_KEY)
      }
    } catch { /* ignore */ }
  }, [state])

  const setPatient = useCallback((patient: SessionPatient) => {
    setState(prev => ({ ...prev, patient }))
  }, [])

  const setProvider = useCallback((provider: SessionProvider) => {
    setState(prev => ({ ...prev, provider }))
  }, [])

  const addPrescription = useCallback((rx: Omit<SessionPrescription, 'id'>) => {
    setState(prev => ({
      ...prev,
      prescriptions: [...prev.prescriptions, { ...rx, id: generateId() }],
    }))
  }, [])

  const removePrescription = useCallback((id: string) => {
    setState(prev => ({
      ...prev,
      prescriptions: prev.prescriptions.filter(rx => rx.id !== id),
    }))
  }, [])

  const clearSession = useCallback(() => {
    setState(EMPTY_STATE)
    try { sessionStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
  }, [])

  const value: PrescriptionSessionContextValue = {
    ...state,
    setPatient,
    setProvider,
    addPrescription,
    removePrescription,
    clearSession,
    isSessionStarted: !!(state.patient && state.provider),
    prescriptionCount: state.prescriptions.length,
  }

  return (
    <PrescriptionSessionContext.Provider value={value}>
      {children}
    </PrescriptionSessionContext.Provider>
  )
}

// ── Hook ──────────────────────────────────────────────────────

export function usePrescriptionSession(): PrescriptionSessionContextValue {
  const ctx = useContext(PrescriptionSessionContext)
  if (!ctx) {
    throw new Error('usePrescriptionSession must be used within PrescriptionSessionProvider')
  }
  return ctx
}
