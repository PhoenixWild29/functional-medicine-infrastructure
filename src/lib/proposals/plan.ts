// ============================================================
// The patient's plan link, server side (patient protocol choice PR 3)
// ============================================================
//
// /plan/{token} and /api/plan/{token}. Public: the token is the credential,
// checked against its stored SHA-256 (lib/proposals/token). The service
// role reads and writes, always scoped to the proposal's clinic and
// patient, as the intake link does.
//
//   resolvePlan    the link state, and the clinic logo when open
//   verifyPlanDob  the patient's date of birth; a wrong one counts
//                  (dob_failed) and the 5th locks the link (locked)
//   loadPlan       the options and their DRAFT items, for the patient. No
//                  wholesale cost, no pharmacy, no clinic name.
//   quotePlan      the total for a selection, computed here (the patient
//                  never sees wholesale, which the free-shipping threshold
//                  needs): subtotal + shipping once per pharmacy
//   choosePlan     sent -> chosen, chosen -> chosen (rechosen); the kept
//                  items are recorded under the next choice_no
//   declinePlan    sent / chosen -> declined
//
// Server rules for a choice: one option's items only, each once; at least
// one item; every required item kept. Nothing changes once the proposal is
// signed, declined, expired or cancelled (or a draft). Events carry no PHI.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { loadShippingRates } from '@/lib/orders/apply-bundle-shipping'
import { bundleTotals, computeBundleShipping, dollarsToCents } from '@/lib/orders/shipping'
import { MAX_DOB_FAILURES, hashProposalToken, isWellFormedProposalToken, proposalLinkState } from './token'
import { canTransitionProposal } from './status'
import type { ProposalEvent, ProposalStatus } from './types'

type Db = SupabaseClient<Database>

export interface PlanProposal {
  proposal_id:      string
  clinic_id:        string
  patient_id:       string
  status:           ProposalStatus
  token_hash:       string | null
  expires_at:       string | null
  locked_at:        string | null
  dob_failures:     number
  first_viewed_at:  string | null
  chosen_option_id: string | null
}

const PROPOSAL_COLUMNS = 'proposal_id, clinic_id, patient_id, status, token_hash, expires_at, locked_at, dob_failures, first_viewed_at, chosen_option_id'

export type PlanResolution =
  | { state: 'open'; proposal: PlanProposal; logoUrl: string | null }
  | { state: 'not_found' | 'expired' | 'locked' | 'signed' | 'closed' | 'unavailable' }

export async function resolvePlan(db: Db, token: string, now: Date): Promise<PlanResolution> {
  if (!isWellFormedProposalToken(token)) return { state: 'not_found' }
  const { data, error } = await db
    .from('treatment_proposals')
    .select(PROPOSAL_COLUMNS)
    .eq('token_hash', hashProposalToken(token))
    .maybeSingle()
  if (error) {
    console.error('[plan] proposal lookup failed:', error.message)
    return { state: 'unavailable' }
  }
  if (!data) return { state: 'not_found' }
  const proposal = data as unknown as PlanProposal
  const state = proposalLinkState(proposal, token, now)
  if (state !== 'open') return { state }

  const { data: clinic, error: clinicError } = await db.from('clinics').select('logo_url').eq('clinic_id', proposal.clinic_id).maybeSingle()
  if (clinicError) {
    console.error('[plan] clinic lookup failed:', clinicError.message)
    return { state: 'unavailable' }
  }
  return { state: 'open', proposal, logoUrl: (clinic as { logo_url?: string | null } | null)?.logo_url ?? null }
}

async function addEvent(db: Db, proposalId: string, event: ProposalEvent, extra: { option_id?: string; item_count?: number } = {}): Promise<void> {
  const { error } = await db.from('treatment_proposal_events').insert({ proposal_id: proposalId, event, actor: 'patient', actor_user_id: null, ...extra })
  if (error) console.error(`[plan] ${event} event not recorded | proposal=${proposalId}: ${error.message}`)
}

export type DobResult =
  | { ok: true }
  | { ok: false; reason: 'wrong'; remaining: number }
  | { ok: false; reason: 'locked' | 'unavailable' }

const DOB_RE = /^\d{4}-\d{2}-\d{2}$/

export async function verifyPlanDob(db: Db, p: PlanProposal, dob: string, now: Date): Promise<DobResult> {
  const { data, error } = await db.from('patients').select('date_of_birth').eq('patient_id', p.patient_id).eq('clinic_id', p.clinic_id).maybeSingle()
  if (error) {
    console.error('[plan] patient lookup failed:', error.message)
    return { ok: false, reason: 'unavailable' }
  }
  const stored = (data as { date_of_birth?: string | null } | null)?.date_of_birth?.slice(0, 10) ?? null
  if (DOB_RE.test(dob) && stored !== null && stored === dob) {
    if (!p.first_viewed_at) {
      const { error: viewError } = await db.from('treatment_proposals').update({ first_viewed_at: now.toISOString() })
        .eq('proposal_id', p.proposal_id).is('first_viewed_at', null)
      if (viewError) console.error('[plan] first view not recorded:', viewError.message)
      await addEvent(db, p.proposal_id, 'viewed')
    }
    return { ok: true }
  }

  const failures = p.dob_failures + 1
  const locked = failures >= MAX_DOB_FAILURES
  const { error: countError } = await db.from('treatment_proposals')
    .update({ dob_failures: failures, ...(locked ? { locked_at: now.toISOString() } : {}) })
    .eq('proposal_id', p.proposal_id)
    .eq('dob_failures', p.dob_failures)
  if (countError) console.error('[plan] DOB failure not counted:', countError.message)
  await addEvent(db, p.proposal_id, 'dob_failed')
  if (locked) {
    await addEvent(db, p.proposal_id, 'locked')
    return { ok: false, reason: 'locked' }
  }
  return { ok: false, reason: 'wrong', remaining: MAX_DOB_FAILURES - failures }
}

// ── The plan ─────────────────────────────────────────────────

export interface PlanItem {
  orderId:        string
  medicationName: string
  form:           string | null
  strength:       string | null
  sig:            string | null
  quantity:       string | null
  daysSupply:     number | null
  priceCents:     number
  required:       boolean
}

export interface PlanOption {
  optionId: string
  label:    string
  items:    PlanItem[]
}

export interface PlanQuote {
  optionId:      string
  subtotalCents: number
  shippingCents: number
  totalCents:    number
}

export interface PlanView {
  status:  'sent' | 'chosen'
  chosen:  { optionId: string; orderIds: string[] } | null
  options: PlanOption[]
  /** The total for the chosen selection, or the first option with everything ticked. */
  quote:   PlanQuote | null
}

interface OrderRow {
  order_id:                 string
  proposal_option_id:       string | null
  proposal_required:        boolean | null
  pharmacy_id:              string | null
  shipping_type:            string | null
  retail_price_snapshot:    number | string | null
  wholesale_price_snapshot: number | string | null
  sig_text:                 string | null
  days_supply:              number | null
  dispense_quantity:        number | string | null
  dispense_unit:            string | null
  package_label:            string | null
  medication_snapshot:      { medication_name?: string; form?: string; dose?: string } | null
}

const ORDER_COLUMNS = 'order_id, proposal_option_id, proposal_required, status, pharmacy_id, shipping_type, retail_price_snapshot, wholesale_price_snapshot, sig_text, days_supply, dispense_quantity, dispense_unit, package_label, medication_snapshot'

interface Loaded {
  options: Array<{ option_id: string; label: string; position: number }>
  orders:  OrderRow[]
}

async function loadOptionsAndOrders(db: Db, p: PlanProposal): Promise<Loaded | null> {
  const { data: options, error } = await db.from('treatment_proposal_options').select('option_id, label, position')
    .eq('proposal_id', p.proposal_id).order('position', { ascending: true })
  if (error) {
    console.error('[plan] options lookup failed:', error.message)
    return null
  }
  const opts = ((options ?? []) as Loaded['options']).slice().sort((a, b) => a.position - b.position)
  if (opts.length === 0) return { options: [], orders: [] }
  const { data: orders, error: ordersError } = await db.from('orders').select(ORDER_COLUMNS)
    .eq('clinic_id', p.clinic_id)
    .eq('patient_id', p.patient_id)
    .eq('status', 'DRAFT')
    .eq('is_active', true)
    .is('deleted_at', null)
    .in('proposal_option_id', opts.map(o => o.option_id))
  if (ordersError) {
    console.error('[plan] items lookup failed:', ordersError.message)
    return null
  }
  return { options: opts, orders: (orders ?? []) as unknown as OrderRow[] }
}

function toItem(o: OrderRow): PlanItem {
  const m = o.medication_snapshot ?? {}
  const quantity = o.package_label?.trim()
    || (o.dispense_quantity != null && o.dispense_unit ? `${Number(o.dispense_quantity)} ${o.dispense_unit}` : null)
  return {
    orderId:        o.order_id,
    medicationName: m.medication_name ?? 'Medication',
    form:           m.form ?? null,
    strength:       m.dose ?? null,
    sig:            o.sig_text ?? null,
    quantity,
    daysSupply:     o.days_supply ?? null,
    priceCents:     dollarsToCents(o.retail_price_snapshot),
    required:       o.proposal_required === true,
  }
}

async function quoteFor(db: Db, p: PlanProposal, optionId: string, rows: OrderRow[]): Promise<PlanQuote | null> {
  try {
    const [rates, clinic] = await Promise.all([
      loadShippingRates(db, rows.map(r => r.pharmacy_id ?? '')),
      db.from('clinics').select('absorb_shipping').eq('clinic_id', p.clinic_id).maybeSingle(),
    ])
    if (clinic.error) throw new Error(clinic.error.message)
    const shipping = computeBundleShipping(
      rows.filter(r => r.pharmacy_id).map(r => ({
        pharmacyId: r.pharmacy_id as string,
        shippingType: r.shipping_type,
        wholesaleCents: dollarsToCents(r.wholesale_price_snapshot),
      })),
      rates,
    )
    const totals = bundleTotals(
      rows.map(r => ({ retailCents: dollarsToCents(r.retail_price_snapshot), wholesaleCents: dollarsToCents(r.wholesale_price_snapshot) })),
      shipping.totalCents,
      { absorbShipping: (clinic.data as { absorb_shipping?: boolean } | null)?.absorb_shipping === true },
    )
    return { optionId, subtotalCents: totals.subtotalCents, shippingCents: totals.patientShippingCents, totalCents: totals.patientTotalCents }
  } catch (err) {
    console.error('[plan] quote failed:', err instanceof Error ? err.message : err)
    return null
  }
}

async function latestChoice(db: Db, proposalId: string): Promise<{ optionId: string; orderIds: string[] } | null | 'error'> {
  const { data, error } = await db.from('proposal_choice_items').select('option_id, order_id, choice_no')
    .eq('proposal_id', proposalId).order('choice_no', { ascending: false })
  if (error) return 'error'
  const rows = (data ?? []) as Array<{ option_id: string; order_id: string; choice_no: number }>
  if (rows.length === 0) return null
  const last = Math.max(...rows.map(r => r.choice_no))
  const kept = rows.filter(r => r.choice_no === last)
  return { optionId: kept[0]!.option_id, orderIds: kept.map(r => r.order_id) }
}

export async function loadPlan(db: Db, p: PlanProposal): Promise<PlanView | null> {
  const loaded = await loadOptionsAndOrders(db, p)
  if (!loaded) return null
  const options: PlanOption[] = loaded.options.map(o => ({
    optionId: o.option_id,
    label:    o.label,
    items:    loaded.orders.filter(r => r.proposal_option_id === o.option_id).map(toItem),
  }))

  let chosen: PlanView['chosen'] = null
  if (p.status === 'chosen') {
    const c = await latestChoice(db, p.proposal_id)
    if (c === 'error') return null
    chosen = c
  }

  const selection = chosen ?? (options[0] ? { optionId: options[0].optionId, orderIds: options[0].items.map(i => i.orderId) } : null)
  const quote = selection
    ? await quoteFor(db, p, selection.optionId, loaded.orders.filter(r => selection.orderIds.includes(r.order_id)))
    : null

  return { status: p.status === 'chosen' ? 'chosen' : 'sent', chosen, options, quote }
}

// ── Choosing ─────────────────────────────────────────────────

export interface PlanSelection { optionId: string; orderIds: string[] }

export type PlanRefusal = { ok: false; status: 400 | 409 | 503; code: 'option' | 'empty' | 'required' | 'closed' | 'unavailable'; error: string }

const REFUSE = {
  option:      { ok: false, status: 400, code: 'option', error: 'Choose items from one plan only.' },
  empty:       { ok: false, status: 400, code: 'empty', error: 'Choose at least one item.' },
  required:    { ok: false, status: 400, code: 'required', error: 'Items your provider marked as essential must stay in the plan.' },
  closed:      { ok: false, status: 409, code: 'closed', error: 'This plan can no longer be changed. Please contact your clinic.' },
  unavailable: { ok: false, status: 503, code: 'unavailable', error: 'Please try again in a moment.' },
} as const satisfies Record<string, PlanRefusal>

/** The option's rows for a valid selection, or why it is refused. */
function checkSelection(loaded: Loaded, s: PlanSelection): { ok: true; rows: OrderRow[] } | PlanRefusal {
  if (!loaded.options.some(o => o.option_id === s.optionId)) return REFUSE.option
  if (s.orderIds.length === 0) return REFUSE.empty
  if (new Set(s.orderIds).size !== s.orderIds.length) return REFUSE.option
  const optionRows = loaded.orders.filter(r => r.proposal_option_id === s.optionId)
  const byId = new Map(optionRows.map(r => [r.order_id, r]))
  if (s.orderIds.some(id => !byId.has(id))) return REFUSE.option
  if (optionRows.some(r => r.proposal_required === true && !s.orderIds.includes(r.order_id))) return REFUSE.required
  return { ok: true, rows: s.orderIds.map(id => byId.get(id)!) }
}

const OPEN: ProposalStatus[] = ['sent', 'chosen']

export async function quotePlan(db: Db, p: PlanProposal, s: PlanSelection): Promise<{ ok: true; quote: PlanQuote } | PlanRefusal> {
  if (!OPEN.includes(p.status)) return REFUSE.closed
  const loaded = await loadOptionsAndOrders(db, p)
  if (!loaded) return REFUSE.unavailable
  const checked = checkSelection(loaded, s)
  if (!checked.ok) return checked
  const quote = await quoteFor(db, p, s.optionId, checked.rows)
  return quote ? { ok: true, quote } : REFUSE.unavailable
}

export async function choosePlan(db: Db, p: PlanProposal, s: PlanSelection, now: Date): Promise<{ ok: true; rechosen: boolean } | PlanRefusal> {
  if (!canTransitionProposal(p.status, 'chosen')) return REFUSE.closed
  const loaded = await loadOptionsAndOrders(db, p)
  if (!loaded) return REFUSE.unavailable
  const checked = checkSelection(loaded, s)
  if (!checked.ok) return checked

  const { data: moved, error } = await db.from('treatment_proposals')
    .update({ status: 'chosen', chosen_option_id: s.optionId, chosen_at: now.toISOString() })
    .eq('proposal_id', p.proposal_id)
    .eq('clinic_id', p.clinic_id)
    .in('status', OPEN)
    .select('proposal_id')
  if (error) {
    console.error('[plan] choice not saved:', error.message)
    return REFUSE.unavailable
  }
  if (!moved || (moved as unknown[]).length === 0) return REFUSE.closed

  const { data: last, error: lastError } = await db.from('proposal_choice_items').select('choice_no')
    .eq('proposal_id', p.proposal_id).order('choice_no', { ascending: false }).limit(1)
  if (lastError) {
    console.error('[plan] choice number lookup failed:', lastError.message)
    return REFUSE.unavailable
  }
  const choiceNo = (((last ?? []) as Array<{ choice_no: number }>)[0]?.choice_no ?? 0) + 1
  const { error: itemsError } = await db.from('proposal_choice_items').insert(
    s.orderIds.map(orderId => ({ proposal_id: p.proposal_id, option_id: s.optionId, order_id: orderId, choice_no: choiceNo })),
  )
  if (itemsError) {
    console.error('[plan] chosen items not saved:', itemsError.message)
    return REFUSE.unavailable
  }
  const rechosen = p.status === 'chosen'
  await addEvent(db, p.proposal_id, rechosen ? 'rechosen' : 'chosen', { option_id: s.optionId, item_count: s.orderIds.length })
  return { ok: true, rechosen }
}

export async function declinePlan(db: Db, p: PlanProposal, now: Date): Promise<{ ok: true } | PlanRefusal> {
  if (!canTransitionProposal(p.status, 'declined')) return REFUSE.closed
  const { data: moved, error } = await db.from('treatment_proposals')
    .update({ status: 'declined', declined_at: now.toISOString() })
    .eq('proposal_id', p.proposal_id)
    .eq('clinic_id', p.clinic_id)
    .in('status', OPEN)
    .select('proposal_id')
  if (error) {
    console.error('[plan] decline not saved:', error.message)
    return REFUSE.unavailable
  }
  if (!moved || (moved as unknown[]).length === 0) return REFUSE.closed
  await addEvent(db, p.proposal_id, 'declined')
  return { ok: true }
}
