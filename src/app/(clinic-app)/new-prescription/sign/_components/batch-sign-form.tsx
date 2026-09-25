'use client'

// ============================================================
// Batch Sign Form — WO-99
// ============================================================
//
// Every selected draft, grouped by patient, one signature pad, one Sign &
// Send. The safety checks the single-draft page had (#164–#166) hold here
// for every patient and every line:
//
//   - allergy status per patient: loading (no Confirm NKDA while it
//     loads), a failure that says so with Retry in place, then the
//     result
//   - the drug interaction check, across that patient's selected lines
//   - per-line checks from POST /api/orders/batch-sign/check: another
//     provider's draft, a price that moved (WO-108 reprice) or is below
//     cost, missing Rx details (clinical difference / diagnosis), a
//     schedule that must go by fax…
//
// Any check that fails or could not run blocks Sign & Send for the whole
// batch and the reason names the line. What a check FINDS (recorded
// allergies, a known interaction) is shown and never blocks.
//
// All or nothing: the server validates every line before it signs any.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import SignatureCanvas from 'react-signature-canvas'
import { AllergyChip, loadAllergies } from '../../_components/allergy-chip'
import { AllergyNotice } from '../../review/_components/allergy-notice'
import { DrugInteractionAlerts } from '../../_components/drug-interaction-alerts'
import { EpcsTotpGate } from '../../_components/epcs-totp-gate'
import { SignAsMePanel } from './sign-as-me-panel'
import { builderHref } from '../../_lib/edit-target'
import { dosingDaysIn } from '@/lib/orders/cycling'
import {
  batchSignHref,
  isControlledLine,
  patientBatchTotals,
  type BatchDraftLine,
  type BatchPatientView,
} from '@/lib/orders/batch-sign-view'
import { checkSignature, signatureFromPad, SIGNATURE_REJECTION_COPY, type SignatureCheck } from '@/lib/orders/signature'
import type { PharmacyShippingRates } from '@/lib/orders/shipping'
import { formatDiagnosis, syringeOptionLabel, shippingTypeLabel } from '@/lib/orders/rx-details'

function toCurrency(cents: number): string {
  return '$' + (cents / 100).toFixed(2)
}

interface Problem {
  orderId:        string | null
  medicationName: string | null
  code:           string
  message:        string
}

type AllergyState =
  | { state: 'loading' }
  | { state: 'failed' }
  | { state: 'loaded'; allergies: string[]; nkda: boolean; updatedAt: string | null }

type CheckState =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'failed'; message: string }
  | { state: 'loaded'; problems: Problem[]; controlledIds: string[] }

interface Props {
  patients:       BatchPatientView[]
  preselected:    string[]
  signer:         { providerId: string; name: string; npi: string }
  rates:          PharmacyShippingRates[]
  absorbShipping: boolean
}

export function BatchSignForm({ patients, preselected, signer, rates, absorbShipping }: Props) {
  const router = useRouter()
  const sigCanvasRef = useRef<SignatureCanvas>(null)

  const [selected, setSelected] = useState<Set<string>>(() => new Set(preselected))
  // A draft that becomes mine after the first render (Sign as me, then the
  // server re-renders with it pre-selected) is ticked too. The selection
  // was seeded once, so a reassigned line came back unticked and the page
  // read "signing 0 prescriptions" (prod, 2026-09-25). Only ids NEW to
  // the pre-selection are added: a line the provider unticked stays so.
  const seenPreselected = useRef<Set<string>>(new Set(preselected))
  const preselectedKey = preselected.join(',')
  useEffect(() => {
    const fresh = preselected.filter(id => !seenPreselected.current.has(id))
    if (fresh.length === 0) return
    fresh.forEach(id => seenPreselected.current.add(id))
    setSelected(prev => new Set([...prev, ...fresh]))
    // preselectedKey is the content of preselected
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectedKey])
  const allLines = useMemo(() => patients.flatMap(p => p.lines), [patients])
  const selectedLines = allLines.filter(l => selected.has(l.orderId))
  const selectedIds = selectedLines.map(l => l.orderId)
  const selectedKey = selectedIds.join(',')
  const activePatients = patients.filter(p => p.lines.some(l => selected.has(l.orderId)))

  // ── Allergy status per patient ──
  const [allergy, setAllergy] = useState<Record<string, AllergyState>>({})
  useEffect(() => {
    let cancelled = false
    for (const p of patients) {
      loadAllergies(p.patientId)
        .then(loaded => {
          if (!cancelled) setAllergy(prev => ({ ...prev, [p.patientId]: { state: 'loaded', allergies: loaded.allergies, nkda: loaded.nkda, updatedAt: loaded.allergiesUpdatedAt } }))
        })
        .catch(err => {
          console.error('[batch-sign] allergy status could not be loaded:', err instanceof Error ? err.message : err, '| patient=', p.patientId)
          if (!cancelled) setAllergy(prev => ({ ...prev, [p.patientId]: { state: 'failed' } }))
        })
    }
    return () => { cancelled = true }
  }, [patients])

  // ── Interaction check per patient ──
  const [interactionsUnavailable, setInteractionsUnavailable] = useState<Record<string, boolean>>({})
  const onInteractionsUnavailable = useCallback((patientId: string, unavailable: boolean) => {
    setInteractionsUnavailable(prev => (prev[patientId] === unavailable ? prev : { ...prev, [patientId]: unavailable }))
  }, [])

  // ── Per-line checks (server) ──
  // Results are keyed by the selection they were run for, so the state
  // shown is derived, not set from the effect: no result for this
  // selection yet = checking. A failure stays on screen while its Retry is
  // in flight, so Sign & Send never flickers open on a retry that fails
  // again (#165).
  type CheckResult =
    | { key: string; state: 'failed'; message: string }
    | { key: string; state: 'loaded'; problems: Problem[]; controlledIds: string[] }
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null)
  const [checkAttempt, setCheckAttempt] = useState(0)
  const checkKey = `${selectedKey}#${checkAttempt}`
  useEffect(() => {
    if (!selectedKey) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/orders/batch-sign/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderIds: selectedKey.split(',') }),
        })
        const body = await res.json().catch(() => ({})) as { error?: string; problems?: Problem[]; lines?: Array<{ orderId: string; controlled: boolean }> }
        if (cancelled) return
        if (!res.ok) {
          console.error('[batch-sign] line checks could not run:', res.status)
          setCheckResult({ key: checkKey, state: 'failed', message: body.error ?? 'The prescription checks could not be run.' })
          return
        }
        setCheckResult({
          key: checkKey,
          state: 'loaded',
          problems: body.problems ?? [],
          controlledIds: (body.lines ?? []).filter(l => l.controlled).map(l => l.orderId),
        })
      } catch (err) {
        console.error('[batch-sign] line checks could not run:', err instanceof Error ? err.message : err)
        if (!cancelled) setCheckResult({ key: checkKey, state: 'failed', message: 'The prescription checks could not be run.' })
      }
    })()
    return () => { cancelled = true }
  }, [selectedKey, checkKey])
  const check: CheckState = !selectedKey
    ? { state: 'idle' }
    : checkResult?.key === checkKey
    ? checkResult
    : checkResult?.state === 'failed' && checkResult.key.startsWith(`${selectedKey}#`)
    ? checkResult
    : { state: 'loading' }

  // ── Signature ──
  const [signature, setSignature] = useState<SignatureCheck | null>(null)
  function readPad() {
    setSignature(checkSignature(signatureFromPad(sigCanvasRef.current as unknown as Parameters<typeof signatureFromPad>[0])))
  }
  function clearPad() {
    sigCanvasRef.current?.clear()
    setSignature(null)
  }

  // ── Send ──
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [serverProblems, setServerProblems] = useState<Problem[]>([])
  const [showEpcsGate, setShowEpcsGate] = useState(false)

  const lineProblems = new Map<string, Problem[]>()
  const batchProblems: Problem[] = []
  const shownProblems = [...(check.state === 'loaded' ? check.problems : []), ...serverProblems]
  for (const p of shownProblems) {
    if (p.orderId && selected.has(p.orderId)) lineProblems.set(p.orderId, [...(lineProblems.get(p.orderId) ?? []), p])
    else if (!p.orderId) batchProblems.push(p)
  }

  const controlledSelected = selectedLines.filter(l =>
    check.state === 'loaded' ? check.controlledIds.includes(l.orderId) : isControlledLine(l))

  // Why Sign & Send is disabled — always named, and naming the line.
  const nameOf = (p: BatchPatientView) => `${p.firstName} ${p.lastName}`
  let blocked: string | null = null
  if (selectedLines.length === 0) blocked = 'Select at least one prescription to sign.'
  else {
    const loadingAllergy = activePatients.find(p => (allergy[p.patientId]?.state ?? 'loading') === 'loading')
    const failedAllergy = activePatients.find(p => allergy[p.patientId]?.state === 'failed')
    const noInteractions = activePatients.find(p => interactionsUnavailable[p.patientId])
    const firstLineProblem = [...lineProblems.entries()][0]
    if (loadingAllergy) blocked = `Loading the allergy status for ${nameOf(loadingAllergy)} — sending waits for it.`
    else if (failedAllergy) blocked = `The allergy status for ${nameOf(failedAllergy)} could not be loaded. Retry it above to enable sending.`
    else if (noInteractions) blocked = `The drug interaction check for ${nameOf(noInteractions)} could not run. Retry it above to enable sending.`
    else if (check.state === 'loading' || check.state === 'idle') blocked = 'Checking the selected prescriptions…'
    else if (check.state === 'failed') blocked = `${check.message} Retry it above to enable sending.`
    else if (batchProblems.length > 0) blocked = batchProblems[0]!.message
    else if (firstLineProblem) blocked = firstLineProblem[1][0]!.message
    else if (!signature) blocked = 'Sign in the signature box below to enable sending.'
    else if (!signature.ok) blocked = SIGNATURE_REJECTION_COPY[signature.reason]
  }
  const canSend = blocked === null && !submitting

  async function send(totpCode?: string) {
    const payload = signatureFromPad(sigCanvasRef.current as unknown as Parameters<typeof signatureFromPad>[0])
    const sig = checkSignature(payload)
    if (!sig.ok) {
      setSignature(sig)
      setSubmitError(SIGNATURE_REJECTION_COPY[sig.reason])
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    setServerProblems([])
    try {
      const res = await fetch('/api/orders/batch-sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderIds: selectedIds, signature: sig.signature, ...(totpCode ? { totpCode } : {}) }),
      })
      const body = await res.json().catch(() => ({})) as { error?: string; code?: string; problems?: Problem[] }
      if (res.ok) {
        router.push(`/dashboard?sent=${selectedIds.length}`)
        return
      }
      if (body.code === 'TOTP_REQUIRED') {
        // The server found a controlled line the page did not know about
        // (e.g. a schedule that could not be read): ask for the code.
        setShowEpcsGate(true)
      }
      setServerProblems(body.problems ?? [])
      const message = body.error ?? 'Signing failed.'
      setSubmitError(/nothing was signed/i.test(message) ? message : `${message} Nothing was signed.`)
      setSubmitting(false)
    } catch (err) {
      setSubmitError(`${err instanceof Error ? err.message : 'Signing failed.'} Nothing was signed.`)
      setSubmitting(false)
    }
  }

  function handleSignAndSend() {
    if (!canSend) return
    if (controlledSelected.length > 0) setShowEpcsGate(true)
    else void send()
  }

  function toggle(orderId: string) {
    setServerProblems([])
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(orderId)) next.delete(orderId)
      else next.add(orderId)
      return next
    })
  }

  const grandTotalCents = activePatients.reduce((sum, p) => {
    const lines = p.lines.filter(l => selected.has(l.orderId))
    return sum + patientBatchTotals(lines, rates, absorbShipping).totals.patientTotalCents
  }, 0)

  return (
    <div className="space-y-6">
      {controlledSelected.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3" data-testid="batch-epcs-banner">
          <p className="text-sm font-semibold text-red-800">Controlled Substance — EPCS 2FA Required</p>
          <p className="mt-1 text-xs text-red-700">
            {controlledSelected.map(l => l.medicationName).join(', ')} {controlledSelected.length === 1 ? 'is' : 'are'} controlled.
            Your authenticator code is required once, for the whole batch, at signing (DEA 21 CFR 1311).
          </p>
        </div>
      )}

      {check.state === 'failed' && (
        <div role="alert" data-testid="batch-check-error" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <p className="font-semibold">{check.message}</p>
          <p className="mt-0.5 text-xs">This is an error, not a clean result. Nothing has been signed.</p>
          <button
            type="button"
            onClick={() => setCheckAttempt(a => a + 1)}
            className="mt-2 rounded-md border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-800 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Retry
          </button>
        </div>
      )}

      {batchProblems.length > 0 && (
        <div role="alert" data-testid="batch-problems" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {batchProblems.map((p, i) => <p key={i}>{p.message}</p>)}
        </div>
      )}

      {patients.map(p => {
        const state = allergy[p.patientId] ?? { state: 'loading' as const }
        const allergyPatient = {
          patient_id:           p.patientId,
          first_name:           p.firstName,
          last_name:            p.lastName,
          allergies:            state.state === 'loaded' ? state.allergies : undefined,
          nkda:                 state.state === 'loaded' ? state.nkda : undefined,
          allergies_updated_at: state.state === 'loaded' ? state.updatedAt : null,
          allergiesLoadFailed:  state.state === 'failed',
        }
        const chosen = p.lines.filter(l => selected.has(l.orderId))
        const unchosen = p.lines.filter(l => !selected.has(l.orderId))
        const { shipping, totals } = patientBatchTotals(chosen, rates, absorbShipping)
        return (
          <section key={p.patientId} className="space-y-3 rounded-lg border border-border p-4" data-testid={`batch-patient-${p.patientId}`}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Patient</p>
                <p className="text-sm font-semibold text-foreground">{p.firstName} {p.lastName}</p>
                <p className="text-xs text-muted-foreground">DOB: {p.dob} — {p.state} — {p.phone || 'no phone'}</p>
              </div>
              <AllergyChip patient={allergyPatient} loading={state.state === 'loading'} />
            </div>

            <div className="space-y-3" data-testid="draft-safety-checks">
              <AllergyNotice
                patient={allergyPatient}
                onSaved={patch => setAllergy(prev => ({
                  ...prev,
                  [p.patientId]: patch.allergiesLoadFailed === true
                    ? { state: 'failed' }
                    : { state: 'loaded', allergies: patch.allergies, nkda: patch.nkda, updatedAt: patch.allergies_updated_at },
                }))}
              />
              {chosen.length > 0 && (
                <DrugInteractionAlerts
                  medicationNames={chosen.map(l => l.medicationName)}
                  onCheckUnavailable={unavailable => onInteractionsUnavailable(p.patientId, unavailable)}
                />
              )}
            </div>

            {p.others.map(o => (
              <SignAsMePanel
                key={o.providerId}
                orderId={o.anchorOrderId}
                assignedProviderName={o.providerName}
                myProviderName={signer.name}
                lineCount={o.count}
                onReassigned={ids => {
                  // Back selected: ticked now, and in the URL the page
                  // re-renders from (so a reload keeps them).
                  setSelected(prev => new Set([...prev, ...ids]))
                  router.replace(batchSignHref([...new Set([...selectedIds, ...ids])]))
                }}
              />
            ))}

            {p.lines.length > 0 && (
              <DraftLineList
                patient={p}
                selected={selected}
                selectionIds={selectedIds}
                problems={lineProblems}
                disabled={submitting}
                onToggle={toggle}
              />
            )}

            {unchosen.length > 0 && chosen.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid={`unselected-siblings-${p.patientId}`}>
                <span>
                  {unchosen.length} more draft{unchosen.length !== 1 ? 's' : ''} for {p.firstName} {p.lastName} {unchosen.length !== 1 ? 'are' : 'is'} not selected.
                  Signed separately, {unchosen.length !== 1 ? 'they send' : 'it sends'} a second payment link and can charge shipping again.
                </span>
                <button
                  type="button"
                  onClick={() => setSelected(prev => new Set([...prev, ...unchosen.map(l => l.orderId)]))}
                  className="rounded-md border border-amber-300 bg-white px-2 py-1 font-medium hover:bg-amber-100"
                >
                  Select all for {p.firstName}
                </button>
              </div>
            )}

            {chosen.length > 0 && (
              <div className="rounded-md bg-muted/30 p-3 text-sm" data-testid={`batch-totals-${p.patientId}`}>
                <div className="flex justify-between"><span className="text-muted-foreground">Subtotal ({chosen.length})</span><span>{toCurrency(totals.subtotalCents)}</span></div>
                {shipping.byPharmacy.map(s => (
                  <div key={s.pharmacyId} className="flex justify-between text-xs text-muted-foreground" data-testid={`batch-shipping-${p.patientId}-${s.pharmacyId}`}>
                    <span>Shipping — {s.pharmacyName || 'pharmacy'} ({s.itemCount} item{s.itemCount !== 1 ? 's' : ''}, once){absorbShipping ? ', absorbed by the clinic' : ''}</span>
                    <span>{toCurrency(s.feeCents)}</span>
                  </div>
                ))}
                <div className="flex justify-between text-xs text-muted-foreground"><span>Platform fee (15% of margin)</span><span>{toCurrency(totals.platformFeeCents)}</span></div>
                <div className="flex justify-between text-xs text-emerald-600"><span>Clinic payout</span><span>{toCurrency(totals.clinicPayoutCents)}</span></div>
                <div className="mt-1 flex justify-between border-t border-border pt-1 font-semibold">
                  <span>Patient total — one payment link</span>
                  <span data-testid={`batch-patient-total-${p.patientId}`}>{toCurrency(totals.patientTotalCents)}</span>
                </div>
              </div>
            )}
          </section>
        )
      })}

      {/* Nothing here is mine to sign yet (only another provider's
          drafts, awaiting Sign as me): no pad, no Sign & Send. */}
      {allLines.length > 0 && (<>
      {/* One signature pad for the whole batch. */}
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Provider Signature — {signer.name}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          NPI: {signer.npi} — signing {selectedLines.length} prescription{selectedLines.length !== 1 ? 's' : ''}
          {activePatients.length > 0 ? ` for ${activePatients.map(nameOf).join(', ')}` : ''}
        </p>
        <div className="mt-3 rounded-lg border border-border bg-white">
          <SignatureCanvas
            ref={sigCanvasRef}
            canvasProps={{ className: 'w-full h-32 rounded-lg', 'aria-label': 'Provider signature pad' }}
            onEnd={readPad}
          />
        </div>
        <div className="mt-2 flex items-center justify-between">
          <button type="button" onClick={clearPad} disabled={submitting} className="text-xs text-muted-foreground underline hover:text-foreground disabled:opacity-50">
            Clear Signature
          </button>
          {signature?.ok && <span className="text-xs font-medium text-emerald-600">Signature captured</span>}
        </div>
      </div>

      {submitError && (
        <div role="alert" data-testid="batch-submit-error" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {submitError}
        </div>
      )}

      {activePatients.length > 0 && (
        <p className="text-xs text-muted-foreground" data-testid="batch-send-summary">
          Sends {activePatients.length} payment link{activePatients.length !== 1 ? 's' : ''} — one per patient — totaling {toCurrency(grandTotalCents)}.
          Links expire in 72 hours; signed prescriptions are locked.
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => router.push('/dashboard')}
          className="rounded-md border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted/50"
        >
          Back to Dashboard
        </button>
        <button
          type="button"
          onClick={handleSignAndSend}
          disabled={!canSend}
          className={`flex-1 rounded-lg px-6 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            canSend ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'cursor-not-allowed bg-muted text-muted-foreground'
          }`}
        >
          {submitting ? 'Signing…' : `Sign & Send ${selectedLines.length} Prescription${selectedLines.length !== 1 ? 's' : ''}`}
        </button>
      </div>
      {blocked && !submitting && (
        <p className="text-center text-xs text-muted-foreground" data-testid="send-blocked-reason">{blocked}</p>
      )}
      </>)}

      {showEpcsGate && (
        <EpcsTotpGate
          providerId={signer.providerId}
          providerName={signer.name}
          medicationNames={controlledSelected.map(l => l.medicationName)}
          deaSchedules={controlledSelected.map(l => l.deaSchedule)}
          onVerified={code => {
            setShowEpcsGate(false)
            void send(code)
          }}
          // Cancel leaves every order unsigned: nothing was sent.
          onCancel={() => setShowEpcsGate(false)}
        />
      )}
    </div>
  )
}

// ── One patient's draft lines ─────────────────────────────────

function DraftLineList({ patient, selected, selectionIds, problems, disabled, onToggle }: {
  patient:  BatchPatientView
  selected: Set<string>
  /** The page's whole selection, carried through the builder and back. */
  selectionIds: string[]
  problems: Map<string, Problem[]>
  disabled: boolean
  onToggle: (orderId: string) => void
}) {
  const router = useRouter()
  const [removing, setRemoving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const anchor = patient.lines[0]!.orderId

  async function remove(orderId: string) {
    setRemoving(orderId)
    setError(null)
    try {
      const res = await fetch(`/api/orders/${orderId}`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(err.error ?? 'Failed to remove the line')
      }
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred')
    } finally {
      setRemoving(null)
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm" data-testid="draft-lines">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Draft lines ({patient.lines.length})</p>
        <button
          type="button"
          onClick={() => router.push(builderHref({ kind: 'draft-add', orderId: anchor, returnOrders: selectionIds }))}
          className="text-xs font-medium text-primary underline hover:text-primary/80"
        >
          + Add prescription
        </button>
      </div>
      <ul className="mt-2 divide-y divide-border">
        {patient.lines.map(line => (
          <DraftLineItem
            key={line.orderId}
            line={line}
            checked={selected.has(line.orderId)}
            problems={problems.get(line.orderId) ?? []}
            disabled={disabled || removing !== null}
            removing={removing === line.orderId}
            onToggle={() => onToggle(line.orderId)}
            onEdit={() => router.push(builderHref({ kind: 'draft', orderId: line.orderId, returnOrders: selectionIds.includes(line.orderId) ? selectionIds : [...selectionIds, line.orderId] }))}
            onRemove={() => void remove(line.orderId)}
          />
        ))}
      </ul>
      {error && <p className="mt-2 text-xs text-red-600" role="alert">{error}</p>}
    </div>
  )
}

function DraftLineItem({ line, checked, problems, disabled, removing, onToggle, onEdit, onRemove }: {
  line: BatchDraftLine; checked: boolean; problems: Problem[]; disabled: boolean; removing: boolean
  onToggle: () => void; onEdit: () => void; onRemove: () => void
}) {
  const d = line.rxDetails
  const diagnosis = formatDiagnosis(d.diagnosisCode, d.diagnosisText)
  return (
    <li className="py-3 first:pt-2 last:pb-0" data-testid={`draft-line-${line.orderId}`}>
      <div className="flex items-start justify-between gap-4">
        <label className="flex min-w-0 items-start gap-3">
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggle}
            disabled={disabled}
            aria-label={`Sign ${line.medicationName}`}
            data-testid={`select-${line.orderId}`}
            className="mt-1 h-4 w-4"
          />
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-foreground">{line.medicationName}</span>
            <span className="block text-xs text-muted-foreground">{line.form} — {line.dose} — {line.pharmacyName}</span>
            <span className="mt-1 block text-xs italic text-muted-foreground">Sig: {line.sigText}</span>
            {line.sigMode === 'titration' && line.titrationSteps.length > 0 && (
              <span className="mt-1 block text-[11px] text-muted-foreground" data-testid={`titration-steps-${line.orderId}`}>
                Titration: {line.titrationSteps.map((s, i) => `step ${i + 1} ${s.dose} ${s.unit} ${s.frequency} × ${s.weeks} wk`).join(' → ')}
              </span>
            )}
            {line.sigMode === 'cycling' && (
              <span className="mt-1 block text-[11px] text-muted-foreground" data-testid={`cycle-${line.orderId}`}>
                {line.cyclePattern
                  ? `Cycling: ${line.cyclePattern.onDays} on / ${line.cyclePattern.offDays} off${line.rxDetails.daysSupply != null ? ` · ${dosingDaysIn(line.rxDetails.daysSupply, line.cyclePattern)} dosing days in ${line.rxDetails.daysSupply}` : ''}`
                  : 'Cycling: days on / off not stored (saved before they were). Edit to enter them before a refill.'}
              </span>
            )}
            {line.refillOfOrderId && (
              <span className="mt-1 block text-[11px] text-muted-foreground" data-testid={`refill-of-${line.orderId}`}>
                Refill of order {line.refillOfOrderId.slice(0, 8)}
              </span>
            )}
          </span>
        </label>
        <div className="shrink-0 text-right">
          <p className="text-sm font-bold text-foreground">{toCurrency(line.retailCents)}</p>
          <div className="mt-1 flex justify-end gap-3">
            <button type="button" onClick={onEdit} disabled={disabled} className="text-[10px] font-medium text-primary underline hover:text-primary/80 disabled:opacity-50">
              Edit
            </button>
            <button type="button" onClick={onRemove} disabled={disabled} className="text-[10px] text-red-500 underline hover:text-red-700 disabled:opacity-50">
              {removing ? 'Removing...' : 'Remove'}
            </button>
          </div>
        </div>
      </div>
      {/* WO-96: Rx details, collapsed. */}
      <details className="mt-2 text-xs text-muted-foreground" data-testid={`rx-details-${line.orderId}`}>
        <summary className="cursor-pointer">Rx details</summary>
        <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5">
          <dt>Days supply</dt><dd>{d.daysSupply ?? '—'}</dd>
          <dt>Refills</dt><dd>{d.refills}</dd>
          <dt>Substitution</dt><dd>{d.substitutionAllowed ? 'Allowed' : 'Dispense as written'}</dd>
          <dt>Syringes</dt><dd>{syringeOptionLabel(d.syringeOption)}</dd>
          <dt>Shipping</dt><dd>{shippingTypeLabel(d.shippingType)}</dd>
          {d.clinicalDifference && (<><dt>Clinical difference</dt><dd>{d.clinicalDifference}</dd></>)}
          {diagnosis && (<><dt>Diagnosis</dt><dd>{diagnosis}</dd></>)}
        </dl>
      </details>
      {checked && problems.map((p, i) => (
        <p key={i} role="alert" className="mt-2 text-xs font-medium text-amber-700" data-testid={`line-problem-${line.orderId}`}>
          {p.message}
        </p>
      ))}
    </li>
  )
}
