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
import type { RxDetails, RxRules } from '@/lib/orders/rx-details'

// ── Types ─────────────────────────────────────────────────────

export interface SessionPatient {
  patient_id:    string
  first_name:    string
  last_name:     string
  date_of_birth: string
  phone:         string
  state:         string | null
  sms_opt_in:    boolean
  // WO-97: allergies live on the patient and ride along in the session
  // so the banner chip and the Review notice need no extra fetch.
  // OPTIONAL ON PURPOSE — sessions persisted in sessionStorage before
  // WO-97 have neither; the banner hydrates them from
  // GET /api/patients/[id]/allergies when `allergies` is undefined.
  allergies?:            string[] | null
  nkda?:                 boolean
  allergies_updated_at?: string | null
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
  // GAP-3: set when this line was quick-loaded from a protocol, so the
  // order-creation API can link the order to a protocol_instance +
  // published protocol version. Ad-hoc and favorite loads leave it
  // unset. OPTIONAL ON PURPOSE — sessions persisted in sessionStorage
  // before this field existed parse and submit exactly as before.
  protocolId?:     string | null
  // Display-only companion to protocolId (never sent to the API).
  protocolName?:   string | null
  // WO-96: per-Rx detail fields (days supply, dispense, refills,
  // substitution, syringe kit, shipping, clinical difference, diagnosis,
  // special instructions) and the rules that govern them (controlled →
  // diagnosis, requires_clinical_difference → statement). Set by the
  // margin builder; lines that enter the session another way (protocol
  // quick-load, favorites, sessions persisted before WO-96) leave both
  // unset and the Review card resolves them from
  // /api/formulations?level=rx_defaults. OPTIONAL ON PURPOSE.
  rxDetails?:      RxDetails | null
  rxRules?:        RxRules | null
  // WO-96: structured inputs the details were derived from. Display and
  // re-derivation only — never sent to the API.
  frequencyCode?:  string | null
  quantityLabel?:  string | null
  // WO-101: the package (vial size) the line is priced from. packageId is
  // sent to POST /api/orders, which re-prices from it server-side; the
  // label is for display. Unset for single-package formulations and the
  // legacy catalog. OPTIONAL ON PURPOSE.
  packageId?:      string | null
  packageLabel?:   string | null
  // WO-103: formulation concentration so the Review card can show the
  // computed mg equivalent next to the dose ("10 units (0.5 mg)").
  // Display only — never sent to the API. OPTIONAL ON PURPOSE.
  concentrationValue?: number | null
  concentrationUnit?:  string | null
}

/**
 * A non-blocking report produced by a quick-load that only PARTIALLY
 * succeeded — e.g. a protocol whose licensed items loaded while items
 * pinned to a pharmacy unlicensed in the patient's state were skipped.
 *
 * Notices live on the session (not on a route param) so the report
 * survives the navigation to the review step, which is where the
 * provider actually sees the loaded lines.
 *
 * OPTIONAL ON PURPOSE: sessions persisted in sessionStorage before this
 * field existed parse and submit exactly as before — restore normalises
 * a missing `notices` array to [].
 */
export interface SessionLoadNotice {
  id:             string   // client-side UUID for list key
  /** Protocol the quick-load came from. Display only. */
  protocolName:   string | null
  /** Patient shipping state the licensure check ran against. */
  patientState:   string | null
  /** How many lines actually entered the session. */
  loadedCount:    number
  /** How many lines the source protocol contains in total. */
  totalCount:     number
  /** One human-readable message per item skipped by the licensure guard. */
  skipped:        string[]
  /** Names of items that were already in the session (idempotent re-load). */
  alreadyPresent: string[]
}

interface PrescriptionSessionState {
  patient:       SessionPatient | null
  provider:      SessionProvider | null
  prescriptions: SessionPrescription[]
  notices:       SessionLoadNotice[]
}

interface PrescriptionSessionContextValue extends PrescriptionSessionState {
  /** Set the patient for this session (step 1) */
  setPatient:         (patient: SessionPatient) => void
  /** Set the provider for this session (step 1) */
  setProvider:        (provider: SessionProvider) => void
  /**
   * Patch the session patient in place (WO-97: allergies saved from the
   * banner chip or the Review notice). No-op when no patient is set.
   */
  updatePatient:      (patch: Partial<Omit<SessionPatient, 'patient_id'>>) => void
  /** Add a configured prescription to the session */
  addPrescription:    (rx: Omit<SessionPrescription, 'id'>) => void
  /**
   * Add several prescriptions at once, skipping any line already in the
   * session. Used by the protocol quick-load so loading the same
   * protocol twice can never duplicate its lines.
   */
  addPrescriptions:   (list: Omit<SessionPrescription, 'id'>[]) => void
  /** Remove a prescription by its client-side ID */
  removePrescription: (id: string) => void
  /**
   * Patch a prescription in place (WO-96 Rx details edits on the Review
   * card; WO-98 edit-at-review builds on the same primitive). Unknown ids
   * are ignored.
   */
  updatePrescription: (id: string, patch: Partial<Omit<SessionPrescription, 'id'>>) => void
  /** Record a partial-load report to show on the review step */
  addNotice:          (notice: Omit<SessionLoadNotice, 'id'>) => void
  /** Dismiss a partial-load report by its client-side ID */
  dismissNotice:      (id: string) => void
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
  // crypto.randomUUID is available in every browser we support, but not
  // in every test environment — fall back rather than throw.
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch { /* fall through */ }
  return `rx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Identity of a prescription line for duplicate detection.
 *
 * Two lines are "the same prescription" when they route the same
 * medication to the same pharmacy with the same dose and the same
 * directions. Retail price is deliberately NOT part of the signature:
 * re-loading a protocol after a markup change must still be recognised
 * as the same line rather than silently added twice.
 */
export function prescriptionSignature(rx: {
  itemId:        string | null
  formulationId: string | null
  pharmacyId:    string
  dose:          string
  sigText:       string
}): string {
  return [
    rx.formulationId ?? rx.itemId ?? '',
    rx.pharmacyId,
    rx.dose.trim().toLowerCase(),
    rx.sigText.trim().toLowerCase(),
  ].join('|')
}

// ── Default state ─────────────────────────────────────────────

const EMPTY_STATE: PrescriptionSessionState = {
  patient: null,
  provider: null,
  prescriptions: [],
  notices: [],
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
        // Partial<> on purpose: payloads written by older builds have no
        // `notices` (and, older still, no `protocolId` on lines). Normalise
        // rather than trust the shape, so old sessions keep working.
        const parsed = JSON.parse(saved) as Partial<PrescriptionSessionState>
        if (parsed.patient && parsed.provider) {
          setState({
            patient:       parsed.patient,
            provider:      parsed.provider,
            prescriptions: parsed.prescriptions ?? [],
            notices:       parsed.notices ?? [],
          })
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

  const updatePatient = useCallback((patch: Partial<Omit<SessionPatient, 'patient_id'>>) => {
    setState(prev => {
      if (!prev.patient) return prev
      return { ...prev, patient: { ...prev.patient, ...patch, patient_id: prev.patient.patient_id } }
    })
  }, [])

  const addPrescription = useCallback((rx: Omit<SessionPrescription, 'id'>) => {
    setState(prev => ({
      ...prev,
      prescriptions: [...prev.prescriptions, { ...rx, id: generateId() }],
    }))
  }, [])

  const addPrescriptions = useCallback((list: Omit<SessionPrescription, 'id'>[]) => {
    setState(prev => {
      // Dedupe inside the reducer so a double-click (two calls before the
      // first re-render) can't slip a duplicate past the caller's check.
      const seen = new Set(prev.prescriptions.map(prescriptionSignature))
      const additions: SessionPrescription[] = []
      for (const rx of list) {
        const signature = prescriptionSignature(rx)
        if (seen.has(signature)) continue
        seen.add(signature)
        additions.push({ ...rx, id: generateId() })
      }
      if (additions.length === 0) return prev
      return { ...prev, prescriptions: [...prev.prescriptions, ...additions] }
    })
  }, [])

  const removePrescription = useCallback((id: string) => {
    setState(prev => ({
      ...prev,
      prescriptions: prev.prescriptions.filter(rx => rx.id !== id),
    }))
  }, [])

  const updatePrescription = useCallback((id: string, patch: Partial<Omit<SessionPrescription, 'id'>>) => {
    setState(prev => {
      const index = prev.prescriptions.findIndex(rx => rx.id === id)
      if (index === -1) return prev
      const next = [...prev.prescriptions]
      next[index] = { ...next[index]!, ...patch, id }
      return { ...prev, prescriptions: next }
    })
  }, [])

  const addNotice = useCallback((notice: Omit<SessionLoadNotice, 'id'>) => {
    setState(prev => ({
      ...prev,
      notices: [...prev.notices, { ...notice, id: generateId() }],
    }))
  }, [])

  const dismissNotice = useCallback((id: string) => {
    setState(prev => ({
      ...prev,
      notices: prev.notices.filter(notice => notice.id !== id),
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
    updatePatient,
    addPrescription,
    addPrescriptions,
    removePrescription,
    updatePrescription,
    addNotice,
    dismissNotice,
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
