// ============================================================
// Edit target — WO-98
// ============================================================
//
// Which line the builder + margin pages are (re)opening, carried in
// the URL so the existing search → margin flow is reused unchanged:
//
//   ?editId=<session line id>   edit a Review-page line in place
//   ?editOrder=<order id>       edit a DRAFT order line (keeps order_id)
//   ?addToOrder=<order id>      append a new DRAFT line next to that draft
//
// Absent → the normal "add a new line to the session" flow.

import type { SessionPrescription } from '../_context/prescription-session'
import type { BuilderInitialState } from '@/lib/orders/draft-edit'
import { splitDose } from '@/lib/orders/dose'

export type EditTarget =
  | { kind: 'session';   lineId:  string }
  | { kind: 'draft';     orderId: string }
  | { kind: 'draft-add'; orderId: string }

type ParamSource = { get(name: string): string | null } | Record<string, string | string[] | undefined>

function readParam(source: ParamSource, name: string): string {
  const raw = typeof (source as { get?: unknown }).get === 'function'
    ? (source as { get(name: string): string | null }).get(name)
    : (source as Record<string, string | string[] | undefined>)[name]
  const value = Array.isArray(raw) ? raw[0] : raw
  return (value ?? '').trim()
}

export function editTargetFromParams(source: ParamSource): EditTarget | null {
  const editId = readParam(source, 'editId')
  if (editId) return { kind: 'session', lineId: editId }
  const editOrder = readParam(source, 'editOrder')
  if (editOrder) return { kind: 'draft', orderId: editOrder }
  const addToOrder = readParam(source, 'addToOrder')
  if (addToOrder) return { kind: 'draft-add', orderId: addToOrder }
  return null
}

export function editTargetToParams(target: EditTarget | null | undefined): Record<string, string> {
  if (!target) return {}
  switch (target.kind) {
    case 'session':   return { editId: target.lineId }
    case 'draft':     return { editOrder: target.orderId }
    case 'draft-add': return { addToOrder: target.orderId }
  }
}

/** The search-page URL that reopens the builder for a target. */
export function builderHref(target: EditTarget): string {
  return `/new-prescription/search?${new URLSearchParams(editTargetToParams(target)).toString()}`
}

/** Builder inputs for a session line (edit at Review). */
export function builderStateFromLine(line: SessionPrescription): BuilderInitialState {
  const { amount, unit } = splitDose(line.dose)
  return {
    formulationId: line.formulationId,
    pharmacyId:    line.pharmacyId,
    doseAmount:    amount,
    doseUnit:      unit,
    frequency:     line.frequencyCode ?? '',
    quantity:      line.quantityLabel ?? '',
    refills:       line.rxDetails?.refills ?? 0,
    sigText:       line.sigText,
    // WO-105: editing a titration line at Review reopens its step table.
    sigMode:        line.sigMode === 'titration' ? 'titration' : line.sigMode === 'cycling' ? 'cycling' : 'standard',
    titrationSteps: line.sigMode === 'titration' ? (line.titrationSteps ?? []).map(t => ({ ...t })) : [],
  }
}
