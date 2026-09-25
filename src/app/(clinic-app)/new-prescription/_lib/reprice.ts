// ============================================================
// WO-108 — the price step a moved package price sends you to
// ============================================================
//
// A refill whose wholesale has moved since the source order cannot be
// priced by carrying the old retail forward: the clinic would absorb the
// move without being asked. The provider confirms the price on the step
// that already exists (/new-prescription/margin), which saves back to
// the session line through editId — the WO-98 edit-at-review mechanism.
// No new step, no new route.
//
// Plain module, deliberately without 'use client': the picker and the
// price step both import it, and a server page may too. Guarded by
// src/__tests__/server-client-boundary-static-guard.test.ts.

import type { SessionPrescription } from '../_context/prescription-session'
import { builderHref } from './edit-target'

/** Lines still waiting for the provider to confirm a moved price. */
export function linesNeedingReprice(
  prescriptions: ReadonlyArray<SessionPrescription>,
): SessionPrescription[] {
  return prescriptions.filter(rx => rx.repriceRequired === true)
}

/**
 * The price step for one line, carrying what the builder would have
 * passed. Several moved lines are done one at a time, in the order they
 * appear on Review.
 */
export function repriceHref(line: SessionPrescription): string {
  const params = new URLSearchParams()
  params.set('pharmacyId', line.pharmacyId)
  if (line.formulationId) params.set('formulation_id', line.formulationId)
  if (line.itemId)        params.set('itemId', line.itemId)
  params.set('dose', line.dose)
  if (line.frequencyCode) params.set('frequency', line.frequencyCode)
  params.set('sigText', line.sigText)
  if (line.quantityLabel) params.set('quantity', line.quantityLabel)
  params.set('refills', String(line.rxDetails?.refills ?? 0))
  // '' is meaningful on this page: "no duration chosen". A refill always
  // has one, derived from the source order.
  params.set('durationDays', line.rxDetails?.daysSupply != null ? String(line.rxDetails.daysSupply) : '')
  if (line.sigMode) params.set('sigMode', line.sigMode)
  if (line.sigMode === 'titration' && line.titrationSteps?.length) {
    params.set('titrationSteps', JSON.stringify(line.titrationSteps))
  }
  if (line.sigMode === 'cycling' && line.cycle) {
    params.set('cycleOnDays', String(line.cycle.onDays))
    params.set('cycleOffDays', String(line.cycle.offDays))
  }
  params.set('editId', line.id)
  return `/new-prescription/margin?${params.toString()}`
}

/**
 * Where to go once a line has been priced: the next line still waiting,
 * or Review when none is. `justSavedId` is excluded because the session
 * patch that clears its flag may not have been applied yet.
 */
export function nextAfterReprice(
  prescriptions: ReadonlyArray<SessionPrescription>,
  justSavedId: string | null,
): string {
  const next = linesNeedingReprice(prescriptions).find(rx => rx.id !== justSavedId)
  return next ? repriceHref(next) : '/new-prescription/review'
}

/** A cycling line with no on/off pattern: the dose step owes a decision. */
export function needsCyclePattern(line: Pick<SessionPrescription, 'sigMode' | 'cycle'>): boolean {
  return line.sigMode === 'cycling' && !line.cycle
}

/**
 * Where a refill lands. A cycling line written before its pattern was
 * stored stops at the dose step, in cycling mode, asking for the days on
 * and off — it is never refilled as daily dosing. Then a moved price
 * stops at the price step (WO-108). Otherwise Review.
 */
export function refillLandingHref(lines: ReadonlyArray<SessionPrescription>): string {
  const owed = lines.find(needsCyclePattern)
  if (owed) return builderHref({ kind: 'session', lineId: owed.id })
  const moved = lines.find(line => line.repriceRequired === true)
  return moved ? repriceHref(moved) : '/new-prescription/review'
}
