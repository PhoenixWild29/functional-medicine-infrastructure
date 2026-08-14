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
//
// Sign-gating (cosmetic, UX only): only the assigned provider can
// actually sign & send — the server enforces this in
// /api/orders/[orderId]/sign-and-send, which returns 403 for any
// non-provider signer. That 403 is the authoritative gate and is
// unchanged. Here we hide the signature canvas + "Sign & Send" for
// non-providers (medical_assistant, clinic_admin, ops_admin) and
// offer the existing "Save as Draft — Provider Signs Later" action
// instead, so an MA never sees a Sign button that would only 403 on
// submit. isProvider is resolved server-side in page.tsx from the
// session app_role claim.

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import * as Sentry from '@sentry/nextjs'
import SignatureCanvas from 'react-signature-canvas'

// ── F5 diagnostic (PR #7c, self-reverts) ─────────────────────
// See draft-sign-form.tsx for the full rationale. This instrumented
// control canvas produces breadcrumbs we can compare side-by-side
// with the draft-sign canvas during the next cowork walkthrough.
// REMOVE THIS INSTRUMENTATION once F5 is root-caused.
function logSignatureEvent(component: 'draft-sign-form' | 'batch-review-form', event: 'onBegin' | 'onEnd') {
  // eslint-disable-next-line no-console
  console.log(`[F5-diag] ${component} ${event} fired`)
  Sentry.addBreadcrumb({
    category: 'signature',
    message:  `${component} ${event} fired`,
    level:    'info',
    data:     { component, event, ts: Date.now() },
  })
}
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

// fix/review-send-flow: a session line is un-sendable when it carries
// no price or a too-short sig. Both are rejected by /api/orders (400:
// "retailCents must be a positive integer" / "sigText must be at least
// 10 characters"). Sessions persisted in sessionStorage BEFORE the
// PR #109 protocol pricing fix can still contain $0.00 stub lines, so
// surface these BEFORE the provider signs instead of failing mid-batch.
function isUnsendable(rx: { retailCents: number; sigText: string }): boolean {
  return rx.retailCents <= 0 || rx.sigText.trim().length < 10
}

// ── Props ─────────────────────────────────────────────────────
// isProvider is derived server-side (review/page.tsx) from the
// session app_role claim. Providers get the sign-and-send UI;
// everyone else gets "Save as Draft — Provider Signs Later". The
// server 403 in sign-and-send remains the real gate regardless.
interface Props {
  isProvider: boolean
}

// ── Component ─────────────────────────────────────────────────

export function BatchReviewForm({ isProvider }: Props) {
  const router = useRouter()
  const session = usePrescriptionSession()
  const sigCanvasRef = useRef<SignatureCanvas>(null)

  const [signatureCaptured, setSignatureCaptured] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitProgress, setSubmitProgress] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [showEpcsGate, setShowEpcsGate] = useState(false)

  // Non-provider "Save as Draft" flow (batched WO-77 pattern)
  const [isSavingDraft, setIsSavingDraft] = useState(false)
  const [draftError, setDraftError] = useState<string | null>(null)

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

  // fix/review-send-flow: pre-flight validation. These lines would 400
  // at /api/orders, so block submission up front with a visible reason
  // instead of failing after the provider has signed and confirmed.
  const invalidItems = prescriptions.filter(isUnsendable)
  const hasInvalidItems = invalidItems.length > 0

  function handleClearSignature() {
    sigCanvasRef.current?.clear()
    setSignatureCaptured(false)
  }

  const canSubmit = signatureCaptured && prescriptions.length > 0 && !isSubmitting && !hasInvalidItems
  // Shared controls (Remove, Add Another) lock during either flow.
  const isBusy = isSubmitting || isSavingDraft

  // ── Sign & Send all prescriptions ──────────────────────────
  async function handleSignAndSend() {
    if (!sigCanvasRef.current || sigCanvasRef.current.isEmpty()) {
      // fix/review-send-flow (F5 family): the canvas can lose its strokes
      // (e.g. after a resize/re-render) while signatureCaptured is still
      // true. The old silent `return` here made "Confirm & Send" look
      // completely dead. Surface it and reset so the user can re-sign.
      setSubmitError('Your signature did not register. Please sign in the signature box again, then retry.')
      setSignatureCaptured(false)
      setConfirmOpen(false)
      return
    }
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

  // ── Save all prescriptions as drafts (non-provider) ─────────
  // Mirrors handleSignAndSend but stops after DRAFT creation — no
  // signature, no sign-and-send call. The assigned provider signs
  // each draft later from the dashboard Drafts tab. Reuses the same
  // POST /api/orders the provider flow and the margin builder use.
  async function handleSaveDraftAll() {
    if (!patient || !provider) return

    setIsSavingDraft(true)
    setDraftError(null)

    try {
      const totalCount = prescriptions.length
      let savedCount = 0

      for (let i = 0; i < prescriptions.length; i++) {
        const rx = prescriptions[i]!
        setSubmitProgress(`Saving draft ${i + 1} of ${totalCount}...`)

        const orderRes = await fetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            patientId:     patient.patient_id,
            providerId:    provider.provider_id,
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
          throw new Error(
            `Draft ${i + 1} (${rx.medicationName}) failed: ${err.error ?? 'Unknown error'}` +
            (savedCount > 0 ? `. ${savedCount} of ${totalCount} already saved as drafts.` : '')
          )
        }

        // BLK-01 pattern: drop each saved rx from the session so a later
        // failure doesn't re-create earlier drafts when the user retries.
        session.removePrescription(rx.id)
        savedCount++
      }

      setSubmitProgress(null)
      router.push(`/dashboard?draft=${totalCount}`)
      setTimeout(() => session.clearSession(), 100)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'An unexpected error occurred'
      setDraftError(msg)
      setSubmitProgress(null)
      setIsSavingDraft(false)
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
          const invalid = isUnsendable(rx)

          return (
            <div
              key={rx.id}
              className={`rounded-lg border bg-card p-4 shadow-sm ${invalid ? 'border-amber-300' : 'border-border'}`}
            >
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
                  {invalid && (
                    <p className="mt-1 text-xs font-medium text-amber-700">
                      Missing {rx.retailCents <= 0 ? 'price' : 'directions'} — remove this line and re-add it from search or a protocol.
                    </p>
                  )}
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
                  disabled={isBusy}
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
        disabled={isBusy}
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

      {/* fix/review-send-flow: pre-flight banner for un-sendable lines.
          These would 400 at /api/orders, so block up front with the reason
          visible instead of erroring mid-batch after the provider signed. */}
      {hasInvalidItems && (
        <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/20">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            {invalidItems.length} prescription{invalidItems.length !== 1 ? 's' : ''} can&apos;t be sent yet
          </p>
          <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
            {invalidItems.map(rx => rx.medicationName).join(', ')} {invalidItems.length !== 1 ? 'are' : 'is'} missing a price
            or prescription directions — usually leftovers from a protocol added before pricing was fixed. Remove the flagged
            line{invalidItems.length !== 1 ? 's' : ''} above and re-add {invalidItems.length !== 1 ? 'them' : 'it'} from search
            or the protocol, or use Start Over to clear the session.
          </p>
        </div>
      )}

      {/* Provider signature — providers only. Non-providers can't sign
          (server returns 403), so the canvas is hidden for them. */}
      {isProvider && (
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
              onBegin={() => {
                logSignatureEvent('batch-review-form', 'onBegin')
                setSignatureCaptured(true)
              }}
              onEnd={() => {
                logSignatureEvent('batch-review-form', 'onEnd')
                setSignatureCaptured(true)
              }}
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
      )}

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

      {/* Confirm dialog — providers only */}
      {isProvider && confirmOpen && (
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

      {/* Sign & Send button — providers only */}
      {isProvider && !confirmOpen && (
        <>
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
            Sign &amp; Send {prescriptions.length > 1 ? `All ${prescriptions.length} Prescriptions` : 'Payment Link'}
          </button>
          {/* fix/review-send-flow: a disabled button must say WHY it is
              disabled — a gray button with no hint reads as "broken". */}
          {!canSubmit && !isSubmitting && (
            <p className="text-center text-xs text-muted-foreground">
              {hasInvalidItems
                ? 'Remove the flagged prescriptions above to enable sending.'
                : 'Sign in the signature box above to enable sending.'}
            </p>
          )}
        </>
      )}

      {/* Non-provider (MA / clinic_admin / ops_admin): signing is provider-only
          (server returns 403). Offer the existing Save-as-Draft action instead
          so the assigned provider can review and sign from the dashboard. */}
      {!isProvider && (
        <div className="space-y-3">
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <p className="text-sm font-medium text-foreground">
              Only the assigned provider can sign and send.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Save {prescriptions.length > 1 ? 'these prescriptions' : 'this prescription'} as a draft for
              provider review. {provider.first_name} {provider.last_name} can sign from the dashboard Drafts
              tab, which sends the payment link.
            </p>
          </div>

          <button
            type="button"
            onClick={handleSaveDraftAll}
            disabled={isSavingDraft || prescriptions.length === 0 || hasInvalidItems}
            className="w-full rounded-lg border border-border bg-background px-6 py-3 text-sm font-semibold text-foreground shadow-sm hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {isSavingDraft ? 'Saving...' : 'Save as Draft — Provider Signs Later'}
          </button>
          {hasInvalidItems && (
            <p className="text-center text-xs text-amber-700">
              Remove the flagged prescriptions above to enable saving drafts.
            </p>
          )}
          <p className="text-center text-[10px] text-muted-foreground">
            Creates the order{prescriptions.length > 1 ? 's' : ''} without signing. The provider can review and sign from the dashboard.
          </p>
          {draftError && (
            <p className="text-center text-xs text-red-600" role="alert">{draftError}</p>
          )}
        </div>
      )}

      {/* WO-86: EPCS 2FA Gate for controlled substances — providers only */}
      {isProvider && showEpcsGate && (
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
