// ============================================================
// Chosen plans in the signature queue (patient protocol choice, PR 4)
// ============================================================
//
// "Jordan chose Foundation plan (3 of 4 items)": the provider sees each
// chosen, unsigned plan above the dashboard's orders, with Review and
// sign, and the clinic gets one in-app notification per choice
// (clinic_notifications, type 'general'). Read from PR 1's tables only.
// No medication is named: the dashboard and the notification say who
// chose which option, and how many items.
//
// notifyClinicOfChoice is for PR 3's choose step to call once the choice
// is stored (it is idempotent per choice, so a retry never notifies twice).

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { choiceFrom, readProposalRows } from './chosen'

type Db = SupabaseClient<Database>

export interface ChosenPlan {
  proposalId:       string
  providerId:       string
  patientId:        string
  patientFirstName: string
  optionLabel:      string
  chosenOrderIds:   string[]
  chosenCount:      number
  optionCount:      number
  chosenAt:         string | null
  choiceNo:         number | null
}

export function choiceSummary(p: { patientFirstName: string; optionLabel: string; chosenCount: number; optionCount: number }): string {
  const who = p.patientFirstName.trim() || 'The patient'
  return `${who} chose ${p.optionLabel} (${p.chosenCount} of ${p.optionCount} item${p.optionCount === 1 ? '' : 's'})`
}

interface ProposalRow { proposal_id: string; clinic_id: string; patient_id: string; provider_id: string; chosen_option_id: string | null; chosen_at: string | null }

async function plansFor(db: Db, clinicId: string, proposals: ProposalRow[]): Promise<ChosenPlan[] | null> {
  const rows = await readProposalRows(db, clinicId, proposals.map(p => p.proposal_id))
  if (!rows) return null
  const patientIds = [...new Set(proposals.map(p => p.patient_id))]
  const { data: patients, error } = patientIds.length
    ? await db.from('patients').select('patient_id, first_name').in('patient_id', patientIds)
    : { data: [], error: null }
  if (error) {
    console.error('[proposal-queue] patients could not be read:', error.message)
    return null
  }
  const firstName = new Map(((patients ?? []) as Array<{ patient_id: string; first_name: string | null }>).map(p => [p.patient_id, p.first_name ?? '']))
  const plans: ChosenPlan[] = []
  for (const p of proposals) {
    if (!p.chosen_option_id) continue
    const choice = choiceFrom(p.chosen_option_id, rows.options.filter(o => o.proposal_id === p.proposal_id), rows.lines, rows.items.filter(i => i.proposal_id === p.proposal_id))
    if (!choice) continue
    plans.push({
      proposalId:       p.proposal_id,
      providerId:       p.provider_id,
      patientId:        p.patient_id,
      patientFirstName: firstName.get(p.patient_id) ?? '',
      optionLabel:      choice.option.label,
      chosenOrderIds:   choice.chosenOrderIds,
      chosenCount:      choice.chosenOrderIds.length,
      optionCount:      choice.optionOrderIds.length,
      chosenAt:         p.chosen_at,
      choiceNo:         choice.choiceNo,
    })
  }
  return plans
}

const PROPOSAL_COLUMNS = 'proposal_id, clinic_id, patient_id, provider_id, chosen_option_id, chosen_at'

/** The clinic's chosen, unsigned plans, oldest choice first. A failed read is { ok: false }, never an empty queue. */
export async function loadChosenProposals(db: Db, clinicId: string): Promise<{ ok: true; plans: ChosenPlan[] } | { ok: false }> {
  const { data, error } = await db.from('treatment_proposals')
    .select(PROPOSAL_COLUMNS)
    .eq('clinic_id', clinicId)
    .eq('status', 'chosen')
    .order('chosen_at', { ascending: true })
  if (error) {
    console.error('[proposal-queue] chosen plans could not be read:', error.message)
    return { ok: false }
  }
  const plans = await plansFor(db, clinicId, (data ?? []) as ProposalRow[])
  return plans ? { ok: true, plans } : { ok: false }
}

/**
 * One in-app notification for the clinic when a patient chooses (and again
 * for a re-choice). True when one was written. Never throws.
 */
export async function notifyClinicOfChoice(db: Db, input: { proposalId: string }): Promise<boolean> {
  try {
    const { data, error } = await db.from('treatment_proposals')
      .select(`${PROPOSAL_COLUMNS}, status`)
      .eq('proposal_id', input.proposalId)
      .maybeSingle()
    const p = data as (ProposalRow & { status: string }) | null
    if (error || !p || p.status !== 'chosen') {
      if (error) console.error('[proposal-queue] proposal could not be read for the notification:', error.message)
      return false
    }
    const [plan] = (await plansFor(db, p.clinic_id, [p])) ?? []
    if (!plan) return false
    const message = `${choiceSummary(plan)}. Review and sign it from the dashboard. Plan ${p.proposal_id.slice(0, 8)}, choice ${plan.choiceNo ?? 0}.`
    const { data: existing, error: existingError } = await db.from('clinic_notifications')
      .select('notification_id')
      .eq('clinic_id', p.clinic_id)
      .eq('notification_type', 'general')
      .eq('message', message)
      .maybeSingle()
    if (existingError) {
      console.error('[proposal-queue] notifications could not be read:', existingError.message)
      return false
    }
    if (existing) return false
    const { error: insertError } = await db.from('clinic_notifications').insert({
      clinic_id: p.clinic_id, order_id: plan.chosenOrderIds[0] ?? null, notification_type: 'general', message,
    })
    if (insertError) {
      console.error('[proposal-queue] notification not written:', insertError.message)
      return false
    }
    return true
  } catch (err) {
    console.error('[proposal-queue] notification failed:', err instanceof Error ? err.message : err)
    return false
  }
}
