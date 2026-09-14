// ============================================================
// Draft editing helpers — WO-98
// ============================================================
//
// A "draft" is a DRAFT order row (one per prescription line — an
// N-line session saves as N draft orders, see POC-DEMO-DETAILED §3H).
// Editing a draft keeps its order_id; every edit and every removal
// writes one append-only row to order_status_history with
// old_status = new_status = DRAFT and a metadata envelope carrying the
// event, the actor and the field diff. No new table: the existing
// audit trail already has the append-only RLS + index we need.
//
// Removal is a soft delete (is_active = false, deleted_at = now()) —
// REQ-OAS-010 forbids physical DELETE on orders.
//
// Permission: a provider may edit any draft in their clinic; any other
// clinic role (medical_assistant, clinic_admin) may edit only the drafts
// they created. "Created by" is the actor on the draft_created audit
// row POST /api/orders writes, so nothing is added to `orders`.

import type { Json } from '@/types/database.types'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { RX_DETAIL_COLUMN_LIST } from './rx-details'

export type DraftAuditEvent = 'draft_created' | 'draft_edited' | 'draft_line_removed'

export interface DraftAuditActor {
  user_id: string
  role:    string | null
}

export type FieldDiff = Record<string, { from: Json; to: Json }>

/** Columns compared for the edit diff (plus the snapshot keys below). */
const DIFF_COLUMNS = [
  'formulation_id',
  'catalog_item_id',
  'pharmacy_id',
  'retail_price_snapshot',
  'wholesale_price_snapshot',
  'sig_text',
  // WO-101
  'package_id',
  'package_label',
  ...RX_DETAIL_COLUMN_LIST.split(',').map(s => s.trim()),
] as const

/** Keys inside medication_snapshot / pharmacy_snapshot worth auditing. */
const MEDICATION_SNAPSHOT_KEYS = ['medication_name', 'dose', 'prescribed_dose', 'frequency_code', 'quantity_label'] as const
const PHARMACY_SNAPSHOT_KEYS   = ['name'] as const

type Row = Record<string, unknown>

function asJson(v: unknown): Json {
  return (v === undefined ? null : v) as Json
}

function isEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

/**
 * Field-level diff between the draft row before and after an edit.
 * Only changed fields appear; nested snapshot keys are flattened as
 * `medication_snapshot.prescribed_dose` etc.
 */
export function diffDraftRows(before: Row, after: Row): FieldDiff {
  const diff: FieldDiff = {}
  for (const col of DIFF_COLUMNS) {
    if (!(col in after)) continue
    if (!isEqual(before[col], after[col])) {
      diff[col] = { from: asJson(before[col]), to: asJson(after[col]) }
    }
  }
  const snapshots: Array<[string, ReadonlyArray<string>]> = [
    ['medication_snapshot', MEDICATION_SNAPSHOT_KEYS],
    ['pharmacy_snapshot',   PHARMACY_SNAPSHOT_KEYS],
  ]
  for (const [snapshot, keys] of snapshots) {
    if (!(snapshot in after)) continue
    const b = (before[snapshot] ?? {}) as Row
    const a = (after[snapshot] ?? {}) as Row
    for (const key of keys) {
      if (!isEqual(b[key], a[key])) {
        diff[`${snapshot}.${key}`] = { from: asJson(b[key]), to: asJson(a[key]) }
      }
    }
  }
  return diff
}

export interface DraftAuditMetadata {
  event:  DraftAuditEvent
  actor:  DraftAuditActor
  diff?:  FieldDiff
  /** Set on draft_created when the line was appended to an existing draft. */
  appended_to_order_id?: string | null
}

type ServiceClient = SupabaseClient<Database>

/**
 * Append one DRAFT → DRAFT audit row. Non-fatal on failure (the data
 * change has already committed), mirrors writeStatusHistory in
 * cas-transition.ts. Returns whether the row was written.
 */
export async function writeDraftAudit(
  supabase: ServiceClient,
  orderId: string,
  metadata: DraftAuditMetadata,
): Promise<boolean> {
  const { error } = await supabase.from('order_status_history').insert({
    order_id:   orderId,
    old_status: 'DRAFT',
    new_status: 'DRAFT',
    changed_by: metadata.actor.user_id,
    metadata:   metadata as unknown as Json,
  })
  if (error) {
    console.error(`[draft-edit] audit row failed for ${orderId} (${metadata.event}):`, error.message)
    return false
  }
  return true
}

export interface DraftActor {
  userId: string
  role:   string | null
}

/**
 * Who may edit this draft. Providers: any draft in their clinic (the
 * caller has already scoped the row to the clinic). Everyone else: only
 * a draft they created, i.e. a draft_created audit row with them as
 * the actor.
 */
export async function canEditDraft(
  supabase: ServiceClient,
  orderId: string,
  actor: DraftActor,
): Promise<boolean> {
  if (actor.role === 'provider') return true
  const { data, error } = await supabase
    .from('order_status_history')
    .select('history_id')
    .eq('order_id', orderId)
    .eq('changed_by', actor.userId)
    .contains('metadata', { event: 'draft_created' })
    .limit(1)
  if (error) {
    console.error('[draft-edit] creator lookup failed:', error.message)
    return false
  }
  return (data?.length ?? 0) > 0
}

// ── Builder state recovered from a draft row ─────────────────

export interface BuilderInitialState {
  formulationId: string | null
  pharmacyId:    string
  doseAmount:    string
  doseUnit:      string
  frequency:     string
  quantity:      string
  refills:       number
  sigText:       string
}

/** Frequency sig fragments → codes (mirrors FREQUENCY_OPTIONS in the sig builder). */
const FREQUENCY_SIG: ReadonlyArray<[string, string]> = [
  ['monday through friday, weekends off', 'MF'],
  ['2-3 times per week', 'TIW'],
  ['three times daily',  'TID'],
  ['four times daily',   'QID'],
  ['every other day',    'QOD'],
  ['every 2 weeks',      'Q2W'],
  ['twice daily',        'BID'],
  ['once weekly',        'QW'],
  ['once daily',         'QD'],
  ['at bedtime',         'QHS'],
  ['as needed',          'PRN'],
]

const DOSE_RE = /(\d+(?:\.\d+)?)\s*(units?|mg|mL|mcg|tablets?|capsules?|clicks?)\b/i

function normaliseUnit(u: string): string {
  const l = u.toLowerCase()
  if (l.startsWith('unit')) return 'units'
  if (l === 'ml') return 'mL'
  if (l.startsWith('tablet')) return 'tablet'
  if (l.startsWith('capsule')) return 'capsule'
  if (l.startsWith('click')) return 'click'
  return l
}

/** Best-effort dose + frequency recovered from a generated sig ("Inject 10 units … once weekly"). */
export function parseSigForBuilder(sig: string | null | undefined): { doseAmount: string; doseUnit: string; frequency: string } {
  const text = sig ?? ''
  const m = DOSE_RE.exec(text)
  const lower = text.toLowerCase()
  const freq = FREQUENCY_SIG.find(([fragment]) => lower.includes(fragment))
  return {
    doseAmount: m?.[1] ?? '',
    doseUnit:   m?.[2] ? normaliseUnit(m[2]) : '',
    frequency:  freq?.[1] ?? '',
  }
}

/** A dose string that is exactly a dose ("10 units", "0.5 mg") — not a strength like "5mg/mL". */
const PURE_DOSE_RE = /^\s*(\d+(?:\.\d+)?)\s*(units?|mg|mL|mcg|tablets?|capsules?|clicks?)\s*$/i

export interface StructuredLineInputs {
  /** "10 units" — the prescribed dose */
  dose:          string | null
  /** structured-sig frequency code ("QW") */
  frequencyCode: string | null
  /** pharmacy package label ("1mL vial") */
  quantityLabel: string | null
}

/**
 * The builder inputs for an order line: dose, frequency and quantity.
 *
 * Structured values always win. The builder sets them explicitly and they
 * travel as fields (session line, POST body, medication_snapshot), so a
 * sig the provider edited by hand on the price step can never change what
 * is stored. The sig is parsed ONLY for a legacy line that carries no
 * structured value for that field (sessions and drafts created before the
 * inputs were stored). Quantity is never parsed from the sig — there is
 * nothing reliable to parse — so a legacy line without one stays null.
 */
export function structuredLineInputs(line: {
  dose?:          string | null | undefined
  frequencyCode?: string | null | undefined
  quantityLabel?: string | null | undefined
  sigText?:       string | null | undefined
}): StructuredLineInputs {
  const doseMatch = PURE_DOSE_RE.exec(line.dose ?? '')
  const structuredDose = doseMatch ? `${doseMatch[1]} ${normaliseUnit(doseMatch[2]!)}` : null
  const structuredFrequency = typeof line.frequencyCode === 'string' && line.frequencyCode.trim() ? line.frequencyCode.trim() : null
  const structuredQuantity = typeof line.quantityLabel === 'string' && line.quantityLabel.trim() ? line.quantityLabel.trim() : null

  // Legacy fallback — only for the fields that have no structured value.
  const parsed = structuredDose && structuredFrequency ? null : parseSigForBuilder(line.sigText)
  const parsedDose = parsed?.doseAmount && parsed.doseUnit ? `${parsed.doseAmount} ${parsed.doseUnit}` : null

  return {
    dose:          structuredDose ?? parsedDose,
    frequencyCode: structuredFrequency ?? (parsed?.frequency || null),
    quantityLabel: structuredQuantity,
  }
}

/**
 * Rebuild the builder's inputs from an orders row. Drafts created after
 * WO-98 carry the structured inputs in medication_snapshot
 * (prescribed_dose, frequency_code, quantity_label); older drafts fall
 * back to parsing the generated sig.
 */
export function builderStateFromOrder(order: {
  formulation_id:      string | null
  pharmacy_id:         string | null
  sig_text:            string | null
  refills:             number | null
  medication_snapshot: unknown
}): BuilderInitialState {
  const snap = (order.medication_snapshot ?? {}) as Record<string, unknown>
  // Same rule as the POST bodies: the stored structured inputs win; the
  // sig is parsed only for a legacy draft that has none.
  const inputs = structuredLineInputs({
    dose:          typeof snap['prescribed_dose'] === 'string' ? snap['prescribed_dose'] : null,
    frequencyCode: typeof snap['frequency_code'] === 'string' ? snap['frequency_code'] : null,
    quantityLabel: typeof snap['quantity_label'] === 'string' ? snap['quantity_label'] : null,
    sigText:       order.sig_text,
  })
  const doseMatch = inputs.dose ? DOSE_RE.exec(inputs.dose) : null
  return {
    formulationId: order.formulation_id,
    pharmacyId:    order.pharmacy_id ?? '',
    doseAmount:    doseMatch?.[1] ?? '',
    doseUnit:      doseMatch?.[2] ? normaliseUnit(doseMatch[2]) : '',
    frequency:     inputs.frequencyCode ?? '',
    quantity:      inputs.quantityLabel ?? '',
    refills:       typeof order.refills === 'number' ? order.refills : 0,
    sigText:       order.sig_text ?? '',
  }
}

/** Return path after a draft edit/add: providers land on the draft, others on the dashboard. */
export function draftReturnPath(anchorOrderId: string, isProvider: boolean): string {
  return isProvider ? `/new-prescription/sign/${anchorOrderId}` : '/dashboard?draft=1'
}
