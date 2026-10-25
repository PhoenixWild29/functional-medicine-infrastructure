// ============================================================
// The provider proposes (patient protocol choice, PR 2)
// ============================================================
//
// docs/design/patient-protocol-choice.md, section 1 and section 6 row 2.
//
// "Send to patient for choice" stores a proposal: its options (Option A,
// B... with the label the patient reads) and the DRAFT lines tagged to
// them (orders.proposal_option_id, proposal_required). Nothing is signed,
// grouped or charged: the lines stay ordinary drafts, and the provider
// signs only what the patient chooses (PR 4).
//
// Before anything is stored, every signing check except the signature
// runs (canSign, the read-only half of batch sign), as the provider on
// the lines: a line that could not be signed is never offered, with the
// same refusal and words sign gives. A controlled substance (C6) can
// therefore never be proposed. Sending again runs the checks again.
//
// Who: the provider on the lines, or a clinic admin on their behalf. A
// medical assistant may prepare a plan (status 'draft', no link) but not
// send it (403 MA_CANNOT_SEND).
//
// The plan link: a stored token (lib/proposals/token), shown once in the
// answer; the provider copies it or shows a QR code, each recorded. The
// text goes only when texting is set up and the patient opted in
// (lib/proposals/sms). Re-sending replaces the token (the old link stops
// working); editing a line turns the link off until it is re-sent;
// cancelling cancels the lines (DRAFT -> CANCELLED) and the link.

import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { canSign, parseOrderIds, problemsStatus, type BatchProblem } from '@/lib/orders/batch-sign'
import { cancelDraftLines, clinicActorRole } from './cancel-lines'
import { ALLERGIES_REQUIRED_CODE, PLAN_ALLERGIES_REQUIRED_MESSAGE } from '@/lib/patients/allergies'
import { serverEnv } from '@/lib/env'
import { hashProposalToken, newProposalToken, proposalLinkExpiresAt } from './token'
import { canTransitionProposal } from './status'
import { sendProposalLinkSms, type TextingOutcome } from './sms'
import {
  LINK_DELIVERY_EVENT, PROPOSAL_OPTION_LABEL_MAX,
  type LinkDelivery, type ProposalEvent, type ProposalEventActor, type ProposalStatus,
} from './types'

type Db = SupabaseClient<Database>

export const MAX_PROPOSAL_OPTIONS = 6

export interface ProposalCaller { userId: string; role: string | null }

export interface ProposalLineInput { orderId: string; required: boolean }
export interface ProposalOptionInput { label: string; protocolId: string | null; lines: ProposalLineInput[] }
export interface CreateProposalInput {
  patientId:  string
  providerId: string
  options:    ProposalOptionInput[]
  /** false: prepare only (status 'draft', no link); a medical assistant's only choice. */
  send:       boolean
}

export interface ProposalFailure {
  ok:        false
  status:    number
  error:     string
  code?:     string
  problems?: BatchProblem[]
}

export interface SentLink { url: string; expiresAt: string; texting: TextingOutcome }

export type CreateProposalResult = { ok: true; proposalId: string; status: 'draft' | 'sent'; link: SentLink | null } | ProposalFailure
export type SendProposalResult = { ok: true; proposalId: string; resent: boolean; link: SentLink } | ProposalFailure
export type CancelProposalResult = { ok: true; cancelledOrderIds: string[] } | ProposalFailure

const fail = (status: number, error: string, code?: string): ProposalFailure => ({ ok: false, status, error, ...(code ? { code } : {}) })
const UNAVAILABLE = (what: string) => fail(503, `${what} Nothing was sent. Try again.`)

export const MA_CANNOT_SEND = 'MA_CANNOT_SEND'
const MA_SEND_MESSAGE = 'A medical assistant can prepare the plan, but the provider or a clinic admin sends it to the patient.'

/** Plans that are still open: their drafts are Proposed, not Drafts. */
export const OPEN_PROPOSAL_STATUSES: readonly ProposalStatus[] = ['draft', 'sent', 'chosen']

// ── Input ───────────────────────────────────────────────────

export function parseCreateProposal(raw: unknown): { ok: true; value: CreateProposalInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'The plan could not be read.' }
  const b = raw as Record<string, unknown>
  if (typeof b['patientId'] !== 'string' || !b['patientId']) return { ok: false, error: 'patientId is required.' }
  if (typeof b['providerId'] !== 'string' || !b['providerId']) return { ok: false, error: 'providerId is required.' }
  if (typeof b['send'] !== 'boolean') return { ok: false, error: 'send must be true or false.' }
  const rawOptions = b['options']
  if (!Array.isArray(rawOptions) || rawOptions.length === 0) return { ok: false, error: 'A plan needs at least one option.' }
  if (rawOptions.length > MAX_PROPOSAL_OPTIONS) return { ok: false, error: `A plan can have at most ${MAX_PROPOSAL_OPTIONS} options.` }

  const options: ProposalOptionInput[] = []
  for (const o of rawOptions) {
    const opt = (o ?? {}) as Record<string, unknown>
    const label = typeof opt['label'] === 'string' ? opt['label'].trim() : ''
    if (!label) return { ok: false, error: 'Each option needs a name for the patient.' }
    if (label.length > PROPOSAL_OPTION_LABEL_MAX) return { ok: false, error: `Option names are at most ${PROPOSAL_OPTION_LABEL_MAX} characters.` }
    const protocolId = typeof opt['protocolId'] === 'string' && opt['protocolId'] ? opt['protocolId'] : null
    const rawLines = opt['lines']
    if (!Array.isArray(rawLines) || rawLines.length === 0) return { ok: false, error: 'Each option needs at least one prescription.' }
    const lines: ProposalLineInput[] = []
    for (const l of rawLines) {
      const line = (l ?? {}) as Record<string, unknown>
      if (typeof line['orderId'] !== 'string' || typeof line['required'] !== 'boolean') return { ok: false, error: 'Each prescription needs its order id and whether it is required.' }
      lines.push({ orderId: line['orderId'], required: line['required'] })
    }
    options.push({ label, protocolId, lines })
  }
  const all = options.flatMap(o => o.lines.map(l => l.orderId))
  if (new Set(all).size !== all.length) return { ok: false, error: 'A prescription can be in one option only.' }
  const ids = parseOrderIds(all)
  if (!ids.ok) return { ok: false, error: ids.error }
  return { ok: true, value: { patientId: b['patientId'], providerId: b['providerId'], options, send: b['send'] } }
}

// ── Who ─────────────────────────────────────────────────────

type Action = 'prepare' | 'send' | 'manage'

/**
 * May this caller act on a plan for this provider? A provider only for
 * their own lines; a clinic admin on any provider's behalf; a medical
 * assistant may prepare only.
 */
async function actorFor(db: Db, clinicId: string, caller: ProposalCaller, providerId: string, action: Action):
  Promise<{ ok: true; actor: ProposalEventActor } | ProposalFailure> {
  switch (caller.role) {
    case 'provider': {
      const { data, error } = await db.from('providers')
        .select('provider_id')
        .eq('user_id', caller.userId)
        .eq('clinic_id', clinicId)
        .eq('is_active', true)
        .is('deleted_at', null)
        .maybeSingle()
      if (error) {
        console.error('[proposals] caller provider could not be read:', error.message)
        return UNAVAILABLE('Your provider record could not be read.')
      }
      if ((data as { provider_id?: string } | null)?.provider_id !== providerId) {
        return fail(403, 'You can send a plan only for your own prescriptions.')
      }
      return { ok: true, actor: 'provider' }
    }
    case 'clinic_admin':
      return { ok: true, actor: 'clinic_staff' }
    case 'medical_assistant':
      if (action === 'prepare') return { ok: true, actor: 'clinic_staff' }
      return action === 'send'
        ? fail(403, MA_SEND_MESSAGE, MA_CANNOT_SEND)
        : fail(403, 'The provider or a clinic admin manages a plan once it is prepared.')
    default:
      return fail(403, 'Only clinic staff can prepare a plan for a patient.')
  }
}

// ── Events ──────────────────────────────────────────────────

async function recordEvent(db: Db, proposalId: string, event: ProposalEvent, actor: ProposalEventActor, userId: string | null): Promise<boolean> {
  const { error } = await db.from('treatment_proposal_events').insert({
    proposal_id: proposalId, event, actor, actor_user_id: userId,
  })
  if (error) {
    console.error(`[proposals] event not recorded (${event}) | proposal=${proposalId}:`, error.message)
    return false
  }
  return true
}

// ── The checks: every signing check but the signature ───────

/**
 * canSign's problems, as sign answers them. When the only thing missing
 * is the patient's allergy status (coverage gap 9), one refusal for the
 * whole plan, in proposing words, with the code Review opens its allergy
 * prompt on: not the same sentence once per line.
 */
function refusal(problems: BatchProblem[]): ProposalFailure {
  if (problems.length > 0 && problems.every(p => p.code === 'allergies_required')) {
    return { ok: false, status: problemsStatus(problems), code: ALLERGIES_REQUIRED_CODE, error: PLAN_ALLERGIES_REQUIRED_MESSAGE }
  }
  return {
    ok: false,
    status: problemsStatus(problems),
    error: problems.length === 1 ? problems[0]!.message : `${problems.length} problems. Nothing was signed. Each is shown against its line.`,
    problems,
  }
}

interface LineRow { order_id: string; status: string; patient_id: string; provider_id: string; proposal_option_id: string | null }

async function readLines(db: Db, clinicId: string, filter: { orderIds: string[] } | { optionIds: string[] }): Promise<LineRow[] | null> {
  let q = db.from('orders')
    .select('order_id, status, patient_id, provider_id, proposal_option_id')
    .eq('clinic_id', clinicId)
    .eq('is_active', true)
    .is('deleted_at', null)
  q = 'orderIds' in filter ? q.in('order_id', filter.orderIds) : q.in('proposal_option_id', filter.optionIds)
  const { data, error } = await q
  if (error) {
    console.error('[proposals] lines could not be read:', error.message)
    return null
  }
  return (data ?? []) as unknown as LineRow[]
}

// ── Sending (and re-sending) ────────────────────────────────

interface ProposalRow { proposal_id: string; clinic_id: string; patient_id: string; provider_id: string; status: ProposalStatus }

function planUrl(token: string): string {
  return `${serverEnv.appBaseUrl().replace(/\/+$/, '')}/plan/${token}`
}

/** A new link for a checked plan: replaces any earlier token, texts it when texting is on. */
async function issueLink(db: Db, p: ProposalRow, actor: ProposalEventActor, caller: ProposalCaller, providerLastName: string, now: Date):
  Promise<{ ok: true; resent: boolean; link: SentLink } | ProposalFailure> {
  const token = newProposalToken()
  const expiresAt = proposalLinkExpiresAt(now).toISOString()
  const resent = p.status !== 'draft'
  const { data, error } = await db.from('treatment_proposals')
    .update({
      token_hash: hashProposalToken(token),
      sent_at:    now.toISOString(),
      expires_at: expiresAt,
      // A new link starts its own date-of-birth count.
      dob_failures: 0,
      locked_at:    null,
      ...(resent ? {} : { status: 'sent' as const }),
    })
    .eq('proposal_id', p.proposal_id)
    .eq('status', p.status)
    .select('proposal_id')
  if (error || ((data ?? []) as unknown[]).length === 0) {
    if (error) console.error('[proposals] link could not be stored:', error.message, '| proposal=', p.proposal_id)
    return error ? UNAVAILABLE('The plan link could not be saved.') : fail(409, 'This plan changed while it was being sent. Reload and try again.')
  }
  await recordEvent(db, p.proposal_id, resent ? 'resent' : 'sent', actor, caller.userId)

  const url = planUrl(token)
  const texting = await sendProposalLinkSms(db, { proposalId: p.proposal_id, patientId: p.patient_id, providerLastName, url })
  if (texting === 'sent') await recordEvent(db, p.proposal_id, 'sms_sent', 'system', null)
  console.info(`[proposals] link ${resent ? 'resent' : 'sent'} | proposal=${p.proposal_id} | texting=${texting}`)
  return { ok: true, resent, link: { url, expiresAt, texting } }
}

async function readProposal(db: Db, clinicId: string, proposalId: string): Promise<ProposalRow | null | 'error'> {
  const { data, error } = await db.from('treatment_proposals')
    .select('proposal_id, clinic_id, patient_id, provider_id, status')
    .eq('proposal_id', proposalId)
    .eq('clinic_id', clinicId)
    .maybeSingle()
  if (error) {
    console.error('[proposals] proposal could not be read:', error.message, '| proposal=', proposalId)
    return 'error'
  }
  return (data as ProposalRow | null) ?? null
}

async function optionIdsOf(db: Db, proposalId: string): Promise<string[] | null> {
  const { data, error } = await db.from('treatment_proposal_options').select('option_id').eq('proposal_id', proposalId)
  if (error) {
    console.error('[proposals] options could not be read:', error.message, '| proposal=', proposalId)
    return null
  }
  return ((data ?? []) as Array<{ option_id: string }>).map(o => o.option_id)
}

// ── Create ──────────────────────────────────────────────────

/** Take a half-stored plan back: its lines untagged, the plan cancelled. */
async function unwind(db: Db, proposalId: string, optionIds: string[], now: Date): Promise<void> {
  if (optionIds.length > 0) {
    const { error } = await db.from('orders').update({ proposal_option_id: null, proposal_required: null }).in('proposal_option_id', optionIds)
    if (error) console.error('[proposals] lines could not be untagged after a failed save:', error.message, '| proposal=', proposalId)
  }
  const { error } = await db.from('treatment_proposals').update({ status: 'cancelled', cancelled_at: now.toISOString(), token_hash: null }).eq('proposal_id', proposalId)
  if (error) console.error('[proposals] half-saved plan could not be cancelled:', error.message, '| proposal=', proposalId)
  await recordEvent(db, proposalId, 'cancelled', 'system', null)
}

export async function createProposal(
  db: Db,
  input: { clinicId: string; caller: ProposalCaller; input: unknown; now?: Date },
): Promise<CreateProposalResult> {
  const now = input.now ?? new Date()
  const parsed = parseCreateProposal(input.input)
  if (!parsed.ok) return fail(400, parsed.error)
  const plan = parsed.value
  const { clinicId, caller } = input

  const who = await actorFor(db, clinicId, caller, plan.providerId, plan.send ? 'send' : 'prepare')
  if (!who.ok) return who

  // ── The lines, before anything is written ──
  const orderIds = plan.options.flatMap(o => o.lines.map(l => l.orderId))
  const rows = await readLines(db, clinicId, { orderIds })
  if (!rows) return UNAVAILABLE('The prescriptions could not be loaded.')
  const byId = new Map(rows.map(r => [r.order_id, r]))
  if (orderIds.some(oid => !byId.has(oid))) return fail(404, 'A prescription in this plan no longer exists or was removed.')
  if (rows.some(r => r.patient_id !== plan.patientId)) return fail(422, 'Every prescription in a plan must be for the same patient.')
  if (rows.some(r => r.status !== 'DRAFT')) return fail(409, 'Only draft prescriptions can be offered to the patient. One of these is no longer a draft.')
  if (rows.some(r => r.proposal_option_id)) return fail(409, 'A prescription here is already in another plan. Cancel that plan first.')

  const check = await canSign(db, { clinicId, orderIds, as: { providerId: plan.providerId }, atSigning: true })
  if (check.problems.length > 0 || !check.signer) return refusal(check.problems)

  // ── Store: the plan, its options, the tagged lines ──
  const proposalId = randomUUID()
  const { error: proposalError } = await db.from('treatment_proposals').insert({
    proposal_id: proposalId, clinic_id: clinicId, patient_id: plan.patientId, provider_id: plan.providerId,
    created_by: caller.userId, status: 'draft', token_hash: null, dob_failures: 0,
  })
  if (proposalError) {
    console.error('[proposals] proposal could not be stored:', proposalError.message)
    return UNAVAILABLE('The plan could not be saved.')
  }
  const options = plan.options.map((o, i) => ({ option_id: randomUUID(), proposal_id: proposalId, label: o.label, position: i + 1, protocol_id: o.protocolId }))
  const optionIds = options.map(o => o.option_id)
  const { error: optionsError } = await db.from('treatment_proposal_options').insert(options)
  if (optionsError) {
    console.error('[proposals] options could not be stored:', optionsError.message, '| proposal=', proposalId)
    await unwind(db, proposalId, [], now)
    return UNAVAILABLE('The plan could not be saved.')
  }
  for (const [i, o] of plan.options.entries()) {
    for (const line of o.lines) {
      // Only a draft no other plan holds, so two sends can never share a line.
      const { data, error } = await db.from('orders')
        .update({ proposal_option_id: options[i]!.option_id, proposal_required: line.required })
        .eq('order_id', line.orderId)
        .eq('clinic_id', clinicId)
        .eq('status', 'DRAFT')
        .is('proposal_option_id', null)
        .select('order_id')
      if (error || ((data ?? []) as unknown[]).length === 0) {
        if (error) console.error('[proposals] line could not be tagged:', error.message, '| proposal=', proposalId)
        await unwind(db, proposalId, optionIds, now)
        return error
          ? UNAVAILABLE('The plan could not be saved.')
          : fail(409, 'A prescription in this plan changed while it was being saved. Nothing was sent; try again.')
      }
    }
  }
  await recordEvent(db, proposalId, 'created', who.actor, caller.userId)

  if (!plan.send) {
    console.info(`[proposals] prepared | proposal=${proposalId} | options=${options.length} | lines=${orderIds.length}`)
    return { ok: true, proposalId, status: 'draft', link: null }
  }
  const sent = await issueLink(db, { proposal_id: proposalId, clinic_id: clinicId, patient_id: plan.patientId, provider_id: plan.providerId, status: 'draft' }, who.actor, caller, check.signer.last_name, now)
  if (!sent.ok) return sent
  return { ok: true, proposalId, status: 'sent', link: sent.link }
}

// ── Send a prepared plan, or a new link ─────────────────────

export async function sendProposal(
  db: Db,
  input: { clinicId: string; caller: ProposalCaller; proposalId: string; now?: Date },
): Promise<SendProposalResult> {
  const now = input.now ?? new Date()
  const p = await readProposal(db, input.clinicId, input.proposalId)
  if (p === 'error') return UNAVAILABLE('The plan could not be read.')
  if (!p) return fail(404, 'Plan not found.')
  if (!OPEN_PROPOSAL_STATUSES.includes(p.status)) return fail(409, `This plan is ${p.status} and cannot be sent again.`)
  if (p.status === 'draft' && !canTransitionProposal('draft', 'sent')) return fail(409, 'This plan cannot be sent.')

  const who = await actorFor(db, input.clinicId, input.caller, p.provider_id, 'send')
  if (!who.ok) return who

  const optionIds = await optionIdsOf(db, p.proposal_id)
  if (!optionIds) return UNAVAILABLE('The plan could not be read.')
  const rows = optionIds.length ? await readLines(db, input.clinicId, { optionIds }) : []
  if (!rows) return UNAVAILABLE('The prescriptions could not be loaded.')
  if (rows.length === 0) return fail(409, 'This plan has no prescriptions left. Cancel it and make a new one.')
  if (rows.some(r => r.status !== 'DRAFT')) return fail(409, 'Only draft prescriptions can be offered to the patient. One of these is no longer a draft.')

  // Licenses, prices and compounding status can change after a plan was
  // prepared or first sent: every check runs again.
  const check = await canSign(db, { clinicId: input.clinicId, orderIds: rows.map(r => r.order_id), as: { providerId: p.provider_id }, atSigning: true })
  if (check.problems.length > 0 || !check.signer) return refusal(check.problems)

  const sent = await issueLink(db, p, who.actor, input.caller, check.signer.last_name, now)
  if (!sent.ok) return sent
  return { ok: true, proposalId: p.proposal_id, resent: sent.resent, link: sent.link }
}

// ── Cancel ──────────────────────────────────────────────────

export async function cancelProposal(
  db: Db,
  input: { clinicId: string; caller: ProposalCaller; proposalId: string; now?: Date },
): Promise<CancelProposalResult> {
  const now = input.now ?? new Date()
  const p = await readProposal(db, input.clinicId, input.proposalId)
  if (p === 'error') return UNAVAILABLE('The plan could not be read.')
  if (!p) return fail(404, 'Plan not found.')
  if (!canTransitionProposal(p.status, 'cancelled')) return fail(409, `This plan is ${p.status} and cannot be cancelled.`)

  const who = await actorFor(db, input.clinicId, input.caller, p.provider_id, 'manage')
  if (!who.ok) return who

  const optionIds = await optionIdsOf(db, p.proposal_id)
  if (!optionIds) return fail(503, 'The plan could not be read. Nothing was cancelled. Try again.')

  // The link first: from here the patient can no longer choose.
  const { data: closed, error: closeError } = await db.from('treatment_proposals')
    .update({ status: 'cancelled', cancelled_at: now.toISOString(), token_hash: null })
    .eq('proposal_id', p.proposal_id)
    .eq('status', p.status)
    .select('proposal_id')
  if (closeError || ((closed ?? []) as unknown[]).length === 0) {
    if (closeError) console.error('[proposals] plan could not be cancelled:', closeError.message, '| proposal=', p.proposal_id)
    return closeError ? fail(503, 'The plan could not be cancelled. Try again.') : fail(409, 'This plan changed. Reload and try again.')
  }

  // Its drafts: DRAFT -> CANCELLED (never signed). They stay tagged to the
  // plan, so the clinic still sees what was offered (decision 9).
  // Each through casTransition as the caller's role, which writes the
  // history row.
  let cancelledOrderIds: string[] = []
  if (optionIds.length > 0) {
    const actorRole = clinicActorRole(input.caller.role)
    const { data, error } = actorRole
      ? await db.from('orders')
        .select('order_id')
        .in('proposal_option_id', optionIds)
        .eq('clinic_id', input.clinicId)
        .eq('status', 'DRAFT')
      : { data: null, error: { message: `caller role ${input.caller.role ?? 'none'} is not a clinic role` } }
    if (error || !actorRole) {
      console.error('[proposals] lines could not be cancelled:', error?.message, '| proposal=', p.proposal_id)
      return fail(503, 'The plan was closed, but its prescriptions could not be cancelled. Try again from each draft.')
    }
    const cancelled = await cancelDraftLines(db, {
      orderIds: ((data ?? []) as Array<{ order_id: string }>).map(r => r.order_id),
      actor: input.caller.userId, actorRole,
      metadata: { reason: 'proposal_cancelled', proposal_id: p.proposal_id },
    })
    cancelledOrderIds = cancelled.cancelledOrderIds
    if (!cancelled.ok) {
      console.error('[proposals] lines could not be cancelled:', cancelled.error, '| proposal=', p.proposal_id)
      return fail(503, 'The plan was closed, but its prescriptions could not be cancelled. Try again from each draft.')
    }
  }
  await recordEvent(db, p.proposal_id, 'cancelled', who.actor, input.caller.userId)
  console.info(`[proposals] cancelled | proposal=${p.proposal_id} | lines=${cancelledOrderIds.length}`)
  return { ok: true, cancelledOrderIds }
}

// ── Delivery events: Copy link, Show QR code ────────────────

export async function recordLinkDelivery(
  db: Db,
  input: { clinicId: string; caller: ProposalCaller; proposalId: string; delivery: Exclude<LinkDelivery, 'sms'> },
): Promise<{ ok: true } | ProposalFailure> {
  const p = await readProposal(db, input.clinicId, input.proposalId)
  if (p === 'error') return fail(503, 'The plan could not be read.')
  if (!p) return fail(404, 'Plan not found.')
  if (p.status !== 'sent' && p.status !== 'chosen') return fail(409, 'This plan has no open link.')
  const who = await actorFor(db, input.clinicId, input.caller, p.provider_id, 'manage')
  if (!who.ok) return who
  const ok = await recordEvent(db, p.proposal_id, LINK_DELIVERY_EVENT[input.delivery], who.actor, input.caller.userId)
  return ok ? { ok: true } : fail(503, 'The event could not be recorded.')
}

// ── Editing a proposed line turns its link off ──────────────

/**
 * A proposed line was edited or removed: the plan the patient would see
 * is no longer the one the checks ran on, so its link stops working until
 * the provider sends a new one (which runs every check again). True when
 * a link was turned off. Never throws.
 */
export async function revokeProposalLinkForOrder(db: Db, input: { clinicId: string; orderId: string }): Promise<boolean> {
  try {
    const { data: order, error } = await db.from('orders')
      .select('proposal_option_id')
      .eq('order_id', input.orderId)
      .eq('clinic_id', input.clinicId)
      .maybeSingle()
    const optionId = (order as { proposal_option_id?: string | null } | null)?.proposal_option_id
    if (error || !optionId) {
      if (error) console.error('[proposals] edited line could not be read:', error.message, '| order=', input.orderId)
      return false
    }
    const { data: option, error: optionError } = await db.from('treatment_proposal_options')
      .select('proposal_id')
      .eq('option_id', optionId)
      .maybeSingle()
    const proposalId = (option as { proposal_id?: string } | null)?.proposal_id
    if (optionError || !proposalId) {
      if (optionError) console.error('[proposals] edited line option could not be read:', optionError.message, '| order=', input.orderId)
      return false
    }
    const { data, error: revokeError } = await db.from('treatment_proposals')
      .update({ token_hash: null })
      .eq('proposal_id', proposalId)
      .eq('clinic_id', input.clinicId)
      .in('status', ['sent', 'chosen'])
      .select('proposal_id')
    if (revokeError) {
      console.error('[proposals] link could not be turned off after an edit:', revokeError.message, '| proposal=', proposalId)
      return false
    }
    const revoked = ((data ?? []) as unknown[]).length > 0
    if (revoked) console.info(`[proposals] link turned off after an edit | proposal=${proposalId} | order=${input.orderId}`)
    return revoked
  } catch (err) {
    console.error('[proposals] revoke after edit failed:', err instanceof Error ? err.message : err)
    return false
  }
}
