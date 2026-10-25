// ============================================================
// What the patient chose (patient protocol choice, PR 4)
// ============================================================
//
// Read from PR 1's tables only (PR 3 writes them): the proposal's
// chosen_option_id, and proposal_choice_items, one row per item kept per
// choice (choice_no counts re-choices; the latest choice is the one that
// counts). The chosen lines are the option's required lines plus the
// optional lines kept in the latest choice. A choice item outside the
// chosen option is ignored: a patient can never add a line the option
// does not hold, and required lines are in whatever PR 3 stores.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

type Db = SupabaseClient<Database>

export interface OptionRow { option_id: string; proposal_id: string; label: string; position: number; protocol_id: string | null }
export interface LineRow { order_id: string; status: string; proposal_option_id: string; proposal_required: boolean | null }
export interface ChoiceItemRow { proposal_id: string; option_id: string; order_id: string; choice_no: number }

export interface Choice {
  option:         OptionRow
  /** Every line of the chosen option, in order. */
  optionOrderIds: string[]
  /** What is signed: required lines + optional lines kept in the latest choice. */
  chosenOrderIds: string[]
  /** The latest choice_no, or null when no item was kept. */
  choiceNo:       number | null
}

/** The chosen lines, from rows already read. Pure. */
export function choiceFrom(
  chosenOptionId: string,
  options: OptionRow[],
  lines: LineRow[],
  items: ChoiceItemRow[],
): Choice | null {
  const option = options.find(o => o.option_id === chosenOptionId)
  if (!option) return null
  const optionLines = lines.filter(l => l.proposal_option_id === option.option_id)
  const mine = items.filter(i => i.option_id === option.option_id)
  const choiceNo = mine.length ? Math.max(...mine.map(i => i.choice_no)) : null
  const kept = new Set(mine.filter(i => i.choice_no === choiceNo).map(i => i.order_id))
  return {
    option,
    optionOrderIds: optionLines.map(l => l.order_id),
    chosenOrderIds: optionLines.filter(l => l.proposal_required !== false || kept.has(l.order_id)).map(l => l.order_id),
    choiceNo,
  }
}

export interface ProposalRows { options: OptionRow[]; lines: LineRow[]; items: ChoiceItemRow[] }

/** Options, lines and choice items of these proposals; null when a read failed. */
export async function readProposalRows(db: Db, clinicId: string, proposalIds: string[]): Promise<ProposalRows | null> {
  if (proposalIds.length === 0) return { options: [], lines: [], items: [] }
  const [optionsRes, itemsRes] = await Promise.all([
    db.from('treatment_proposal_options').select('option_id, proposal_id, label, position, protocol_id').in('proposal_id', proposalIds).order('position', { ascending: true }),
    db.from('proposal_choice_items').select('proposal_id, option_id, order_id, choice_no').in('proposal_id', proposalIds),
  ])
  if (optionsRes.error || itemsRes.error) {
    console.error('[proposals] choice could not be read:', (optionsRes.error ?? itemsRes.error)?.message)
    return null
  }
  const options = (optionsRes.data ?? []) as OptionRow[]
  const optionIds = options.map(o => o.option_id)
  if (optionIds.length === 0) return { options, lines: [], items: (itemsRes.data ?? []) as ChoiceItemRow[] }
  const linesRes = await db.from('orders')
    .select('order_id, status, proposal_option_id, proposal_required')
    .in('proposal_option_id', optionIds)
    .eq('clinic_id', clinicId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
  if (linesRes.error) {
    console.error('[proposals] plan lines could not be read:', linesRes.error.message)
    return null
  }
  return { options, lines: (linesRes.data ?? []) as unknown as LineRow[], items: (itemsRes.data ?? []) as ChoiceItemRow[] }
}
