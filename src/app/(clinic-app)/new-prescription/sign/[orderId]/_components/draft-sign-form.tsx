'use client'

// ============================================================
// Draft Sign Form — WO-77
// ============================================================
//
// Provider reviews a DRAFT order and signs it. Calls
// POST /api/orders/{orderId}/sign-and-send to transition
// the order from DRAFT to AWAITING_PAYMENT.
//
// This form is pre-populated from the server — no data entry
// required from the provider. They just review and sign.

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import * as Sentry from '@sentry/nextjs'
import SignatureCanvas from 'react-signature-canvas'

// ── F5 diagnostic (PR #7c, self-reverts) ─────────────────────
// Cowork round-3 observed that this canvas's `onEnd` never fires
// on prod Vercel, while the batch-review-form canvas works on the
// first dot. We don't know whether the bug is "onEnd never fires"
// (event-binding problem, e.g., stale listener ref after a post-
// mount re-render) or "onEnd fires but setSignatureCaptured never
// flips state" (state-machine problem). Instrumenting BOTH events
// on BOTH canvases captures the answer during the next walkthrough:
//
//   - console.log: visible via chrome MCP read_console_messages
//   - Sentry.addBreadcrumb: visible in the Sentry crumb trail of
//     any captured event (e.g., a network error or captureException
//     call during the session), no browser-console access required
//
// REMOVE THIS INSTRUMENTATION once the walkthrough captures data
// and the F5 root cause is identified. See PR #7b's TODO in the
// canvas block for the full hypothesis.
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

function toCurrency(cents: number): string {
  return '$' + (cents / 100).toFixed(2)
}

function calcPlatformFeeCents(marginCents: number): number {
  return Math.round(marginCents * 15 / 100)
}

interface Props {
  orderId:        string
  patientName:    string
  patientDob:     string
  patientPhone:   string
  patientState:   string
  providerName:   string
  providerNpi:    string
  medicationName: string
  form:           string
  dose:           string
  pharmacyName:   string
  wholesaleCents: number
  retailCents:    number
  sigText:        string
}

export function DraftSignForm({
  orderId,
  patientName,
  patientDob,
  patientPhone,
  patientState,
  providerName,
  providerNpi,
  medicationName,
  form,
  dose,
  pharmacyName,
  wholesaleCents,
  retailCents,
  sigText,
}: Props) {
  const router = useRouter()
  const sigCanvasRef = useRef<SignatureCanvas>(null)

  const [signatureCaptured, setSignatureCaptured] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const marginCents = retailCents - wholesaleCents
  const platformFeeCents = calcPlatformFeeCents(marginCents)
  const clinicMarginCents = marginCents - platformFeeCents

  function handleClearSignature() {
    sigCanvasRef.current?.clear()
    setSignatureCaptured(false)
  }

  async function handleSignAndSend() {
    if (!sigCanvasRef.current || sigCanvasRef.current.isEmpty()) return

    setIsSubmitting(true)
    setSubmitError(null)
    setConfirmOpen(false)

    try {
      const signatureDataUrl = sigCanvasRef.current.toDataURL('image/png')

      const res = await fetch(`/api/orders/${orderId}/sign-and-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signatureDataUrl }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Failed to sign and send')
      }

      router.push('/dashboard?sent=1')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'An unexpected error occurred'
      setSubmitError(msg)
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">

      {/* Patient info */}
      <div className="rounded-lg border border-border bg-muted/30 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Patient</p>
            <p className="text-sm font-semibold text-foreground">{patientName}</p>
            <p className="text-xs text-muted-foreground">DOB: {patientDob} — {patientState} — {patientPhone}</p>
          </div>
          <div className="text-right">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Provider</p>
            <p className="text-sm font-semibold text-foreground">{providerName}</p>
            <p className="text-xs text-muted-foreground">NPI: {providerNpi}</p>
          </div>
        </div>
      </div>

      {/* Prescription details */}
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Prescription</p>
        <p className="mt-1 text-sm font-semibold text-foreground">{medicationName}</p>
        <p className="text-xs text-muted-foreground">{form} — {dose} — {pharmacyName}</p>
        <p className="mt-2 text-xs text-muted-foreground italic">Sig: {sigText}</p>
      </div>

      {/* Financial summary */}
      <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-1.5 text-sm">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Financial Summary</p>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Wholesale cost</span>
          <span className="text-foreground">{toCurrency(wholesaleCents)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Patient retail price</span>
          <span className="font-medium text-foreground">{toCurrency(retailCents)}</span>
        </div>
        <div className="border-t border-border pt-1.5">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Platform fee (15%)</span>
            <span className="text-muted-foreground">−{toCurrency(platformFeeCents)}</span>
          </div>
          <div className="flex justify-between font-semibold mt-0.5">
            <span className="text-foreground">Clinic payout</span>
            <span className="text-emerald-600">{toCurrency(clinicMarginCents)}</span>
          </div>
        </div>
      </div>

      {/* Provider signature */}
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Provider Signature — {providerName}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          NPI: {providerNpi} — Signing prescription for {patientName}
        </p>

        <div className="mt-3 rounded-lg border border-border bg-white">
          {/*
           * Fire "captured" on BOTH pointerdown (onBegin) and pointerup
           * (onEnd) so the button enables instantly on first pen contact,
           * not only after stroke completion.
           *
           * TODO (F5 root-cause follow-up): cowork round-3 observed on
           * PROD Vercel that this canvas's onEnd never fired after
           * dispatched pointer events, while the visually identical
           * canvas in batch-review-form.tsx correctly flipped state on
           * the first dot. StrictMode dev-double-invoke was ruled out
           * (F5 observed on prod, where React's dev-only double-invoke
           * is disabled). Suspected structural delta: draft-sign-form
           * renders the canvas unconditionally on first render, whereas
           * batch-review-form returns a "No prescriptions" placeholder
           * on first render and only mounts the canvas on the second
           * render cycle after PrescriptionSessionProvider's
           * sessionStorage-restore effect fires. A post-mount re-render
           * here (hydration? HipaaTimeout's window listeners? unknown)
           * may be leaving signature_pad's native mousedown/mouseup
           * listeners bound to a stale canvas ref. onBegin defense
           * masks whichever mechanism causes this; PR #7c adds a
           * console.log + Sentry breadcrumb on onEnd to capture the
           * actual event ordering in the next cowork walkthrough.
           */}
          <SignatureCanvas
            ref={sigCanvasRef}
            canvasProps={{
              className: 'w-full h-32 rounded-lg',
              'aria-label': 'Provider signature pad',
            }}
            onBegin={() => {
              logSignatureEvent('draft-sign-form', 'onBegin')
              setSignatureCaptured(true)
            }}
            onEnd={() => {
              logSignatureEvent('draft-sign-form', 'onEnd')
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

      {/* Error */}
      {submitError && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {submitError}
        </div>
      )}

      {/* Confirm dialog */}
      {confirmOpen && (
        <div className="rounded-lg border-2 border-primary bg-primary/5 p-4">
          <p className="text-sm font-medium text-foreground">
            You are about to send a <strong>{toCurrency(retailCents)}</strong> payment link to{' '}
            <strong>{patientName}</strong> at <strong>{patientPhone || 'no phone'}</strong>.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            The link will expire in 72 hours. Once sent, the prescription is locked and cannot be edited.
          </p>
          <div className="mt-3 flex gap-3">
            <button
              type="button"
              onClick={handleSignAndSend}
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

      {/* Action buttons */}
      {!confirmOpen && (
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => router.push('/dashboard')}
            className="flex-1 rounded-md border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted/50"
          >
            Back to Dashboard
          </button>
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={!signatureCaptured || isSubmitting}
            className={`flex-1 rounded-lg px-6 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              signatureCaptured && !isSubmitting
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-muted text-muted-foreground cursor-not-allowed'
            }`}
          >
            Sign & Send Payment Link
          </button>
        </div>
      )}
    </div>
  )
}
