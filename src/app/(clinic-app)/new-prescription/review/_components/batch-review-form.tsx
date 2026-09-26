'use client'

// ============================================================
// Batch Review Form — WO-80
// ============================================================
//
// Reviews ALL prescriptions in the current session. The provider
// signs once: every prescription is created as a DRAFT order, then
// the whole set is signed in ONE request to POST /api/orders/batch-sign
// (WO-99) — all or nothing, one payment group, one payment link.
//
// Each prescription creates its own order record with its own
// state machine, but they share a single provider signature
// and the patient receives one payment link.
//
// Sign-gating (cosmetic, UX only): only the assigned provider can
// actually sign & send — the server enforces this in
// /api/orders/batch-sign, which returns 403 for any
// non-provider signer. That 403 is the authoritative gate and is
// unchanged. Here we hide the signature canvas + "Sign & Send" for
// non-providers (medical_assistant, clinic_admin, ops_admin) and
// offer the existing "Save as Draft — Provider Signs Later" action
// instead, so an MA never sees a Sign button that would only 403 on
// submit. isProvider is resolved server-side in page.tsx from the
// session app_role claim.
//
// WO-102: totals show Subtotal, Shipping per pharmacy (once per pharmacy,
// never per prescription), Platform fee, Clinic payout and Patient total.
// Sending creates every draft first, has the server allocate shipping
// across the send (POST /api/orders/shipping), and only then signs — so
// each pharmacy's shipping sits on one order before any payment link goes
// out. A session spanning pharmacies shows what the split costs and, when
// it is a genuine net saving, offers to route everything to one pharmacy.

import { useState, useRef, useEffect, useCallback } from 'react'
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
  suggestPackageForDispense,
  packageUnitMismatchMessage,
  type PackageOption,
  type MissingRxDetail,
  type RxDetails,
  type RxRules,
} from '@/lib/orders/rx-details'
import type { RxFormulationDefaults } from '@/lib/orders/rx-defaults-loader'
import { structuredLineInputs } from '@/lib/orders/draft-edit'
import { SaveFavoriteButton } from '../../_components/save-favorite-button'
import { splitDose } from '@/lib/orders/dose'
import { formatDoseWithMg } from '@/lib/orders/dose-display'
import { bundleTotals } from '@/lib/orders/shipping'
import { useBundleShipping, ShippingLines, MultiPharmacyNoticeBanner } from './bundle-shipping'
import { checkSignature, signatureFromPad, SIGNATURE_REJECTION_COPY, type SignatureCheck } from '@/lib/orders/signature'

// ── Helpers ───────────────────────────────────────────────────

function toCurrency(cents: number): string {
  return '$' + (cents / 100).toFixed(2)
}

function calcPlatformFeeCents(marginCents: number): number {
  // Floored at zero, exactly as bundleTotals does it. Unfloored, a line
  // priced below cost produced a NEGATIVE fee, and the card read a
  // smaller loss than the totals — as if the platform rebated 15% of the
  // clinic's loss. One loss, stated one way.
  return marginCents > 0 ? Math.round(marginCents * 15 / 100) : 0
}

// fix/review-send-flow: a session line is un-sendable when it carries
// no price or a too-short sig. Both are rejected by /api/orders (400:
// "retailCents must be a positive integer" / "sigText must be at least
// 10 characters"). Sessions persisted in sessionStorage BEFORE the
// PR #109 protocol pricing fix can still contain $0.00 stub lines, so
// surface these BEFORE the provider signs instead of failing mid-batch.
/**
 * Why a line cannot be sent, or null when it can.
 *
 * 'below_cost' is WO-106: a refill carries the source order's retail
 * forward while taking today's wholesale, so a package price that rose
 * since the original fill prices the line under it. POST /api/orders
 * refuses retail < wholesale and the DB CHECK refuses it again, so this
 * used to be a 422 per line AFTER the provider signed. The refusal
 * belongs here, before the signature — and the fix is to edit the price,
 * not to remove the line. (What a refill should do about a moved price
 * is WO-107; this only stops it being sent below cost.)
 */
type SendBlock = 'price' | 'directions' | 'below_cost' | 'reprice' | 'cycle_pattern' | 'package_unit'

type SendBlockLine = {
  retailCents: number; wholesaleCents: number; sigText: string; repriceRequired?: boolean | null
  sigMode?: SessionPrescription['sigMode']; cycle?: SessionPrescription['cycle']
  packageUnitMismatch?: string | null
}

export function sendBlock(rx: SendBlockLine): SendBlock | null {
  if (rx.retailCents <= 0) return 'price'
  if (rx.sigText.trim().length < 10) return 'directions'
  // Cycling dose math: a cycling line without its days on / off (one
  // written before the pattern was stored) has a quantity with no basis
  // but daily dosing. Edit it on the dose step; the server refuses it too.
  if (rx.sigMode === 'cycling' && !rx.cycle) return 'cycle_pattern'
  // #181: its package cannot be sized against its dispense — never one package.
  if (rx.packageUnitMismatch) return 'package_unit'
  if (rx.retailCents < rx.wholesaleCents) return 'below_cost'
  // WO-108: the wholesale moved and the provider has not confirmed a
  // price yet. Reaching Review with the flag still set means the price
  // step was skipped — a deep link, or a back button — so the decision
  // is still owed.
  if (rx.repriceRequired === true) return 'reprice'
  return null
}

function isUnsendable(rx: SendBlockLine): boolean {
  return sendBlock(rx) !== null
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
    // WO-101: the package the line is priced from (server re-prices).
    packageId:     rx.packageId ?? null,
    // WO-101a: how many of it (server prices package × count).
    packageCount:  rx.packageId ? (rx.packageCount ?? 1) : null,
    // WO-105: the titration schedule, structured. The sig still reads as
    // a sentence for the fax; these are what the pharmacy payloads, the
    // Rx PDF table and the patient schedule are built from.
    sigMode:        rx.sigMode ?? 'standard',
    titrationSteps: rx.titrationSteps ?? [],
    // Cycling dose math: the on/off pattern, stored on the order.
    ...(rx.sigMode === 'cycling' && rx.cycle
      ? { cycleOnDays: rx.cycle.onDays, cycleOffDays: rx.cycle.offDays }
      : {}),
    // WO-106: the order this one refills, when the line came from Refill.
    refillOfOrderId: rx.refillOfOrderId ?? null,
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
    // Cycling dose math: a cycling line's length is its own, never read
    // from its sig ("for 6 weeks then reassess" has none durationDaysFromSig
    // accepts); the doses count on-days only.
    durationDays:       rx.sigMode === 'cycling' ? rx.cycle?.lengthDays ?? null : durationDaysFromSig(rx.sigText),
    cycle:              rx.sigMode === 'cycling' ? rx.cycle ?? null : null,
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
// session app_role claim. Providers get the Sign & Send UI;
// everyone else gets "Save as Draft — Provider Signs Later". The
// server 403 in batch-sign remains the real gate regardless.
interface Props {
  isProvider: boolean
}

// ── Component ─────────────────────────────────────────────────

export function BatchReviewForm({ isProvider }: Props) {
  const router = useRouter()
  const session = usePrescriptionSession()
  const sigCanvasRef = useRef<SignatureCanvas>(null)

  // WO-99: the stroke rule (at least 3 strokes spanning at least 40% of
  // the pad), read off the pad after each stroke. The server checks the
  // same rule.
  const [signatureCheck, setSignatureCheck] = useState<SignatureCheck | null>(null)
  const signatureCaptured = signatureCheck?.ok === true
  function readSignaturePad() {
    setSignatureCheck(checkSignature(signatureFromPad(sigCanvasRef.current as unknown as Parameters<typeof signatureFromPad>[0])))
  }
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitProgress, setSubmitProgress] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [showEpcsGate, setShowEpcsGate] = useState(false)

  // Non-provider "Save as Draft" flow (batched WO-77 pattern)
  const [isSavingDraft, setIsSavingDraft] = useState(false)
  const [draftError, setDraftError] = useState<string | null>(null)

  // WO-102: shipping rates, absorb setting, per-pharmacy breakdown and the
  // multi-pharmacy notice. Called before any early return (hook order).
  const bundle = useBundleShipping(session.prescriptions, session.patient?.state ?? null)

  // WO-102: drafts created by a send that has not finished, by session line
  // id, and the order ids shipping was allocated across — a retry signs the
  // existing drafts instead of re-creating them, and never re-allocates a
  // pharmacy's shipping that already went out on a signed order.
  const [rulesLoadFailed, setRulesLoadFailed] = useState(false)
  // Bumped by the retry control to re-run the rules resolution in place.
  // The failure flag is NOT cleared on click: it stays up until a
  // resolution actually succeeds, so Sign & Send never flickers open on
  // a retry that is still in flight or fails again.
  const [rulesAttempt, setRulesAttempt] = useState(0)
  const [interactionsUnavailable, setInteractionsUnavailable] = useState(false)
  const createdOrderIdsRef = useRef<Map<string, string>>(new Map())
  const allocatedOrderIdsRef = useRef<Set<string>>(new Set())

  // Redirect if no session — once the provider has read storage (see
  // SessionBanner: before that, empty means "not restored yet").
  useEffect(() => {
    if (session.isRestored && !session.isSessionStarted) {
      router.replace('/new-prescription')
    }
  }, [session.isRestored, session.isSessionStarted, router])

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
  // #181: the vial suggestion for a line with no package. Another package
  // or more than one → the line takes it and its price must be confirmed
  // (WO-108, the margin kept); a package that cannot be sized → blocked
  // with the price step's message.
  const patientStateRef = useRef(session.patient?.state ?? null)
  patientStateRef.current = session.patient?.state ?? null
  const sizeUnpackagedLine = useCallback(async (
    rx: SessionPrescription,
    dispense: { quantity: number; unit: string; daysSupply: number | null },
    inputs: RxFormulationDefaults['dispenseInputs'] | undefined,
  ) => {
    if (!rx.formulationId) return
    try {
      const state = patientStateRef.current
      const res = await fetch(`/api/formulations?level=pharmacy_options&formulation_id=${encodeURIComponent(rx.formulationId)}${state ? `&state=${encodeURIComponent(state)}` : ''}`)
      if (!res.ok) {
        console.error('[batch-review] package sizing read failed:', res.status)
        return
      }
      const json = await res.json() as { data?: Array<{ pharmacies?: { pharmacy_id?: string } | null; packages?: PackageOption[] }> }
      const offer = (json.data ?? []).find(o => o.pharmacies?.pharmacy_id === rx.pharmacyId)
      const packages = offer?.packages ?? []
      if (packages.length === 0) return
      const s = suggestPackageForDispense(
        packages,
        { dispenseQuantity: dispense.quantity, dispenseUnit: dispense.unit, daysSupply: dispense.daysSupply },
        inputs?.dosageFormName ?? rx.form ?? null,
        { concentrationValue: inputs?.concentrationValue ?? null, concentrationUnit: inputs?.concentrationUnit ?? null },
      )
      if (!s || s.reason === 'default') return
      if (s.reason === 'unconvertible') {
        updatePrescription(rx.id, { packageUnitMismatch: packageUnitMismatchMessage(s.package, dispense.unit) })
        return
      }
      if (s.count === 1 && s.package.isDefault) return   // priced as it is
      const wholesaleCents = Math.round(s.package.wholesalePrice * 100) * s.count
      const canPreserve = rx.wholesaleCents > 0 && rx.retailCents >= rx.wholesaleCents
      updatePrescription(rx.id, {
        packageId:            s.package.id,
        packageLabel:         s.package.label,
        packageCount:         s.count,
        quantityLabel:        s.package.label,
        wholesaleCents,
        repriceRequired:      true,
        sourceRetailCents:    rx.retailCents,
        suggestedRetailCents: canPreserve ? Math.round(wholesaleCents * rx.retailCents / rx.wholesaleCents) : null,
        marginBasis:          canPreserve ? 'preserved' : 'clinic_default',
      })
    } catch (err) {
      console.error('[batch-review] package sizing failed:', err instanceof Error ? err.message : err)
    }
  }, [updatePrescription])

  useEffect(() => {
    if (!unresolvedKey) return
    const ids = [...new Set(unresolvedKey.split(','))]
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/formulations?level=rx_defaults&ids=${encodeURIComponent(ids.join(','))}`)
        if (!res.ok) {
          // Batch 1, finding 3: this used to return silently, so the
          // clinical-difference requirement and the controlled-substance
          // banner simply never appeared and the line looked complete.
          console.error('[batch-review] rx defaults resolution failed:', res.status)
          if (!cancelled) setRulesLoadFailed(true)
          return
        }
        const json = await res.json() as { data?: Record<string, RxFormulationDefaults> }
        if (cancelled || !json.data) return
        setRulesLoadFailed(false)
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
          const rxDetails = {
            ...defaults,
            ...(existing ?? {}),
            ...(existing?.daysSupply == null && existing?.dispenseQuantity == null && derived
              ? { daysSupply: derived.daysSupply, dispenseQuantity: derived.dispenseQuantity, dispenseUnit: derived.dispenseUnit }
              : {}),
            clinicalDifference: existing?.clinicalDifference ?? defaults.clinicalDifference,
            diagnosisCode:      defaults.diagnosisCode,
            diagnosisText:      defaults.diagnosisText,
          }
          updatePrescription(rx.id, {
            rxDetails,
            rxRules:     rulesFromFormulation(entry.defaults, entry.deaSchedule ?? rx.deaSchedule),
            deaSchedule: entry.deaSchedule ?? rx.deaSchedule,
          })
          // #181: a line with no package chosen (it skipped the price step)
          // is sized here the way the price step sizes it — never priced
          // as the pharmacy's default package once.
          if (!rx.packageId && rxDetails.dispenseQuantity != null && rxDetails.dispenseUnit) {
            await sizeUnpackagedLine(rx, { quantity: rxDetails.dispenseQuantity, unit: rxDetails.dispenseUnit, daysSupply: rxDetails.daysSupply }, entry.dispenseInputs)
          }
        }
      } catch (err) {
        console.error('[batch-review] rx defaults resolution failed:', err instanceof Error ? err.message : err)
        if (!cancelled) setRulesLoadFailed(true)
      }
    })()
    return () => { cancelled = true }
  }, [unresolvedKey, updatePrescription, rulesAttempt, sizeUnpackagedLine])

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

  // Batch 1: checks that could not run. Each blocks sending and says so
  // on screen — an unanswered clinical question is not a clean result.
  // Unknown = the read failed, or has not resolved yet (fields absent).
  const allergiesLoading     = !!patient && patient.allergies === undefined && patient.allergiesLoadFailed !== true
  const allergyStatusUnknown = patient?.allergiesLoadFailed === true || allergiesLoading

  // Calculate totals — WO-102: shipping once per pharmacy, outside the
  // margin (the platform fee is never charged on it).
  const totals = bundleTotals(prescriptions, bundle.shipping.totalCents, { absorbShipping: bundle.absorbShipping })
  const totalRetailCents = totals.subtotalCents
  const totalPlatformFeeCents = totals.platformFeeCents
  const totalClinicPayoutCents = totals.clinicPayoutCents

  // fix/review-send-flow: pre-flight validation. These lines would 400
  // at /api/orders, so block submission up front with a visible reason
  // instead of failing after the provider has signed and confirmed.
  const invalidItems = prescriptions.filter(isUnsendable)
  const hasInvalidItems = invalidItems.length > 0
  const belowCostItems = invalidItems.filter(rx => sendBlock(rx) === 'below_cost')
  const repriceItems   = invalidItems.filter(rx => sendBlock(rx) === 'reprice')
  const cycleItems     = invalidItems.filter(rx => sendBlock(rx) === 'cycle_pattern' || sendBlock(rx) === 'package_unit')
  const malformedItems = invalidItems.filter(rx => sendBlock(rx) === 'price' || sendBlock(rx) === 'directions')

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
    setSignatureCheck(null)
  }

  const checksUnavailable = allergyStatusUnknown || rulesLoadFailed || interactionsUnavailable
  const canSubmit = signatureCaptured && prescriptions.length > 0 && !isSubmitting && !hasInvalidItems && !hasMissingDetails && !checksUnavailable
  // Shared controls (Remove, Add Another) lock during either flow.
  const isBusy = isSubmitting || isSavingDraft

  // ── Sign & Send all prescriptions ──────────────────────────
  // WO-99: create every draft, allocate shipping, then ONE batch-sign
  // request signs them all — or none. A failure leaves every order an
  // unsigned DRAFT; a retry reuses the drafts already created.
  async function handleSignAndSend(totpCode?: string) {
    const payload = signatureFromPad(sigCanvasRef.current as unknown as Parameters<typeof signatureFromPad>[0])
    const sig = checkSignature(payload)
    if (!sig.ok) {
      // fix/review-send-flow (F5 family): the canvas can lose its strokes
      // (e.g. after a resize/re-render) while the button still looked
      // enabled. Surface it and reset so the provider can re-sign.
      setSubmitError(sig.reason === 'format' || (payload?.strokes.length ?? 0) === 0
        ? 'Your signature did not register. Please sign in the signature box again, then retry.'
        : SIGNATURE_REJECTION_COPY[sig.reason])
      setSignatureCheck(sig)
      setConfirmOpen(false)
      return
    }
    if (!patient || !provider) return

    setIsSubmitting(true)
    setSubmitError(null)
    setConfirmOpen(false)

    try {
      const totalCount = prescriptions.length

      // Step 1 (WO-102): create every DRAFT, then Step 2: allocate shipping
      // across the send, before anything is signed.
      const orderIds = await createDrafts('Creating order')
      await allocateShipping(orderIds)

      // Step 3 (WO-99): sign every order in one request.
      setSubmitProgress(`Signing ${totalCount} prescription${totalCount !== 1 ? 's' : ''}...`)
      const sendRes = await fetch('/api/orders/batch-sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderIds, signature: sig.signature, ...(totpCode ? { totpCode } : {}) }),
      })
      if (!sendRes.ok) {
        const err = await sendRes.json().catch(() => ({})) as { error?: string; code?: string }
        if (err.code === 'TOTP_REQUIRED') {
          // The server found a controlled line this page did not flag
          // (a schedule that could not be read): ask for the code.
          setShowEpcsGate(true)
        }
        const message = err.error ?? 'Unknown error'
        throw new Error(/nothing was signed/i.test(message) ? message : `${message} Nothing was signed.`)
      }

      for (const rx of prescriptions) {
        session.removePrescription(rx.id)
        createdOrderIdsRef.current.delete(rx.id)
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

  // ── WO-102: create (or reuse) a DRAFT per session line ───────
  async function createDrafts(progressLabel: string): Promise<string[]> {
    if (!patient || !provider) return []
    const ids: string[] = []
    for (let i = 0; i < prescriptions.length; i++) {
      const rx = prescriptions[i]!
      const existing = createdOrderIdsRef.current.get(rx.id)
      if (existing) { ids.push(existing); continue }
      setSubmitProgress(`${progressLabel} ${i + 1} of ${prescriptions.length}...`)
      const orderRes = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderPostBody(rx, patient, provider, effectiveDetails(rx))),
      })
      if (!orderRes.ok) {
        const err = await orderRes.json()
        throw new Error(`Order ${i + 1} (${rx.medicationName}) failed: ${err.error ?? 'Unknown error'}`)
      }
      const { orderId } = await orderRes.json() as { orderId: string }
      createdOrderIdsRef.current.set(rx.id, orderId)
      ids.push(orderId)
    }
    return ids
  }

  // ── WO-102: shipping once per pharmacy across this send ──────
  async function allocateShipping(orderIds: string[]) {
    if (orderIds.length === 0) return
    // A retry after some orders were already signed: those orders already
    // carry their pharmacy's shipping — do not charge it again.
    if (orderIds.every(id => allocatedOrderIdsRef.current.has(id))) return
    setSubmitProgress('Calculating shipping...')
    const res = await fetch('/api/orders/shipping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderIds }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(`Shipping could not be calculated: ${(err as { error?: string }).error ?? 'Unknown error'}. Nothing has been sent.`)
    }
    for (const id of orderIds) allocatedOrderIdsRef.current.add(id)
  }

  // ── WO-102: one-click re-route to a single pharmacy ─────────
  function handleReroute() {
    const plan = bundle.notice?.plan
    if (!plan || !bundle.notice?.offerReroute) return
    for (const line of plan.lines) {
      const rx = prescriptions.find(p => p.id === line.lineId)
      if (!rx || rx.pharmacyId === line.pharmacyId) continue
      session.updatePrescription(line.lineId, {
        pharmacyId:      line.pharmacyId,
        pharmacyName:    line.pharmacyName,
        integrationTier: line.integrationTier ?? rx.integrationTier,
        wholesaleCents:  line.wholesaleCents,
        retailCents:     line.retailCents,
        packageId:       line.packageId,
        packageLabel:    line.packageLabel,
        packageCount:    line.packageCount,
        quantityLabel:   line.packageLabel ?? rx.quantityLabel ?? null,
      })
    }
  }

  // ── Save all prescriptions as drafts (non-provider) ─────────
  // Mirrors handleSignAndSend but stops after DRAFT creation — no
  // signature, no batch-sign call. The assigned provider signs
  // each draft later from the dashboard Drafts tab. Reuses the same
  // POST /api/orders the provider flow and the margin builder use.
  async function handleSaveDraftAll() {
    if (!patient || !provider) return

    setIsSavingDraft(true)
    setDraftError(null)

    try {
      const totalCount = prescriptions.length

      // WO-102: create every draft (a retry reuses drafts already created),
      // then allocate shipping once per pharmacy across them.
      const orderIds = await createDrafts('Saving draft')
      await allocateShipping(orderIds)
      for (const rx of prescriptions) {
        session.removePrescription(rx.id)
        createdOrderIdsRef.current.delete(rx.id)
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
      <DrugInteractionAlerts
        medicationNames={prescriptions.map(rx => rx.medicationName)}
        onCheckUnavailable={setInteractionsUnavailable}
      />

      {/* WO-97: allergies not recorded → amber notice with an inline
          "Confirm NKDA". Never blocks Sign & Send or Save as Draft. */}
      <AllergyNotice patient={patient} onSaved={session.updatePatient} />

      {rulesLoadFailed && (
        <div
          role="alert"
          data-testid="rx-rules-load-error"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/20 dark:text-red-200"
        >
          <p className="font-semibold">Prescribing rules could not be loaded.</p>
          <p className="mt-0.5 text-xs">
            Diagnosis and clinical-difference requirements, and the controlled-substance check, depend on them.
            This is an error, not an empty result. You can still save a draft.
          </p>
          <button
            type="button"
            onClick={() => setRulesAttempt(a => a + 1)}
            className="mt-2 rounded-md border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-800 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-transparent dark:text-red-200"
          >
            Retry
          </button>
        </div>
      )}

      {/* WO-102: more than one pharmacy → what the split costs, and a
          re-route only when it is a genuine net saving. */}
      {bundle.notice && (
        <MultiPharmacyNoticeBanner notice={bundle.notice} disabled={isBusy} onReroute={handleReroute} />
      )}

      {/* Prescription list */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Prescriptions ({prescriptions.length})
        </h2>

        {prescriptions.map((rx, index) => {
          const marginCents = rx.retailCents - rx.wholesaleCents
          const platformFeeCents = calcPlatformFeeCents(marginCents)
          const clinicMarginCents = marginCents - platformFeeCents
          const block = sendBlock(rx)
          const invalid = block !== null

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
                  {block === 'package_unit' ? (
                    <p className="mt-1 text-xs font-medium text-red-700" data-testid={`package-unit-mismatch-${rx.id}`}>
                      {rx.packageUnitMismatch}
                    </p>
                  ) : block === 'cycle_pattern' ? (
                    <p className="mt-1 text-xs font-medium text-amber-700" data-testid={`cycle-pattern-required-${rx.id}`}>
                      This cycling prescription was saved before its days on and off were stored. Edit this line to
                      enter them; the quantity is counted from them.
                    </p>
                  ) : block === 'reprice' ? (
                    <p className="mt-1 text-xs font-medium text-amber-700" data-testid={`reprice-required-${rx.id}`}>
                      The pharmacy&apos;s price has changed since the last fill. Edit this line to confirm what the
                      patient pays.
                    </p>
                  ) : block === 'below_cost' ? (
                    <p className="mt-1 text-xs font-medium text-amber-700" data-testid={`below-cost-${rx.id}`}>
                      Priced below cost — {toCurrency(rx.retailCents)} retail against {toCurrency(rx.wholesaleCents)} wholesale
                      today. Edit the price to continue; this cannot be sent as it stands.
                    </p>
                  ) : block && (
                    <p className="mt-1 text-xs font-medium text-amber-700">
                      Missing {block === 'price' ? 'price' : 'directions'} — remove this line and re-add it from search or a protocol.
                    </p>
                  )}
                  {/* WO-106: what the refill decided for the provider. The
                      maintenance dose of a finished titration and a package
                      price that moved are both changes the provider did not
                      make — they are shown here so neither is applied
                      silently, and either can be edited before sending. */}
                  {(rx.maintenanceNote || rx.priceNote) && (
                    <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5" data-testid={`refill-notes-${rx.id}`}>
                      {rx.maintenanceNote && (
                        <p className="text-xs text-amber-800" data-testid={`refill-maintenance-note-${rx.id}`}>
                          {rx.maintenanceNote}
                        </p>
                      )}
                      {rx.priceNote && (
                        <p className="text-xs text-amber-800" data-testid={`refill-price-note-${rx.id}`}>
                          {rx.priceNote}
                        </p>
                      )}
                    </div>
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
                packageLabel={rx.packageLabel ?? null}
                packageCount={rx.packageCount ?? null}
                cycle={rx.sigMode === 'cycling' ? rx.cycle ?? null : null}
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
                  refills={effectiveDetails(rx).refills}
                  patient={{ patientId: patient.patient_id, name: `${patient.first_name} ${patient.last_name}` }}
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
      <div className="rounded-lg border border-border bg-muted/30 p-4" data-testid="review-totals">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Subtotal ({prescriptions.length} prescription{prescriptions.length !== 1 ? 's' : ''})</span>
          <span className="text-sm font-semibold text-foreground" data-testid="review-subtotal">{toCurrency(totalRetailCents)}</span>
        </div>
        {/* WO-102: shipping per pharmacy — once per pharmacy, not per Rx */}
        <ShippingLines shipping={bundle.shipping} absorbShipping={bundle.absorbShipping} rates={bundle.rates} />
        <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>Platform fee (15% of margin, not charged on shipping)</span>
          <span data-testid="review-platform-fee">{toCurrency(totalPlatformFeeCents)}</span>
        </div>
        <div className="flex items-center justify-between text-xs text-emerald-600 font-medium">
          <span>Clinic payout</span>
          <span data-testid="review-clinic-payout">{toCurrency(totalClinicPayoutCents)}</span>
        </div>
        <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
          <span className="text-sm font-medium text-foreground">Patient total</span>
          <span className="text-lg font-bold text-foreground" data-testid="review-patient-total">{toCurrency(totals.patientTotalCents)}</span>
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
          {repriceItems.length > 0 && (
            <p className="mt-1 text-xs text-amber-800 dark:text-amber-300" data-testid="review-reprice-banner">
              {repriceItems.map(rx => rx.medicationName).join(', ')} {repriceItems.length !== 1 ? 'have' : 'has'} a pharmacy
              price that changed since the last fill. Edit the flagged line{repriceItems.length !== 1 ? 's' : ''} above to
              confirm what the patient pays.
            </p>
          )}
          {belowCostItems.length > 0 && (
            <p className="mt-1 text-xs text-amber-800 dark:text-amber-300" data-testid="review-below-cost-banner">
              {belowCostItems.map(rx => rx.medicationName).join(', ')} {belowCostItems.length !== 1 ? 'are' : 'is'} priced
              below what the pharmacy charges today. Edit the price on the flagged prescription
              {belowCostItems.length !== 1 ? 's' : ''} above — sending below cost is refused when the order is created, after
              the signature.
            </p>
          )}
          {cycleItems.length > 0 && (
            <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
              {cycleItems.map(rx => rx.medicationName).join(', ')} {cycleItems.length !== 1 ? 'need' : 'needs'} the days on
              and days off of {cycleItems.length !== 1 ? 'their' : 'its'} cycle. Edit the flagged line{cycleItems.length !== 1 ? 's' : ''} above.
            </p>
          )}
          {malformedItems.length > 0 && (
            <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
              {malformedItems.map(rx => rx.medicationName).join(', ')} {malformedItems.length !== 1 ? 'are' : 'is'} missing a price
              or prescription directions — usually leftovers from a protocol added before pricing was fixed. Remove the flagged
              line{malformedItems.length !== 1 ? 's' : ''} above and re-add {malformedItems.length !== 1 ? 'them' : 'it'} from search
              or the protocol, or use Start Over to clear the session.
            </p>
          )}
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
              }}
              onEnd={() => {
                logSignatureEvent('batch-review-form', 'onEnd')
                readSignaturePad()
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
            {/* WO-99: one payment link for the whole send, however many prescriptions. */}
            You are about to send one payment link for {prescriptions.length} prescription{prescriptions.length !== 1 ? 's' : ''} totaling{' '}
            <strong>{toCurrency(totals.patientTotalCents)}</strong>
            {totals.patientShippingCents > 0 && <> (including {toCurrency(totals.patientShippingCents)} shipping)</>} to{' '}
            <strong>{patient.first_name} {patient.last_name}</strong> at <strong>{patient.phone || 'no phone'}</strong>.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            The link will expire in 72 hours. Once sent, all prescriptions are locked and cannot be edited.
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
                  void handleSignAndSend()
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
            <p className="text-center text-xs text-muted-foreground" data-testid="send-blocked-reason">
              {allergiesLoading
                ? 'Loading the allergy status for this patient — sending waits for it.'
                : allergyStatusUnknown
                ? 'The allergy status for this patient could not be loaded. Retry it above to enable sending.'
                : rulesLoadFailed
                ? 'The prescribing rules for these medications could not be loaded. Retry them above to enable sending.'
                : interactionsUnavailable
                ? 'The drug interaction check could not run. Retry it above to enable sending.'
                : cycleItems.length > 0
                ? 'Edit the flagged prescriptions above to enable sending.'
                : belowCostItems.length > 0 || repriceItems.length > 0
                ? 'Edit the price on the flagged prescriptions above to enable sending.'
                : hasInvalidItems
                ? 'Remove the flagged prescriptions above to enable sending.'
                : hasMissingDetails
                  ? `Complete Rx details to enable sending: ${missingDetailsHint}.`
                  : signatureCheck && !signatureCheck.ok
                  ? SIGNATURE_REJECTION_COPY[signatureCheck.reason]
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
              {cycleItems.length > 0
                ? 'Edit the flagged prescriptions above to enable saving drafts.'
                : belowCostItems.length > 0 || repriceItems.length > 0
                ? 'Edit the price on the flagged prescriptions above to enable saving drafts.'
                : 'Remove the flagged prescriptions above to enable saving drafts.'}
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
          onVerified={code => {
            setShowEpcsGate(false)
            void handleSignAndSend(code)
          }}
          onCancel={() => setShowEpcsGate(false)}
        />
      )}
    </div>
  )
}
