'use client'

// ============================================================
// Batch Review Form — WO-80
// ============================================================
//
// Reviews ALL prescriptions in the current session. The provider
// signs once, and all prescriptions are submitted as DRAFT orders
// then transitioned to AWAITING_PAYMENT in sequence.
//
// Each prescription creates its own order record with its own
// state machine, but they share a single provider signature
// and the patient receives one combined payment notification.

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import SignatureCanvas from 'react-signature-canvas'
import { usePrescriptionSession } from '../../_context/prescription-session'
import { EpcsTotpGate } from '../../_components/epcs-totp-gate'
import { DrugInteractionAlerts } from '../../_components/drug-interaction-alerts'

// ── Helpers ───────────────────────────────────────────────────

function toCurrency(cents: number): string {
  return '$' + (cents / 100).toFixed(2)
}

function calcPlatformFeeCents(marginCents: number): number {
  return Math.round(marginCents * 15 / 100)
}

// ── Component ─────────────────────────────────────────────────

export function BatchReviewForm() {
  const router = useRouter()
  const session = usePrescriptionSession()
  const sigCanvasRef = useRef<SignatureCanvas>(null)

  const [signatureCaptured, setSignatureCaptured] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitProgress, setSubmitProgress] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [showEpcsGate, setShowEpcsGate] = useState(false)

  // Redirect if no session or no prescriptions
  useEffect(() => {
    if (!session.isSessionStarted) {
      router.replace('/new-prescription')
    }
  }, [session.isSessionStarted, router])

  if (!session.patient || !session.provider || session.prescriptions.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <p className="text-muted-foreground">No prescriptions in this session.</p>
        <button
          type="button"
          onClick={() => router.push('/new-prescription/search')}
          className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Add a Prescription
        </button>
      </div>
    )
  }

  const { patient, provider, prescriptions } = session

  // Calculate totals
  const totalRetailCents = prescriptions.reduce((sum, rx) => sum + rx.retailCents, 0)
  const totalWholesaleCents = prescriptions.reduce((sum, rx) => sum + rx.wholesaleCents, 0)
  const totalMarginCents = totalRetailCents - totalWholesaleCents
  const totalPlatformFeeCents = prescriptions.reduce((sum, rx) => {
    const margin = rx.retailCents - rx.wholesaleCents
    return sum + calcPlatformFeeCents(margin)
  }, 0)
  const totalClinicPayoutCents = totalMarginCents - totalPlatformFeeCents

  function handleClearSignature() {
    sigCanvasRef.current?.clear()
    setSignatureCaptured(false)
  }

  const canSubmit = signatureCaptured && prescriptions.length > 0 && !isSubmitting

  // ── Sign & Send all prescriptions ──────────────────────────
  async function handleSignAndSend() {
    if (!sigCanvasRef.current || sigCanvasRef.current.isEmpty()) return
    if (!patient || !provider) return

    setIsSubmitting(true)
    setSubmitError(null)
    setConfirmOpen(false)

    try {
      const signatureDataUrl = sigCanvasRef.current.toDataURL('image/png')
      const totalCount = prescriptions.length
      let sentCount = 0

      for (let i = 0; i < prescriptions.length; i++) {
        const rx = prescriptions[i]!
        setSubmitProgress(`Creating order ${i + 1} of ${totalCount}...`)

        // Step 1: Create DRAFT order
        const orderRes = await fetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            patientId:     patient.patient_id,
            providerId:    provider.provider_id,
            // WO-87: send whichever ID this rx came from (catalog or formulation)
            catalogItemId: rx.itemId,
            formulationId: rx.formulationId,
            pharmacyId:    rx.pharmacyId,
            retailCents:   rx.retailCents,
            sigText:       rx.sigText,
            patientState:  patient.state ?? '',
          }),
        })

        if (!orderRes.ok) {
          const err = await orderRes.json()
          // BLK-01 fix: Remove successfully sent prescriptions from session
          // so retry won't duplicate them
          throw new Error(
            `Order ${i + 1} (${rx.medicationName}) failed: ${err.error ?? 'Unknown error'}` +
            (sentCount > 0 ? `. ${sentCount} of ${totalCount} already sent successfully.` : '')
          )
        }

        const { orderId } = await orderRes.json() as { orderId: string }

        // Step 2: Sign & Send
        setSubmitProgress(`Signing order ${i + 1} of ${totalCount}...`)

        const sendRes = await fetch(`/api/orders/${orderId}/sign-and-send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ signatureDataUrl }),
        })

        if (!sendRes.ok) {
          const err = await sendRes.json()
          throw new Error(
            `Sign & send for order ${i + 1} (${rx.medicationName}) failed: ${err.error ?? 'Unknown error'}` +
            (sentCount > 0 ? `. ${sentCount} of ${totalCount} already sent successfully.` : '')
          )
        }

        // BLK-01 fix: This prescription succeeded — remove it from the session
        // so if a later prescription fails, retrying won't re-submit this one
        session.removePrescription(rx.id)
        sentCount++
      }

      // Navigate to dashboard FIRST, then clear session.
      // Order matters: clearSession() triggers SessionBanner's redirect to
      // /new-prescription via useEffect. Navigating first prevents the race.
      setSubmitProgress(null)
      router.push(`/dashboard?sent=${totalCount}`)

      // Clear session after a tick to avoid the SessionBanner redirect race
      setTimeout(() => session.clearSession(), 100)

    } catch (err) {
      const msg = err instanceof Error ? err.message : 'An unexpected error occurred'
      setSubmitError(msg)
      setSubmitProgress(null)
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">

      {/* WO-86: Controlled substance banner */}
      {prescriptions.some(rx => rx.deaSchedule && rx.deaSchedule >= 2) && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950/20">
          <p className="text-sm font-semibold text-red-800 dark:text-red-200">
            Controlled Substance — EPCS 2FA Required
          </p>
          <p className="mt-1 text-xs text-red-700 dark:text-red-300">
            This session contains DEA-scheduled medications. Two-factor authentication via authenticator app
            will be required at signing per DEA 21 CFR 1311.
          </p>
        </div>
      )}

      {/* WO-86: Drug Interaction Alerts */}
      <DrugInteractionAlerts medicationNames={prescriptions.map(rx => rx.medicationName)} />

      {/* Prescription list */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Prescriptions ({prescriptions.length})
        </h2>

        {prescriptions.map((rx, index) => {
          const marginCents = rx.retailCents - rx.wholesaleCents
          const platformFeeCents = calcPlatformFeeCents(marginCents)
          const clinicMarginCents = marginCents - platformFeeCents

          return (
            <div key={rx.id} className="rounded-lg border border-border bg-card p-4 shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {index + 1}. {rx.medicationName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {rx.form} — {rx.dose} — {rx.pharmacyName}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground italic">
                    Sig: {rx.sigText}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-foreground">{toCurrency(rx.retailCents)}</p>
                  <p className="text-[10px] text-muted-foreground">
                    Wholesale: {toCurrency(rx.wholesaleCents)}
                  </p>
                  <p className="text-[10px] text-emerald-600">
                    Clinic margin: {toCurrency(clinicMarginCents)}
                  </p>
                </div>
              </div>
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => session.removePrescription(rx.id)}
                  disabled={isSubmitting}
                  className="text-[10px] text-red-500 underline hover:text-red-700 disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Add another button */}
      <button
        type="button"
        onClick={() => router.push('/new-prescription/search')}
        disabled={isSubmitting}
        className="w-full rounded-md border-2 border-dashed border-border px-4 py-3 text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
      >
        + Add Another Prescription
      </button>

      {/* Totals */}
      <div className="rounded-lg border border-border bg-muted/30 p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Total ({prescriptions.length} prescription{prescriptions.length !== 1 ? 's' : ''})</span>
          <span className="text-lg font-bold text-foreground">{toCurrency(totalRetailCents)}</span>
        </div>
        <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>Platform fee (15%)</span>
          <span>{toCurrency(totalPlatformFeeCents)}</span>
        </div>
        <div className="flex items-center justify-between text-xs text-emerald-600 font-medium">
          <span>Total clinic payout</span>
          <span>{toCurrency(totalClinicPayoutCents)}</span>
        </div>
      </div>

      {/* Provider signature */}
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Provider Signature — {provider.first_name} {provider.last_name}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          NPI: {provider.npi_number} — Signing {prescriptions.length} prescription{prescriptions.length !== 1 ? 's' : ''} for {patient.first_name} {patient.last_name}
        </p>

        <div className="mt-3 rounded-lg border border-border bg-white">
          {/*
           * Fire "captured" on BOTH pointerdown (onBegin) and pointerup
           * (onEnd). Kept consistent with draft-sign-form (F5 fix) so
           * both signature surfaces behave identically. See draft-
           * sign-form.tsx for the full F5 root-cause TODO.
           */}
          <SignatureCanvas
            ref={sigCanvasRef}
            canvasProps={{
              className: 'w-full h-32 rounded-lg',
              'aria-label': 'Provider signature pad',
            }}
            onBegin={() => setSignatureCaptured(true)}
            onEnd={() => setSignatureCaptured(true)}
          />
        </div>

        <div className="mt-2 flex items-center justify-between">
          <button
            type="button"
            onClick={handleClearSignature}
            disabled={isSubmitting}
            className="text-xs text-muted-foreground underline hover:text-foreground disabled:opacity-50"
          >
            Clear Signature
          </button>
          {signatureCaptured && (
            <span className="text-xs text-emerald-600 font-medium">Signature captured</span>
          )}
        </div>
      </div>

      {/* Error display */}
      {submitError && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {submitError}
        </div>
      )}

      {/* Progress display */}
      {submitProgress && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
          {submitProgress}
        </div>
      )}

      {/* Confirm dialog */}
      {confirmOpen && (
        <div className="rounded-lg border-2 border-primary bg-primary/5 p-4">
          <p className="text-sm font-medium text-foreground">
            You are about to send {prescriptions.length} payment link{prescriptions.length !== 1 ? 's' : ''} totaling{' '}
            <strong>{toCurrency(totalRetailCents)}</strong> to{' '}
            <strong>{patient.first_name} {patient.last_name}</strong> at <strong>{patient.phone || 'no phone'}</strong>.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            The link{prescriptions.length !== 1 ? 's' : ''} will expire in 72 hours. Once sent, all prescriptions are locked and cannot be edited.
          </p>
          <div className="mt-3 flex gap-3">
            <button
              type="button"
              onClick={() => {
                // WO-86: Check for controlled substances → require EPCS 2FA
                const controlled = prescriptions.filter(rx => rx.deaSchedule && rx.deaSchedule >= 2)
                if (controlled.length > 0) {
                  setShowEpcsGate(true)
                } else {
                  handleSignAndSend()
                }
              }}
              disabled={isSubmitting}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {isSubmitting ? 'Sending...' : 'Confirm & Send'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmOpen(false)}
              disabled={isSubmitting}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Sign & Send button */}
      {!confirmOpen && (
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          disabled={!canSubmit}
          className={`w-full rounded-lg px-6 py-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            canSubmit
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : 'bg-muted text-muted-foreground cursor-not-allowed'
          }`}
        >
          Sign & Send {prescriptions.length > 1 ? `All ${prescriptions.length} Prescriptions` : 'Payment Link'}
        </button>
      )}
      {/* WO-86: EPCS 2FA Gate for controlled substances */}
      {showEpcsGate && (
        <EpcsTotpGate
          providerId={provider.provider_id}
          providerName={`${provider.first_name} ${provider.last_name}`}
          medicationNames={
            prescriptions
              .filter(rx => rx.deaSchedule && rx.deaSchedule >= 2)
              .map(rx => rx.medicationName)
          }
          deaSchedules={
            prescriptions
              .filter(rx => rx.deaSchedule && rx.deaSchedule >= 2)
              .map(rx => rx.deaSchedule)
          }
          onVerified={() => {
            setShowEpcsGate(false)
            handleSignAndSend()
          }}
          onCancel={() => setShowEpcsGate(false)}
        />
      )}
    </div>
  )
}
