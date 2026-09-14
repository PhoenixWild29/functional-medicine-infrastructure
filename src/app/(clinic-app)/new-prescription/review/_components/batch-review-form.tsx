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
import { usePrescriptionSession, type SessionPrescription } from '../../_context/prescription-session'
import { EpcsTotpGate } from '../../_components/epcs-totp-gate'
import { DrugInteractionAlerts } from '../../_components/drug-interaction-alerts'
import { RxDetailsRow } from './rx-details-row'
import { AllergyNotice } from './allergy-notice'
import { builderHref } from '../../_lib/edit-target'
import {
  computeDispense,
  defaultQuantityLabel,
  durationDaysFromSig,
  type DerivedDispense,
  defaultRxDetails,
  missingRxDetails,
  MISSING_RX_DETAIL_LABEL,
  rulesFromFormulation,
  type MissingRxDetail,
  type RxDetails,
  type RxRules,
} from '@/lib/orders/rx-details'
import type { RxFormulationDefaults } from '@/lib/orders/rx-defaults-loader'
import { structuredLineInputs } from '@/lib/orders/draft-edit'
import { SaveFavoriteButton } from '../../_components/save-favorite-button'
import { splitDose } from '@/lib/orders/dose'
import { formatDoseWithMg } from '@/lib/orders/dose-display'

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

// ── WO-96: per-line Rx details + rules ────────────────────────
// Lines added by the margin builder carry both. Lines that entered the
// session another way (protocol quick-load, favorites, sessions
// persisted before WO-96) carry neither until the resolution effect
// below patches them from /api/formulations?level=rx_defaults. Until
// then they render with the plain defaults and no rule.

function effectiveRules(rx: SessionPrescription): RxRules {
  if (rx.rxRules) return rx.rxRules
  return rulesFromFormulation(null, rx.deaSchedule)
}

function effectiveDetails(rx: SessionPrescription): RxDetails {
  return rx.rxDetails ?? defaultRxDetails(null)
}

/**
 * The POST /api/orders body for one session line. Shared by Sign & Send
 * and Save as Draft so the two paths can never drift apart.
 *
 * Dose, frequency and quantity go as structured fields from the line
 * (the values the builder set), never re-parsed from the sig — a sig the
 * provider edited by hand does not change what is stored. The sig is read
 * only as a fallback for a legacy line that has no structured value
 * (see structuredLineInputs).
 */
export function orderPostBody(
  rx: SessionPrescription,
  patient: { patient_id: string; state: string | null },
  provider: { provider_id: string },
  rxDetails: RxDetails,
) {
  return {
    patientId:     patient.patient_id,
    providerId:    provider.provider_id,
    // WO-87: send whichever ID this rx came from (catalog or formulation)
    catalogItemId: rx.itemId,
    formulationId: rx.formulationId,
    pharmacyId:    rx.pharmacyId,
    retailCents:   rx.retailCents,
    sigText:       rx.sigText,
    patientState:  patient.state ?? '',
    // GAP-3: present only on lines quick-loaded from a protocol; the server
    // links the order to a protocol_instance + version.
    protocolId:    rx.protocolId ?? null,
    // WO-96: derived + defaulted detail fields
    rxDetails,
    // WO-96 fix / WO-98: structured builder inputs, stored on
    // medication_snapshot so a reopened draft keeps them.
    ...structuredLineInputs(rx),
  }
}

/**
 * WO-96 fix: days supply + dispense for a session line from its own sig,
 * dose, frequency and quantity. No quantity → one package ("1"); no
 * pharmacy package list is available on this page.
 */
function derivedForLine(
  rx: SessionPrescription,
  inputs: RxFormulationDefaults['dispenseInputs'] | undefined,
): DerivedDispense | null {
  if (!inputs) return null
  const { amount, unit } = splitDose(rx.dose)
  return computeDispense({
    doseAmount:         amount,
    doseUnit:           unit,
    frequencyCode:      rx.frequencyCode ?? null,
    quantityLabel:      rx.quantityLabel || defaultQuantityLabel([], null, inputs.dosageFormName),
    concentrationValue: inputs.concentrationValue,
    concentrationUnit:  inputs.concentrationUnit,
    dosageFormName:     inputs.dosageFormName,
    durationDays:       durationDaysFromSig(rx.sigText),
  })
}

/** Lines whose rules are unknown and can be resolved (V3.0 formulation lines). */
function needsRxResolution(rx: SessionPrescription): boolean {
  return !rx.rxRules && !!rx.formulationId
}

// WO-103: "10 units (0.5 mg)" when the line carries its formulation's
// mg/mL concentration (set by the margin builder); the plain dose otherwise.
function doseWithMg(rx: SessionPrescription): string {
  if (rx.concentrationValue == null) return rx.dose
  const { amount, unit } = splitDose(rx.dose)
  if (!amount) return rx.dose
  return formatDoseWithMg(amount, unit, {
    concentration_value: rx.concentrationValue,
    concentration_unit:  rx.concentrationUnit,
  })
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

  // ── Clear the session only once we have actually left this page ──
  //
  // Both Sign & Send and Save as Draft navigate to /dashboard and then
  // clear the session. Clearing while the dashboard navigation is still
  // pending flips isSessionStarted to false on a page that is still
  // mounted, and the redirect effect above (plus SessionBanner's) fires
  // router.replace('/new-prescription'), which supersedes the dashboard
  // push. A timer (the previous "clear after a tick") only wins that
  // race when the dashboard RSC comes back within the tick, which CI
  // does not guarantee. Arming this ref and clearing in the unmount
  // cleanup is deterministic: the cleanup runs when the new route has
  // committed and no /new-prescription page can redirect any more.
  const clearSessionOnUnmountRef = useRef(false)
  const clearSessionRef = useRef(session.clearSession)
  clearSessionRef.current = session.clearSession
  useEffect(() => () => {
    if (clearSessionOnUnmountRef.current) clearSessionRef.current()
  }, [])

  // ── WO-96: resolve defaults + rules for lines that lack them ──
  // Keyed on the unresolved formulation ids so a patch that adds
  // rxRules does not re-trigger the fetch for the same lines.
  const unresolvedKey = session.prescriptions
    .filter(needsRxResolution)
    .map(rx => rx.formulationId as string)
    .sort()
    .join(',')
  const { updatePrescription } = session
  const prescriptionsRef = useRef(session.prescriptions)
  prescriptionsRef.current = session.prescriptions
  useEffect(() => {
    if (!unresolvedKey) return
    const ids = [...new Set(unresolvedKey.split(','))]
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/formulations?level=rx_defaults&ids=${encodeURIComponent(ids.join(','))}`)
        if (!res.ok) return
        const json = await res.json() as { data?: Record<string, RxFormulationDefaults> }
        if (cancelled || !json.data) return
        for (const rx of prescriptionsRef.current) {
          if (!needsRxResolution(rx)) continue
          const entry = json.data[rx.formulationId as string]
          if (!entry) continue
          const existing = rx.rxDetails
          const defaults = defaultRxDetails(entry.defaults, {
            refills:       existing?.refills ?? 0,
            diagnosisCode: existing?.diagnosisCode ?? entry.suggestedDiagnosis?.code ?? null,
            diagnosisText: existing?.diagnosisText ?? entry.suggestedDiagnosis?.text ?? null,
          })
          // WO-96 fix: a quick-loaded line arrives without days supply /
          // dispense — derive them here (duration in the sig first, else the
          // line's quantity, else one package) rather than show "—".
          const derived = derivedForLine(rx, entry.dispenseInputs)
          updatePrescription(rx.id, {
            rxDetails: {
              ...defaults,
              ...(existing ?? {}),
              ...(existing?.daysSupply == null && existing?.dispenseQuantity == null && derived
                ? { daysSupply: derived.daysSupply, dispenseQuantity: derived.dispenseQuantity, dispenseUnit: derived.dispenseUnit }
                : {}),
              clinicalDifference: existing?.clinicalDifference ?? defaults.clinicalDifference,
              diagnosisCode:      defaults.diagnosisCode,
              diagnosisText:      defaults.diagnosisText,
            },
            rxRules:     rulesFromFormulation(entry.defaults, entry.deaSchedule ?? rx.deaSchedule),
            deaSchedule: entry.deaSchedule ?? rx.deaSchedule,
          })
        }
      } catch (err) {
        // Non-fatal: the row renders with plain defaults; sign-and-send
        // remains the authoritative gate for rule-required fields.
        console.warn('[batch-review] rx defaults resolution failed:', err instanceof Error ? err.message : err)
      }
    })()
    return () => { cancelled = true }
  }, [unresolvedKey, updatePrescription])

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

  // WO-96: rule-required Rx details still empty (controlled → diagnosis,
  // requires_clinical_difference → statement). Blocks both Sign & Send
  // and Save as Draft; the row auto-expands with the field focused.
  const missingByLine = new Map<string, MissingRxDetail[]>(
    prescriptions.map(rx => [rx.id, missingRxDetails(effectiveDetails(rx), effectiveRules(rx))]),
  )
  const linesMissingDetails = prescriptions.filter(rx => (missingByLine.get(rx.id) ?? []).length > 0)
  const hasMissingDetails = linesMissingDetails.length > 0
  const missingDetailsHint = linesMissingDetails
    .map(rx => `${rx.medicationName} needs ${(missingByLine.get(rx.id) ?? []).map(m => MISSING_RX_DETAIL_LABEL[m]).join(' and ')}`)
    .join('; ')

  function handleClearSignature() {
    sigCanvasRef.current?.clear()
    setSignatureCaptured(false)
  }

  const canSubmit = signatureCaptured && prescriptions.length > 0 && !isSubmitting && !hasInvalidItems && !hasMissingDetails
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
          body: JSON.stringify(orderPostBody(rx, patient, provider, effectiveDetails(rx))),
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

      // Navigate to dashboard; the session is cleared in the unmount
      // cleanup once that navigation has committed (see
      // clearSessionOnUnmountRef) — clearing any earlier lets the
      // SessionBanner redirect race the dashboard push.
      setSubmitProgress(null)
      clearSessionOnUnmountRef.current = true
      router.push(`/dashboard?sent=${totalCount}`)

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
          body: JSON.stringify(orderPostBody(rx, patient, provider, effectiveDetails(rx))),
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
      // Same as Sign & Send: clear on unmount, never before the navigation lands.
      clearSessionOnUnmountRef.current = true
      router.push(`/dashboard?draft=${totalCount}`)
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

      {/* WO-97: allergies not recorded → amber notice with an inline
          "Confirm NKDA". Never blocks Sign & Send or Save as Draft. */}
      <AllergyNotice patient={patient} onSaved={session.updatePatient} />

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
                    {rx.form} — <span data-testid={`dose-display-${rx.id}`}>{doseWithMg(rx)}</span> — {rx.pharmacyName}
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
              {/* WO-96: collapsed Rx details row — auto-expands only when a
                  rule requires confirmation. */}
              <RxDetailsRow
                lineId={rx.id}
                details={effectiveDetails(rx)}
                rules={effectiveRules(rx)}
                missing={missingByLine.get(rx.id) ?? []}
                disabled={isBusy}
                onChange={patch => session.updatePrescription(rx.id, {
                  rxDetails: { ...effectiveDetails(rx), ...patch },
                })}
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                {/* WO-103: ☆ Save as favorite — V3.0 formulation lines only */}
                <SaveFavoriteButton
                  idSuffix={rx.id}
                  providerId={provider.provider_id}
                  formulationId={rx.formulationId}
                  pharmacyId={rx.pharmacyId}
                  medicationName={rx.medicationName}
                  doseAmount={splitDose(rx.dose).amount}
                  doseUnit={splitDose(rx.dose).unit}
                  frequencyCode={rx.frequencyCode ?? null}
                  sigText={rx.sigText}
                  quantity={rx.quantityLabel ?? null}
                  refills={effectiveDetails(rx).refills}
                  disabled={isBusy}
                />
                <div className="ml-auto flex items-center gap-3">
                  {/* WO-98: Edit reopens the existing builder with this line's
                      values; saving updates the line in place (same id). */}
                  <button
                    type="button"
                    onClick={() => router.push(builderHref({ kind: 'session', lineId: rx.id }))}
                    disabled={isBusy}
                    aria-label={`Edit ${rx.medicationName}`}
                    className="text-[10px] font-medium text-primary underline hover:text-primary/80 disabled:opacity-50"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => session.removePrescription(rx.id)}
                    disabled={isBusy}
                    aria-label={`Remove ${rx.medicationName}`}
                    className="text-[10px] text-red-500 underline hover:text-red-700 disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Add another / Back — both return to search with the session intact (WO-98) */}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => router.push('/new-prescription/search')}
          disabled={isBusy}
          className="rounded-md border border-border px-4 py-3 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors disabled:opacity-50"
        >
          Back
        </button>
        <button
          type="button"
          onClick={() => router.push('/new-prescription/search')}
          disabled={isBusy}
          className="flex-1 rounded-md border-2 border-dashed border-border px-4 py-3 text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
        >
          + Add Another Prescription
        </button>
      </div>

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
                : hasMissingDetails
                  ? `Complete Rx details to enable sending: ${missingDetailsHint}.`
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
            disabled={isSavingDraft || prescriptions.length === 0 || hasInvalidItems || hasMissingDetails}
            className="w-full rounded-lg border border-border bg-background px-6 py-3 text-sm font-semibold text-foreground shadow-sm hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {isSavingDraft ? 'Saving...' : 'Save as Draft — Provider Signs Later'}
          </button>
          {hasInvalidItems && (
            <p className="text-center text-xs text-amber-700">
              Remove the flagged prescriptions above to enable saving drafts.
            </p>
          )}
          {!hasInvalidItems && hasMissingDetails && (
            <p className="text-center text-xs text-amber-700">
              Complete Rx details to enable saving drafts: {missingDetailsHint}.
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
