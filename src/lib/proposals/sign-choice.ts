// ============================================================
// Sign what the patient chose (patient protocol choice, PR 4)
// ============================================================
//
// docs/design/patient-protocol-choice.md, section 1 step 5 and section 6
// row 4. The provider signs only the chosen lines, through the existing
// batch sign with exactly those order ids (lib/proposals/chosen): batch
// sign runs every check again (C4, C5, C6, C8, price / WO-108 repricing,
// intake, allergy and interactions), allocates shipping, creates the
// payment group for 2+ lines or the solo checkout, and sends the payment
// link as today (texting rules unchanged; when texting is off the
// dashboard's Copy Payment Link applies). Who may sign is batch sign's
// rule (resolveSigner): the provider, or a clinic admin signing as their
// own linked, NPI-verified provider. A medical assistant cannot.
//
// Only once batch sign has signed:
//   - every other DRAFT line of the proposal goes DRAFT -> CANCELLED
//     (never signed; it stays tagged, so the clinic sees what was not
//     chosen, decision 9);
//   - the proposal is signed (signed_at), its link dies (token_hash
//     NULL), and 'signed' is recorded with the count;
//   - the chosen lines of a protocol option start or advance the
//     patient's protocol instance (decision 8: at signing, not proposal).
// A check that fails at sign stops the whole choice: nothing is signed or
// cancelled, and the proposal stays chosen for the provider to fix (for
// example, edit a repriced line) and sign again.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { signBatch, type BatchProblem, type SignedPatient } from '@/lib/orders/batch-sign'
import { insertStatusHistory } from '@/lib/orders/status-history'
import { resolveProtocolLinkage } from '@/lib/protocols/resolve-instance'
import { choiceFrom, readProposalRows } from './chosen'

type Db = SupabaseClient<Database>

export type SignChoiceResult =
  | { ok: true; signedOrderIds: string[]; cancelledOrderIds: string[]; patients: SignedPatient[] }
  | { ok: false; status: number; error: string; code?: string; problems?: BatchProblem[] }

const NOT_CHOSEN: Record<string, string> = {
  draft:     'This plan has not been sent to the patient yet.',
  sent:      'The patient has not chosen yet. Signing opens once they choose.',
  signed:    'This plan is already signed.',
  declined:  'The patient declined this plan, so there is nothing to sign.',
  expired:   'This plan expired before it was signed.',
  cancelled: 'This plan was cancelled.',
}

export async function signChosenProposal(
  db: Db,
  input: { clinicId: string; userId: string; appRole: string | null; proposalId: string; signature: unknown; now?: Date },
): Promise<SignChoiceResult> {
  const now = input.now ?? new Date()
  const { data: found, error } = await db.from('treatment_proposals')
    .select('proposal_id, clinic_id, patient_id, provider_id, status, chosen_option_id')
    .eq('proposal_id', input.proposalId)
    .eq('clinic_id', input.clinicId)
    .maybeSingle()
  if (error) {
    console.error('[proposal-sign] proposal could not be read:', error.message, '| proposal=', input.proposalId)
    return { ok: false, status: 503, error: 'The plan could not be read. Nothing was signed. Try again.' }
  }
  const p = found as { proposal_id: string; patient_id: string; provider_id: string; status: string; chosen_option_id: string | null } | null
  if (!p) return { ok: false, status: 404, error: 'Plan not found.' }
  if (p.status !== 'chosen' || !p.chosen_option_id) {
    return { ok: false, status: 409, error: NOT_CHOSEN[p.status] ?? 'This plan cannot be signed.' }
  }

  const rows = await readProposalRows(db, input.clinicId, [p.proposal_id])
  if (!rows) return { ok: false, status: 503, error: "The patient's choice could not be read. Nothing was signed. Try again." }
  const choice = choiceFrom(p.chosen_option_id, rows.options, rows.lines, rows.items)
  if (!choice || choice.chosenOrderIds.length === 0) {
    return { ok: false, status: 409, error: 'The chosen option has no prescriptions left to sign.' }
  }

  // ── Sign exactly the chosen lines: every check runs again ──
  const signed = await signBatch(db, {
    clinicId: input.clinicId, userId: input.userId, appRole: input.appRole,
    orderIds: choice.chosenOrderIds, signature: input.signature,
  })
  if (!signed.ok) {
    return {
      ok: false,
      status: signed.status,
      error: /nothing was signed/i.test(signed.error) ? signed.error : `${signed.error} Nothing was signed.`,
      ...(signed.code ? { code: signed.code } : {}),
      ...(signed.problems ? { problems: signed.problems } : {}),
    }
  }

  // ── Signed. The rest of the plan is never signed ──
  const chosen = new Set(choice.chosenOrderIds)
  const unchosen = rows.lines.filter(l => !chosen.has(l.order_id) && l.status === 'DRAFT').map(l => l.order_id)
  let cancelledOrderIds: string[] = []
  if (unchosen.length > 0) {
    const { data, error: cancelError } = await db.from('orders')
      .update({ status: 'CANCELLED' })
      .in('order_id', unchosen)
      .eq('clinic_id', input.clinicId)
      .eq('status', 'DRAFT')
      .select('order_id')
    if (cancelError) {
      // Signed already; the unchosen drafts stay drafts in the plan. Logged
      // for ops: they are never signable from Drafts (they are tagged).
      console.error('[proposal-sign] unchosen lines could not be cancelled:', cancelError.message, '| proposal=', p.proposal_id)
    } else {
      cancelledOrderIds = ((data ?? []) as Array<{ order_id: string }>).map(r => r.order_id)
      await insertStatusHistory(db, cancelledOrderIds.map(order_id => ({
        order_id, old_status: 'DRAFT' as const, new_status: 'CANCELLED' as const, changed_by: input.userId,
        metadata: { reason: 'proposal_not_chosen', proposal_id: p.proposal_id },
      })), 'proposal-sign')
    }
  }

  const { error: closeError } = await db.from('treatment_proposals')
    .update({ status: 'signed', signed_at: now.toISOString(), token_hash: null })
    .eq('proposal_id', p.proposal_id)
    .eq('status', 'chosen')
  if (closeError) console.error('[proposal-sign] proposal could not be marked signed:', closeError.message, '| proposal=', p.proposal_id)

  const { error: eventError } = await db.from('treatment_proposal_events').insert({
    proposal_id: p.proposal_id, event: 'signed', actor: 'provider', actor_user_id: input.userId,
    option_id: choice.option.option_id, item_count: choice.chosenOrderIds.length,
  })
  if (eventError) console.error('[proposal-sign] signed event not recorded:', eventError.message, '| proposal=', p.proposal_id)

  // ── Decision 8: the protocol starts (or advances) now, for what was signed ──
  if (choice.option.protocol_id) {
    const linkage = await resolveProtocolLinkage({
      supabase: db, protocolId: choice.option.protocol_id, patientId: p.patient_id, providerId: p.provider_id, clinicId: input.clinicId,
    })
    if (linkage) {
      const { error: linkError } = await db.from('orders')
        .update({ protocol_instance_id: linkage.protocolInstanceId, protocol_version_id: linkage.protocolVersionId })
        .in('order_id', choice.chosenOrderIds)
        .eq('clinic_id', input.clinicId)
      if (linkError) console.warn('[proposal-sign] protocol linkage not written:', linkError.message, '| proposal=', p.proposal_id)
    }
  }

  console.info(`[proposal-sign] signed | proposal=${p.proposal_id} | signed=${choice.chosenOrderIds.length} | cancelled=${cancelledOrderIds.length}`)
  return { ok: true, signedOrderIds: choice.chosenOrderIds, cancelledOrderIds, patients: signed.patients }
}
