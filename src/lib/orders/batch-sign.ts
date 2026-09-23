// ============================================================
// Batch sign — the only way an order is signed (WO-99)
// ============================================================
//
// Gina Rooks asked to sign all of a patient's prescriptions at once. One
// signature pad, one Sign & Send, every selected draft signed together.
// Review (a new session) and the batch sign page (saved drafts) both come
// here; POST /api/orders/[orderId]/sign-and-send no longer signs.
//
// ALL OR NOTHING. Every line is validated before anything is written. If
// any line cannot be sent, nothing is signed and the answer names the line
// and why. A signed order is locked for good (locked_at never changes —
// prevent_snapshot_mutation), so the order of work below is chosen so that
// nothing is signed until everything else has succeeded:
//
//   1. check every line (read only)
//   2. the authenticator code, when any line is controlled
//   3. shipping, allocated once per pharmacy per patient (drafts only)
//   4. one payment group per patient with 2+ orders, created on the
//      DRAFTs, with its PaymentIntent
//   5. sign: DRAFT → AWAITING_PAYMENT for every order, one statement
//   6. history, EPCS audit, SLAs, one payment link per patient
//
// A failure in 3 or 4 unwinds 4 and signs nothing.
//
// Checks per line, as the single-draft path had them (#164–#166) plus
// WO-99's own:
//   - the caller is the provider on the line (another provider's draft
//     goes through Sign as me first; nothing is signed under someone
//     else's name)
//   - pharmacy licensed in the patient's state, active, not banned
//   - provider NPI, clinic Stripe account
//   - DEA schedule: 2+ or UNKNOWN must go to a Tier 4 fax pharmacy
//   - rule-required Rx details (controlled → diagnosis; clinical difference)
//   - price: the pharmacy's price today. Moved since the draft was saved
//     → reprice (WO-108); retail under it → below cost. Never signed at a
//     stale or losing price without the provider editing the line.
// and, at signing, per patient:
//   - allergy status could be read
//   - the drug interaction check ran, across that patient's batch lines
//
// A check that COULD NOT RUN blocks, the whole batch (503). What a check
// FINDS — recorded allergies, a known interaction — is the provider's
// information on screen and never blocks.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database.types'
import {
  missingRxDetails,
  MISSING_RX_DETAIL_LABEL,
  rxDetailsFromRow,
  RX_DETAIL_COLUMN_LIST,
} from './rx-details'
import { resolveLine } from './resolve-line'
import { applyBundleShipping } from './apply-bundle-shipping'
import { pharmacyInactiveMessage } from '@/lib/pharmacies/live'
import { findInteractions, type InteractionRow } from '@/lib/interactions/match'
import { checkSignature, SIGNATURE_REJECTION_COPY, type SignaturePayload } from './signature'
import { verifyProviderTotp } from '@/lib/epcs/totp'
import { createPaymentGroup, cancelPaymentGroup } from '@/lib/payment-group/create-group'
import { generateCheckoutToken, generateGroupCheckoutToken } from '@/lib/auth/checkout-token'
import { insertStatusHistory, type StatusHistoryRow } from './status-history'
import { createSlasForTransition } from '@/lib/sla/creator'
import { sendPaymentLinkSms } from '@/lib/sms/triggers'
import { serverEnv } from '@/lib/env'

type Supabase = SupabaseClient<Database>

export { MAX_BATCH_ORDERS } from './batch-sign-view'
import { MAX_BATCH_ORDERS } from './batch-sign-view'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ── Problems ─────────────────────────────────────────────────

export type BatchProblemCode =
  // the line cannot be sent as it stands
  | 'not_found' | 'not_draft' | 'not_signer'
  | 'license' | 'pharmacy' | 'npi' | 'stripe' | 'dea_fax'
  | 'rx_details' | 'reprice' | 'below_cost'
  // a check that could not run
  | 'orders_unavailable' | 'provider_unavailable' | 'provider_unlinked'
  | 'compliance_unavailable' | 'rules_unavailable' | 'price_unavailable'
  | 'allergy_unavailable' | 'interactions_unavailable'

export interface BatchProblem {
  /** The line it is about; null when it is about the batch as a whole. */
  orderId:        string | null
  medicationName: string | null
  code:           BatchProblemCode
  message:        string
}

const UNAVAILABLE: ReadonlySet<BatchProblemCode> = new Set([
  'orders_unavailable', 'provider_unavailable', 'compliance_unavailable', 'rules_unavailable',
  'price_unavailable', 'allergy_unavailable', 'interactions_unavailable',
])

/** One HTTP status for a set of problems: could-not-run beats everything. */
export function problemsStatus(problems: ReadonlyArray<BatchProblem>): 503 | 403 | 404 | 409 | 422 {
  if (problems.some(p => UNAVAILABLE.has(p.code))) return 503
  if (problems.some(p => p.code === 'not_signer' || p.code === 'provider_unlinked')) return 403
  if (problems.some(p => p.code === 'not_found')) return 404
  if (problems.some(p => p.code === 'not_draft')) return 409
  return 422
}

// ── Lines ────────────────────────────────────────────────────

export interface BatchLine {
  orderId:        string
  patientId:      string
  providerId:     string
  pharmacyId:     string | null
  medicationName: string
  /** null = the schedule could not be read. Unknown counts as controlled. */
  deaSchedule:    number | null
  controlled:     boolean
  integrationTier: string | null
}

export interface BatchCheck {
  lines:    BatchLine[]
  problems: BatchProblem[]
  /** The signing provider — the caller — when their provider row was read. */
  signer:   { provider_id: string; first_name: string; last_name: string; npi_number: string } | null
}

interface OrderRow {
  order_id:                 string
  status:                   string
  patient_id:               string
  provider_id:              string
  catalog_item_id:          string | null
  formulation_id:           string | null
  pharmacy_id:              string | null
  retail_price_snapshot:    number | null
  wholesale_price_snapshot: number | null
  shipping_state_snapshot:  string | null
  medication_snapshot:      Json | null
  package_id:               string | null
  package_count:            number | null
  [key: string]: unknown
}

const ORDER_SELECT = `order_id, status, patient_id, provider_id, catalog_item_id, formulation_id, pharmacy_id,
  retail_price_snapshot, wholesale_price_snapshot, shipping_state_snapshot, medication_snapshot,
  package_id, package_count, ${RX_DETAIL_COLUMN_LIST}`

function snap(row: { medication_snapshot: Json | null }): Record<string, unknown> {
  const s = row.medication_snapshot
  return s && typeof s === 'object' && !Array.isArray(s) ? s as Record<string, unknown> : {}
}

function medicationNameOf(row: { medication_snapshot: Json | null }): string {
  const s = snap(row)
  const name = s['medication_name'] ?? s['name']
  return typeof name === 'string' && name ? name : 'Prescription'
}

function money(cents: number): string {
  return '$' + (cents / 100).toFixed(2)
}

function cents(dollars: number | null | undefined): number {
  return Math.round(Number(dollars ?? 0) * 100)
}

/** Validate the requested ids: 1..MAX, uuids, no duplicates. */
export function parseOrderIds(raw: unknown): { ok: true; ids: string[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: 'orderIds must be a non-empty array' }
  if (raw.length > MAX_BATCH_ORDERS) return { ok: false, error: `At most ${MAX_BATCH_ORDERS} prescriptions can be signed at once` }
  if (!raw.every(id => typeof id === 'string' && UUID_RE.test(id))) return { ok: false, error: 'orderIds must be order ids' }
  if (new Set(raw).size !== raw.length) return { ok: false, error: 'orderIds contains duplicates' }
  return { ok: true, ids: raw as string[] }
}

/**
 * Check every line of a batch. Read only. `atSigning` adds the patient
 * checks (allergy status, drug interactions), which the page runs with its
 * own components and retry; the signing request runs them again because
 * it is the gate that cannot be skipped.
 */
export async function checkBatch(
  supabase: Supabase,
  input: { clinicId: string; userId: string; orderIds: string[]; atSigning: boolean },
): Promise<BatchCheck> {
  const { clinicId, userId, orderIds } = input
  const problems: BatchProblem[] = []
  const add = (row: { order_id: string; medication_snapshot: Json | null } | null, code: BatchProblemCode, message: string) =>
    problems.push({ orderId: row?.order_id ?? null, medicationName: row ? medicationNameOf(row) : null, code, message })

  // ── The orders ──
  const { data: orderData, error: ordersError } = await supabase
    .from('orders')
    .select(ORDER_SELECT)
    .in('order_id', orderIds)
    .eq('clinic_id', clinicId)
    .eq('is_active', true)
    .is('deleted_at', null)
  if (ordersError) {
    console.error('[batch-sign] orders could not be read:', ordersError.message)
    add(null, 'orders_unavailable', 'The prescriptions could not be loaded. Nothing was signed — try again.')
    return { lines: [], problems, signer: null }
  }
  const rows = (orderData ?? []) as unknown as OrderRow[]
  const byId = new Map(rows.map(r => [r.order_id, r]))
  for (const id of orderIds) {
    if (!byId.has(id)) problems.push({ orderId: id, medicationName: null, code: 'not_found', message: 'This prescription no longer exists or was removed.' })
  }
  const ordered = orderIds.map(id => byId.get(id)).filter((r): r is OrderRow => !!r)
  for (const r of ordered) {
    if (r.status !== 'DRAFT') add(r, 'not_draft', `${medicationNameOf(r)} is no longer a draft (${r.status}) — it may already have been signed.`)
  }

  // ── Who is signing ──
  const { data: signer, error: signerError } = await supabase
    .from('providers')
    .select('provider_id, first_name, last_name, npi_number')
    .eq('user_id', userId)
    .eq('clinic_id', clinicId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .maybeSingle()
  if (signerError) {
    console.error('[batch-sign] signing provider could not be read:', signerError.message)
    add(null, 'provider_unavailable', 'Your provider record could not be read. Nothing was signed — try again.')
    return { lines: [], problems, signer: null }
  }
  if (!signer) {
    add(null, 'provider_unlinked', 'Only a provider can sign, and your login is not linked to a provider in this clinic.')
    return { lines: [], problems, signer: null }
  }

  // Never signed silently under someone else's name: another provider's
  // draft is taken over with Sign as me (WO-100) first.
  const others = [...new Set(ordered.filter(r => r.provider_id !== signer.provider_id).map(r => r.provider_id))]
  if (others.length > 0) {
    const { data: otherRows } = await supabase
      .from('providers')
      .select('provider_id, first_name, last_name')
      .in('provider_id', others)
    const names = new Map((otherRows ?? []).map(p => [p.provider_id, `${p.first_name} ${p.last_name}`]))
    for (const r of ordered) {
      if (r.provider_id === signer.provider_id) continue
      add(r, 'not_signer', `${medicationNameOf(r)} is assigned to ${names.get(r.provider_id) ?? 'another provider'}. Use Sign as me to take it over before signing.`)
    }
  }

  // ── Clinic, pharmacies, licenses, schedules, rules — batched reads ──
  const pharmacyIds = [...new Set(ordered.map(r => r.pharmacy_id).filter((id): id is string => !!id))]
  const catalogIds  = [...new Set(ordered.map(r => r.catalog_item_id).filter((id): id is string => !!id))]
  const formIds     = [...new Set(ordered.map(r => r.formulation_id).filter((id): id is string => !!id))]

  const [clinicRes, pharmacyRes, licenseRes, catalogRes, rulesRes] = await Promise.all([
    supabase.from('clinics').select('stripe_connect_status').eq('clinic_id', clinicId).maybeSingle(),
    pharmacyIds.length
      ? supabase.from('pharmacies').select('pharmacy_id, name, integration_tier, is_active, pharmacy_status, deleted_at').in('pharmacy_id', pharmacyIds)
      : Promise.resolve({ data: [], error: null }),
    pharmacyIds.length
      ? supabase.from('pharmacy_state_licenses').select('pharmacy_id, state_code').in('pharmacy_id', pharmacyIds).eq('is_active', true)
      : Promise.resolve({ data: [], error: null }),
    catalogIds.length
      ? supabase.from('catalog').select('item_id, dea_schedule').in('item_id', catalogIds)
      : Promise.resolve({ data: [], error: null }),
    formIds.length
      ? supabase.from('formulations').select('formulation_id, requires_clinical_difference').in('formulation_id', formIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (clinicRes.error || pharmacyRes.error || licenseRes.error) {
    console.error('[batch-sign] compliance reads failed:', (clinicRes.error ?? pharmacyRes.error ?? licenseRes.error)?.message)
    add(null, 'compliance_unavailable', 'The compliance checks could not be run. Nothing was signed — try again.')
    return { lines: [], problems, signer }
  }
  if (catalogRes.error) {
    // Batch 1, finding 2: a schedule that could not be read is UNKNOWN,
    // never 0 — it must go to a fax pharmacy, and counts as controlled.
    console.error('[batch-sign] catalog dea_schedule lookup failed:', catalogRes.error.message)
  }
  if (rulesRes.error) {
    // Batch 1, finding 3: a rule that could not be read is not a rule
    // that does not apply.
    console.error('[batch-sign] clinical-difference rule lookup failed:', rulesRes.error.message)
  }

  if (!/^\d{10}$/.test(signer.npi_number ?? '')) {
    add(null, 'npi', 'Your NPI on file is not valid, so nothing can be signed. Contact your administrator.')
  }
  if (clinicRes.data?.stripe_connect_status !== 'ACTIVE') {
    add(null, 'stripe', "The clinic's Stripe account is not active, so no payment link can be sent.")
  }

  const pharmacies = new Map((pharmacyRes.data ?? []).map(p => [p.pharmacy_id, p]))
  const licensed   = new Set((licenseRes.data ?? []).map(l => `${l.pharmacy_id}:${l.state_code}`))
  const catalogDea = new Map((catalogRes.data ?? []).map(c => [c.item_id, c.dea_schedule as number | null]))
  const rules      = new Map((rulesRes.data ?? []).map(f => [f.formulation_id, f.requires_clinical_difference === true]))

  const lines: BatchLine[] = []
  const priceable: OrderRow[] = []
  for (const r of ordered) {
    const name = medicationNameOf(r)
    const pharmacy = r.pharmacy_id ? pharmacies.get(r.pharmacy_id) : undefined
    const before = problems.length

    if (!licensed.has(`${r.pharmacy_id}:${r.shipping_state_snapshot}`)) {
      add(r, 'license', `${name}: ${pharmacy?.name ?? 'the pharmacy'} is not licensed in ${r.shipping_state_snapshot ?? "the patient's state"}.`)
    }
    const pharmacyOk = !!pharmacy && pharmacy.is_active && !pharmacy.deleted_at && pharmacy.pharmacy_status !== 'BANNED'
    if (!pharmacyOk) {
      add(r, 'pharmacy', pharmacy?.pharmacy_status === 'BANNED'
        ? `${name}: ${pharmacy.name} is banned.`
        : `${name}: ${pharmacyInactiveMessage(pharmacy?.name)}`)
    }

    // DEA: the catalog when this is a catalog line and it could be read,
    // else the snapshot taken at creation. Unknown is never "0".
    const snapSchedule = snap(r)['dea_schedule']
    const fromSnapshot = typeof snapSchedule === 'number' ? snapSchedule : null
    const catalogUnreadable = !!r.catalog_item_id && !!catalogRes.error
    const deaSchedule = catalogUnreadable
      ? null
      : (r.catalog_item_id ? (catalogDea.get(r.catalog_item_id) ?? fromSnapshot) : fromSnapshot)
    const deaUnknown = deaSchedule == null
    const controlled = deaUnknown || (deaSchedule as number) >= 2
    const isFax = pharmacy?.integration_tier === 'TIER_4_FAX'
    if (controlled && !isFax) {
      add(r, 'dea_fax', deaUnknown
        ? `${name}: the DEA schedule could not be read, so it must go to a Tier 4 fax pharmacy. Try again, or route it to a fax pharmacy.`
        : `${name}: DEA Schedule ${deaSchedule} requires a Tier 4 fax pharmacy.`)
    }

    // WO-96 rule-required details.
    let requiresClinicalDifference = false
    if (r.formulation_id) {
      if (rulesRes.error || !rules.has(r.formulation_id)) {
        add(r, 'rules_unavailable', `${name}: the clinical-difference requirement could not be checked. Nothing was signed — try again.`)
      } else {
        requiresClinicalDifference = rules.get(r.formulation_id) === true
      }
    }
    const missing = missingRxDetails(rxDetailsFromRow(r as unknown as Parameters<typeof rxDetailsFromRow>[0]), {
      isControlled: controlled,
      requiresClinicalDifference,
      clinicalDifferenceOptions: [],
    })
    if (missing.length > 0) {
      add(r, 'rx_details', `${name} needs ${missing.map(m => MISSING_RX_DETAIL_LABEL[m]).join(' and ')}. Edit this line to add it.`)
    }

    lines.push({
      orderId: r.order_id, patientId: r.patient_id, providerId: r.provider_id, pharmacyId: r.pharmacy_id,
      medicationName: name, deaSchedule, controlled, integrationTier: pharmacy?.integration_tier ?? null,
    })
    if (problems.length === before && r.status === 'DRAFT') priceable.push(r)
  }

  // ── Price: what the pharmacy charges TODAY ──
  // A draft's wholesale is a snapshot from when it was saved. Signing
  // locks it. If the pharmacy's price has moved since, the snapshot is
  // stale (WO-108: any move, either direction, interrupts); if retail is
  // under today's price, the line would be sent below cost.
  const priced = await Promise.all(priceable.map(async r => ({
    r,
    today: await resolveLine(supabase, {
      catalogItemId: r.catalog_item_id,
      formulationId: r.formulation_id,
      pharmacyId:    r.pharmacy_id ?? '',
      patientState:  r.shipping_state_snapshot ?? '',
      packageId:     r.package_id,
      packageCount:  r.package_id ? (r.package_count ?? 1) : null,
    }),
  })))
  for (const { r, today } of priced) {
    const name = medicationNameOf(r)
    const retail = cents(r.retail_price_snapshot)
    const saved  = cents(r.wholesale_price_snapshot)
    if (!today.ok) {
      if (today.status >= 500) {
        add(r, 'price_unavailable', `${name}: today's price could not be read. Nothing was signed — try again.`)
      } else {
        add(r, 'reprice', `${name}: the pharmacy no longer offers it as saved (${today.error}). Edit this line to choose what to send.`)
      }
      continue
    }
    if (retail < today.wholesaleCents || retail < saved) {
      add(r, 'below_cost', `${name} is priced below cost — ${money(retail)} retail against ${money(Math.max(today.wholesaleCents, saved))} wholesale. Edit the price to continue.`)
    } else if (today.wholesaleCents !== saved) {
      add(r, 'reprice', `${name}: the pharmacy's price changed since this draft was saved (${money(saved)} → ${money(today.wholesaleCents)}). Edit this line to confirm what the patient pays.`)
    }
  }

  if (!input.atSigning) return { lines, problems, signer }

  // ── At signing: allergy status + interactions, per patient ──
  const patientIds = [...new Set(lines.map(l => l.patientId))]
  const [allergyRes, interactionRes] = await Promise.all([
    supabase.from('patients').select('patient_id, allergies, nkda').in('patient_id', patientIds),
    supabase.from('drug_interactions').select(`
      interaction_id, severity, description,
      ingredient_a:ingredients!drug_interactions_ingredient_a_id_fkey ( common_name ),
      ingredient_b:ingredients!drug_interactions_ingredient_b_id_fkey ( common_name )
    `),
  ])
  if (allergyRes.error) {
    console.error('[batch-sign] allergy status read failed:', allergyRes.error.message)
    for (const l of lines) {
      problems.push({ orderId: l.orderId, medicationName: l.medicationName, code: 'allergy_unavailable', message: `${l.medicationName}: the patient's allergy status could not be checked. Nothing was signed — try again.` })
    }
  }
  if (interactionRes.error) {
    console.error('[batch-sign] drug interaction check could not run:', interactionRes.error.message)
    for (const l of lines) {
      problems.push({ orderId: l.orderId, medicationName: l.medicationName, code: 'interactions_unavailable', message: `${l.medicationName}: the drug interaction check could not be run. Nothing was signed — try again.` })
    }
  } else {
    for (const pid of patientIds) {
      const names = lines.filter(l => l.patientId === pid).map(l => l.medicationName)
      const found = findInteractions((interactionRes.data ?? []) as unknown as InteractionRow[], names)
      if (found.length > 0) {
        // A finding, not a failure: the provider saw it on screen.
        console.info(`[batch-sign] ${found.length} drug interaction(s) shown to the provider | patient lines=${names.length}`)
      }
    }
  }

  return { lines, problems, signer }
}

// ── Signing ──────────────────────────────────────────────────

export interface SignedPatient {
  patientId:      string
  orderIds:       string[]
  paymentGroupId: string | null
  checkoutUrl:    string
}

export type SignBatchResult =
  | { ok: true; signedAt: string; patients: SignedPatient[] }
  | { ok: false; status: number; error: string; code?: string; problems?: BatchProblem[]; controlled?: Array<{ orderId: string; medicationName: string; deaSchedule: number | null }> }

async function sha256Hex(input: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function groupsEnabled(): boolean {
  return process.env['PHASE_C_GROUPS_ENABLED'] === 'true'
}

export async function signBatch(
  supabase: Supabase,
  input: {
    clinicId:  string
    userId:    string
    appRole:   string | null
    orderIds:  unknown
    signature: unknown
    totpCode?: unknown
    requestMeta?: { ip: string | null; userAgent: string | null }
  },
): Promise<SignBatchResult> {
  if (input.appRole !== 'provider') {
    return { ok: false, status: 403, error: 'Only a provider can sign prescriptions.' }
  }
  const parsed = parseOrderIds(input.orderIds)
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error }
  const orderIds = parsed.ids

  const sig = checkSignature(input.signature)
  if (!sig.ok) {
    return { ok: false, status: 400, code: 'SIGNATURE_REJECTED', error: SIGNATURE_REJECTION_COPY[sig.reason] }
  }
  const signature: SignaturePayload = sig.signature

  // ── 1. Every line, before anything is written ──
  const check = await checkBatch(supabase, { clinicId: input.clinicId, userId: input.userId, orderIds, atSigning: true })
  if (check.problems.length > 0 || !check.signer) {
    const status = problemsStatus(check.problems)
    if (status === 503) {
      for (const p of check.problems.filter(p => UNAVAILABLE.has(p.code))) {
        console.error(`[batch-sign] check could not run (${p.code}) | order=${p.orderId ?? 'batch'}`)
      }
    }
    return {
      ok: false,
      status,
      error: check.problems.length === 1
        ? check.problems[0]!.message
        : `${check.problems.length} problems — nothing was signed. Each is shown against its line.`,
      problems: check.problems,
    }
  }
  const signer = check.signer
  const lines = check.lines

  // ── 2. The second factor, when any line is controlled ──
  const controlledLines = lines.filter(l => l.controlled)
  if (controlledLines.length > 0) {
    const controlled = controlledLines.map(l => ({ orderId: l.orderId, medicationName: l.medicationName, deaSchedule: l.deaSchedule }))
    if (input.totpCode == null || input.totpCode === '') {
      return { ok: false, status: 401, code: 'TOTP_REQUIRED', error: 'This batch includes a controlled substance: enter your authenticator code to sign.', controlled }
    }
    const totp = await verifyProviderTotp(supabase, signer.provider_id, input.totpCode)
    if (totp === 'unavailable') {
      return { ok: false, status: 503, code: 'TOTP_UNAVAILABLE', error: 'Your authenticator code could not be checked. Nothing was signed — try again.', controlled }
    }
    if (totp === 'not_enrolled') {
      return { ok: false, status: 401, code: 'TOTP_NOT_ENROLLED', error: 'Set up your authenticator before signing a controlled substance.', controlled }
    }
    if (totp === 'invalid') {
      await writeEpcsAudit(supabase, signer.provider_id, controlledLines, 'TOTP_FAILED', {}, input.requestMeta)
      return { ok: false, status: 401, code: 'TOTP_INVALID', error: 'That authenticator code is not valid. Nothing was signed.', controlled }
    }
    // The verification is recorded before anything is signed, against
    // every controlled order in the batch. If it cannot be recorded, the
    // signature is not taken.
    const recorded = await writeEpcsAudit(supabase, signer.provider_id, controlledLines, 'TOTP_VERIFIED', {}, input.requestMeta)
    if (!recorded) {
      return { ok: false, status: 503, code: 'EPCS_AUDIT_UNAVAILABLE', error: 'The EPCS audit record could not be written. Nothing was signed — try again.' }
    }
  }

  // ── One payment link per patient ──
  const byPatient = new Map<string, BatchLine[]>()
  for (const l of lines) byPatient.set(l.patientId, [...(byPatient.get(l.patientId) ?? []), l])
  if (!groupsEnabled() && [...byPatient.values()].some(ls => ls.length > 1)) {
    console.error('[batch-sign] payment groups are disabled; refusing a multi-prescription batch')
    return { ok: false, status: 503, error: 'Signing several prescriptions for one patient needs payment groups, which are not enabled here. Nothing was signed.' }
  }

  // ── 3. Shipping once per pharmacy per patient (still DRAFTs) ──
  for (const [, ls] of byPatient) {
    const allocated = await applyBundleShipping(supabase, input.clinicId, ls.map(l => l.orderId))
    if (!allocated.ok) {
      console.error(`[batch-sign] shipping could not be allocated: ${allocated.error}`)
      return { ok: false, status: allocated.status >= 500 ? 503 : allocated.status, error: `Shipping could not be calculated: ${allocated.error}. Nothing was signed.` }
    }
  }

  // ── 4. A payment group per patient with 2+ orders, on the DRAFTs ──
  const groups = new Map<string, string>()  // patientId → groupId
  const groupPis = new Map<string, string>()
  const unwindGroups = async () => {
    for (const [pid, groupId] of groups) {
      await cancelPaymentGroup({
        supabase,
        groupId,
        orderIds: (byPatient.get(pid) ?? []).map(l => l.orderId),
        stripePaymentIntentId: groupPis.get(groupId) ?? null,
      })
    }
  }
  for (const [pid, ls] of byPatient) {
    if (ls.length < 2) continue
    const created = await createPaymentGroup({
      supabase,
      clinicId:      input.clinicId,
      callerAppRole: 'provider',
      callerUserId:  input.userId,
      orderIds:      ls.map(l => l.orderId),
      memberStatus:  'DRAFT',
    })
    if (!created.ok) {
      console.error(`[batch-sign] payment group could not be created | patient lines=${ls.length}: ${created.error}`)
      await unwindGroups()
      return { ok: false, status: created.status >= 500 ? 503 : created.status, error: `The payment link could not be prepared: ${created.error}. Nothing was signed.` }
    }
    groups.set(pid, created.groupId)
    groupPis.set(created.groupId, created.stripePaymentIntentId)
  }

  // ── 5. Sign every order — one statement, one timestamp, one hash ──
  // One signature record per order (orders.provider_signature_hash_snapshot
  // + locked_at), all carrying the same signature and time. The update
  // touches nothing else: a titration keeps its steps, a refill keeps
  // refill_of_order_id.
  const signedAt = new Date().toISOString()
  const signatureHash = await sha256Hex(`${signature.dataUrl}:${signedAt}`)
  const { data: signedRows, error: signError } = await supabase
    .from('orders')
    .update({
      status:                           'AWAITING_PAYMENT',
      locked_at:                        signedAt,
      provider_signature_hash_snapshot: signatureHash,
      updated_at:                       signedAt,
    })
    .in('order_id', orderIds)
    .eq('status', 'DRAFT')
    .eq('is_active', true)
    .is('deleted_at', null)
    .select('order_id')

  if (signError || !signedRows || signedRows.length === 0) {
    console.error('[batch-sign] signing update failed:', signError?.message ?? 'no rows matched')
    await unwindGroups()
    return { ok: false, status: signError ? 500 : 409, error: 'The prescriptions could not be signed — they may have changed. Nothing was signed; refresh and try again.' }
  }
  if (signedRows.length !== orderIds.length) {
    // Only reachable if a draft changed between the checks above and this
    // statement. Groups are linked first, and a linked draft cannot be
    // edited or removed (PATCH/DELETE refuse), so this is a race with
    // something outside the app. Say exactly what happened.
    const signedIds = new Set(signedRows.map(r => r.order_id))
    const unsigned = orderIds.filter(id => !signedIds.has(id))
    console.error(`[batch-sign] CRITICAL: partial sign | signed=${[...signedIds].join(',')} unsigned=${unsigned.join(',')}`)
    return { ok: false, status: 500, error: `Only ${signedIds.size} of ${orderIds.length} prescriptions were signed; ${unsigned.length} changed while signing. Contact support before retrying.` }
  }

  // ── 6. Everything that follows a signature ──
  const { error: providerHashError } = await supabase
    .from('providers')
    .update({ signature_hash: signatureHash, updated_at: signedAt })
    .eq('provider_id', signer.provider_id)
  if (providerHashError) {
    console.error('[batch-sign] provider signature hash update failed (non-fatal):', providerHashError.message)
  }

  const historyRows: StatusHistoryRow[] = lines.map(l => ({
    order_id:   l.orderId,
    old_status: 'DRAFT',
    new_status: 'AWAITING_PAYMENT',
    changed_by: input.userId,
    metadata:   {
      actor:            'provider_batch_sign',
      signed_at:        signedAt,
      signature_hash:   signatureHash,
      batch_order_ids:  orderIds,
      payment_group_id: groups.get(l.patientId) ?? null,
    },
  }))
  await insertStatusHistory(supabase, historyRows, 'batch-sign')

  if (controlledLines.length > 0) {
    const ok = await writeEpcsAudit(supabase, signer.provider_id, controlledLines, 'ORDER_SIGNED', { signed_at: signedAt, signature_hash: signatureHash }, input.requestMeta)
    if (!ok) console.error(`[batch-sign] CRITICAL: EPCS ORDER_SIGNED audit rows not written | orders=${controlledLines.map(l => l.orderId).join(',')}`)
  }

  await Promise.all(lines.map(l => createSlasForTransition({
    orderId:    l.orderId,
    newStatus:  'AWAITING_PAYMENT',
    pharmacyId: l.pharmacyId ?? '',
    tier:       (l.integrationTier ?? 'TIER_4_FAX') as Parameters<typeof createSlasForTransition>[0]['tier'],
  }).catch(err => {
    console.error(`[batch-sign] CRITICAL: SLA creation failed | order=${l.orderId}:`, err instanceof Error ? err.message : err)
  })))

  const base = serverEnv.appBaseUrl().replace(/\/$/, '')
  const patients: SignedPatient[] = []
  for (const [pid, ls] of byPatient) {
    const groupId = groups.get(pid) ?? null
    const anchor = ls[0]!.orderId
    const token = groupId
      ? await generateGroupCheckoutToken(groupId, pid, input.clinicId)
      : await generateCheckoutToken(anchor, pid, input.clinicId)
    const checkoutUrl = `${base}/checkout/${token}`
    await sendPaymentLinkSms(anchor, checkoutUrl).catch(err => {
      console.error('[batch-sign] SMS dispatch failed (non-fatal):', err instanceof Error ? err.message : 'unknown error')
    })
    patients.push({ patientId: pid, orderIds: ls.map(l => l.orderId), paymentGroupId: groupId, checkoutUrl })
  }

  console.info(`[batch-sign] complete | orders=${orderIds.length} patients=${patients.length} groups=${groups.size} controlled=${controlledLines.length}`)
  return { ok: true, signedAt, patients }
}

/**
 * EPCS audit rows, one per controlled order, each referencing every
 * controlled order in the batch. Returns false when they could not be
 * written.
 */
async function writeEpcsAudit(
  supabase: Supabase,
  providerId: string,
  controlled: ReadonlyArray<BatchLine>,
  eventType: 'TOTP_VERIFIED' | 'TOTP_FAILED' | 'ORDER_SIGNED',
  details: Record<string, unknown>,
  meta: { ip: string | null; userAgent: string | null } | undefined,
): Promise<boolean> {
  const controlledIds = controlled.map(l => l.orderId)
  const { error } = await supabase.from('epcs_audit_log').insert(controlled.map(l => ({
    provider_id:     providerId,
    patient_id:      l.patientId,
    order_id:        l.orderId,
    event_type:      eventType,
    // An unreadable schedule is recorded as unknown (-1), never as a
    // schedule it may not be.
    dea_schedule:    l.deaSchedule ?? -1,
    medication_name: l.medicationName,
    details:         { ...details, batch_controlled_order_ids: controlledIds, dea_schedule_unknown: l.deaSchedule == null } as Json,
    ip_address:      meta?.ip ?? null,
    user_agent:      meta?.userAgent ?? null,
  })))
  if (error) {
    console.error(`[batch-sign] EPCS audit (${eventType}) could not be written:`, error.message)
    return false
  }
  return true
}
