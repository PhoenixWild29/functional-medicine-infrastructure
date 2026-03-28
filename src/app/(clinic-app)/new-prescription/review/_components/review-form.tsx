'use client'

// ============================================================
// Review Form — WO-29
// ============================================================
//
// REQ-OAS-001: Draft order creation via POST /api/orders.
// REQ-OAS-003: Provider digital signature capture with SHA-256 hash.
// REQ-OAS-005: Compliance check display — CTA disabled until all 6 pass.
// REQ-OAS-006: "Sign & Send Payment Link" CTA with confirmation dialog.
// REQ-OAS-007: SMS dispatch via POST /api/orders/[id]/sign-and-send.
// REQ-OAS-008: Zero PHI in Stripe — enforced server-side.
// REQ-OAS-009: Race condition prevention — CAS in API.
// REQ-OAS-011: HIPAA timeout is injected by the parent Server Component.

import { useState, useRef, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import SignatureCanvas from 'react-signature-canvas'
import type { IntegrationTierEnum } from '@/types/database.types'
import type { ComplianceCheckResult } from '@/app/api/orders/compliance-check/route'

// ── Cent helpers ──────────────────────────────────────────────
function toCurrency(cents: number): string {
  return (cents / 100).toFixed(2)
}

// ── Props ─────────────────────────────────────────────────────
interface Patient {
  patient_id:   string
  first_name:   string
  last_name:    string
  date_of_birth: string
  phone:        string
  state:        string | null
  sms_opt_in:   boolean
}

interface Provider {
  provider_id:    string
  first_name:     string
  last_name:      string
  npi_number:     string
  signature_hash: string | null
}

interface Props {
  pharmacyId:    string
  itemId:        string
  pharmacyName:  string
  // NB-09: pharmacyTier removed — unused prop (tier is reflected via deaSchedule badge)
  medicationName: string
  form:          string
  dose:          string
  wholesalePrice: number
  deaSchedule:   number
  retailCents:   number
  sigText:       string
  patients:      Patient[]
  providers:     Provider[]
}

export function ReviewForm({
  pharmacyId,
  itemId,
  pharmacyName,
  // pharmacyTier omitted — removed from Props (NB-09)
  medicationName,
  form,
  dose,
  wholesalePrice,
  deaSchedule,
  retailCents,
  sigText,
  patients,
  providers,
}: Props) {
  const router = useRouter()
  const sigCanvasRef = useRef<SignatureCanvas | null>(null)

  const [selectedPatientId,  setSelectedPatientId]  = useState('')
  const [selectedProviderId, setSelectedProviderId] = useState('')
  const [complianceChecks,   setComplianceChecks]   = useState<ComplianceCheckResult[] | null>(null)
  const [isLoadingChecks,    setIsLoadingChecks]     = useState(false)
  const [signatureCaptured,  setSignatureCaptured]   = useState(false)
  const [confirmOpen,        setConfirmOpen]         = useState(false)
  const [isSubmitting,       setIsSubmitting]        = useState(false)
  const [submitError,        setSubmitError]         = useState<string | null>(null)

  const wholesaleCents = Math.round(wholesalePrice * 100)
  const marginCents    = retailCents - wholesaleCents
  const platformCents  = Math.round(marginCents * 15 / 100)
  const clinicCents    = marginCents - platformCents

  const selectedPatient  = patients.find(p => p.patient_id === selectedPatientId)
  const selectedProvider = providers.find(p => p.provider_id === selectedProviderId)

  // ── Run compliance checks when patient + provider are selected ──
  const runChecks = useCallback(async (patientId: string, providerId: string) => {
    if (!patientId || !providerId) {
      setComplianceChecks(null)
      return
    }
    setIsLoadingChecks(true)
    try {
      // BLK-06: pass retailCents so check 4 (retail >= wholesale) can be evaluated
      const params = new URLSearchParams({ patientId, providerId, pharmacyId, itemId, retailCents: retailCents.toString() })
      const res = await fetch(`/api/orders/compliance-check?${params}`)
      if (!res.ok) throw new Error(`Compliance check failed: ${res.status}`)
      const data = await res.json() as { checks: ComplianceCheckResult[] }
      setComplianceChecks(data.checks)
    } catch (err) {
      console.error('[review-form] compliance check error:', err)
      setComplianceChecks(null)
    } finally {
      setIsLoadingChecks(false)
    }
  }, [pharmacyId, itemId, retailCents])  // NB-2: retailCents is used in params — must be a dep

  useEffect(() => {
    if (selectedPatientId && selectedProviderId) {
      void runChecks(selectedPatientId, selectedProviderId)
    } else {
      setComplianceChecks(null)
    }
  }, [selectedPatientId, selectedProviderId, runChecks])

  // provider_signature check is gated by signatureCaptured (canvas) not the DB hash —
  // the DB hash is only written AFTER sign-and-send, so checking it upfront is circular.
  const nonSigChecks = complianceChecks?.filter(c => c.id !== 'provider_signature') ?? []
  const allChecksPassed = complianceChecks !== null &&
    nonSigChecks.length > 0 &&
    nonSigChecks.every(c => c.passed) &&
    signatureCaptured

  // BLK-05: reset signature when provider changes to prevent stale sig being submitted
  useEffect(() => {
    sigCanvasRef.current?.clear()
    setSignatureCaptured(false)
  }, [selectedProviderId])

  // ── Sign & Send flow ──────────────────────────────────────────
  async function handleSignAndSend() {
    // BLK-04: explicit guard with user-visible error rather than silent abort
    if (!selectedPatient || !selectedProvider) {
      setSubmitError('Please select a patient and provider.')
      return
    }
    if (!allChecksPassed) return
    if (!sigCanvasRef.current || sigCanvasRef.current.isEmpty()) return

    setIsSubmitting(true)
    setSubmitError(null)

    try {
      const signatureDataUrl = sigCanvasRef.current.toDataURL('image/png')

      // Step 1: Create DRAFT order
      const orderRes = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientId:     selectedPatientId,
          providerId:    selectedProviderId,
          catalogItemId: itemId,
          pharmacyId,
          retailCents,
          sigText,
          patientState:  selectedPatient?.state ?? '',
        }),
      })

      if (!orderRes.ok) {
        const err = await orderRes.json()
        throw new Error(err.error ?? 'Failed to create order')
      }

      const { orderId } = await orderRes.json() as { orderId: string }

      // Step 2: Sign & Send
      const sendRes = await fetch(`/api/orders/${orderId}/sign-and-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signatureDataUrl }),
      })

      if (!sendRes.ok) {
        const err = await sendRes.json()
        throw new Error(err.error ?? 'Failed to send payment link')
      }

      // Success — navigate to dashboard
      router.push('/dashboard?sent=1')

    } catch (err) {
      const msg = err instanceof Error ? err.message : 'An unexpected error occurred'
      setSubmitError(msg)
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">

      {/* ── Prescription summary ── */}
      <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Prescription Summary
        </p>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-semibold text-foreground">{medicationName}</p>
            <p className="text-sm text-muted-foreground">{form} · {dose}</p>
            <p className="text-xs text-muted-foreground mt-0.5">via {pharmacyName}</p>
            {deaSchedule >= 2 && (
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-red-100 text-red-800 mt-1">
                DEA Sch. {deaSchedule} — Fax only
              </span>
            )}
          </div>
          <div className="text-right shrink-0 space-y-0.5 text-sm">
            <p className="text-lg font-bold text-foreground">${toCurrency(retailCents)}</p>
            <p className="text-muted-foreground">Wholesale: ${toCurrency(wholesaleCents)}</p>
            <p className="text-muted-foreground">Platform fee: ${toCurrency(platformCents)}</p>
            <p className="font-medium text-emerald-600">Your margin: ${toCurrency(clinicCents)}</p>
          </div>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">Sig</p>
          <p className="text-sm text-foreground">{sigText}</p>
        </div>
      </div>

      {/* ── Patient selector ── */}
      <div className="space-y-1">
        <label htmlFor="patient-select" className="block text-sm font-medium text-foreground">
          Patient <span className="text-destructive">*</span>
        </label>
        {patients.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No active patients found.{' '}
            <a href="/patients/new" className="text-primary underline">Add a patient</a>.
          </p>
        ) : (
          <select
            id="patient-select"
            value={selectedPatientId}
            onChange={e => setSelectedPatientId(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">Select patient…</option>
            {patients.map(p => (
              // NB-05: flag patients with no state — compliance check 1 will fail for them
              <option key={p.patient_id} value={p.patient_id}>
                {p.last_name}, {p.first_name} — DOB {p.date_of_birth}
                {p.state ? ` — ${p.state}` : ' — ⚠ No shipping state on file'}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* ── Provider selector ── */}
      <div className="space-y-1">
        <label htmlFor="provider-select" className="block text-sm font-medium text-foreground">
          Prescribing Provider <span className="text-destructive">*</span>
        </label>
        {providers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No active providers found.{' '}
            <a href="/providers/new" className="text-primary underline">Add a provider</a>.
          </p>
        ) : (
          <select
            id="provider-select"
            value={selectedProviderId}
            onChange={e => setSelectedProviderId(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">Select provider…</option>
            {providers.map(p => (
              <option key={p.provider_id} value={p.provider_id}>
                {p.last_name}, {p.first_name} — NPI {p.npi_number}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* ── Compliance checks ── */}
      {selectedPatientId && selectedProviderId && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Pre-Dispatch Compliance Checks
          </p>
          {isLoadingChecks && (
            <p className="text-sm text-muted-foreground">Running compliance checks…</p>
          )}
          {!isLoadingChecks && complianceChecks && (
            <ul className="space-y-1.5">
              {complianceChecks.map(check => (
                <li key={check.id} className="flex items-start gap-2 text-sm">
                  <span aria-hidden className={`mt-0.5 text-base ${check.passed ? 'text-emerald-500' : 'text-destructive'}`}>
                    {check.passed ? '✓' : '✗'}
                  </span>
                  <span className={check.passed ? 'text-foreground' : 'text-destructive font-medium'}>
                    {check.label}
                    {check.message && (
                      <span className="block text-xs text-destructive font-normal">{check.message}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ── Provider signature canvas — REQ-OAS-003 ── */}
      {complianceChecks && complianceChecks.filter(c => c.id !== 'provider_signature').every(c => c.passed) && (
        <div className="space-y-2">
          <label className="block text-sm font-medium text-foreground">
            Provider Signature <span className="text-destructive">*</span>
          </label>
          <p className="text-xs text-muted-foreground">
            Sign below using your mouse or touch. This signature confirms you are prescribing this compounded medication.
          </p>
          <div className="rounded-md border border-input overflow-hidden bg-white">
            <SignatureCanvas
              ref={sigCanvasRef}
              penColor="black"
              canvasProps={{ className: 'w-full', height: 160, 'aria-label': 'Provider signature pad' }}
              onEnd={() => setSignatureCaptured(true)}
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                sigCanvasRef.current?.clear()
                setSignatureCaptured(false)
              }}
              className="text-sm text-muted-foreground underline hover:text-foreground"
            >
              Clear signature
            </button>
            {signatureCaptured && (
              <span className="text-sm text-emerald-600">✓ Signature captured</span>
            )}
          </div>
        </div>
      )}

      {/* ── Confirmation dialog — REQ-OAS-006 ── */}
      {confirmOpen && selectedPatient && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-title"
          aria-describedby="confirm-desc"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <div className="w-full max-w-md rounded-lg bg-card border border-border p-6 shadow-xl space-y-4">
            <h2 id="confirm-title" className="text-lg font-semibold text-foreground">
              Confirm & Send
            </h2>
            {/* NB-06: aria-describedby references this paragraph for screen readers */}
            <p id="confirm-desc" className="text-sm text-foreground">
              You are about to send a{' '}
              <strong>${toCurrency(retailCents)}</strong> payment link to{' '}
              <strong>{selectedPatient.first_name} {selectedPatient.last_name}</strong>{' '}
              at <strong>{selectedPatient.phone}</strong>.
            </p>
            <p className="text-xs text-muted-foreground">
              The link will expire in 72 hours. Once sent, the prescription is locked and cannot be edited.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={isSubmitting}
                className="px-4 py-2 rounded-md border border-input text-sm hover:bg-accent disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSignAndSend}
                disabled={isSubmitting}
                className="px-4 py-2 rounded-md bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? 'Sending…' : 'Confirm & Send'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Error display ── */}
      {submitError && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
          {submitError}
        </div>
      )}

      {/* ── Sign & Send CTA — REQ-OAS-006 ── */}
      <button
        type="button"
        disabled={!allChecksPassed || isSubmitting}
        onClick={() => setConfirmOpen(true)}
        className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Sign & Send Payment Link
      </button>

      {!allChecksPassed && selectedPatientId && selectedProviderId && (
        <p className="text-xs text-center text-muted-foreground">
          {complianceChecks && complianceChecks.some(c => !c.passed)
            ? 'Resolve compliance issues above to continue.'
            : 'Provide your signature above to continue.'}
        </p>
      )}
    </div>
  )
}
