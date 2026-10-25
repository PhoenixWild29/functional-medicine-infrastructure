// ============================================================
// E2E fixtures: patient protocol choice (proposals)
// ============================================================
//
// Service-role setup and cleanup for e2e/patient-protocol-choice.spec.ts
// and the /plan states in e2e/accessibility.spec.ts.
//
// A proposal is never deleted (the migration revokes DELETE even from the
// service role, and it is never a retention target), so cleanup closes
// the test patient's open proposals (cancelled) and soft-deletes their
// orders with cleanupTestOrders(), as every other spec does.

import { createClient } from '@supabase/supabase-js'
import { hashProposalToken, newProposalToken } from '../../src/lib/proposals/token'
import { TEST_CATALOG, TEST_IDS } from './seed'

function service() {
  return createClient(process.env['E2E_SUPABASE_URL']!, process.env['E2E_SUPABASE_SERVICE_ROLE_KEY']!)
}

/** The E2E patient's date of birth (seed.ts). */
export const TEST_PATIENT_DOB = '1980-01-01'

export type SeededPlanState = 'open' | 'locked' | 'expired' | 'signed'

/**
 * A sent proposal for the E2E patient with one option ("Foundation plan")
 * of two DRAFT lines, one required and one optional. Returns the plan link
 * token (only its hash is stored).
 */
export async function seedProposal(state: SeededPlanState = 'open'): Promise<{ token: string; proposalId: string }> {
  const db = service()
  const token = newProposalToken()
  const now = Date.now()
  const { data: proposal, error } = await db.from('treatment_proposals').insert({
    clinic_id:    TEST_IDS.clinic,
    patient_id:   TEST_IDS.patient,
    provider_id:  TEST_IDS.provider,
    status:       'sent',
    token_hash:   hashProposalToken(token),
    sent_at:      new Date(now).toISOString(),
    expires_at:   new Date(state === 'expired' ? now - 60_000 : now + 7 * 24 * 3600_000).toISOString(),
    locked_at:    state === 'locked' ? new Date(now).toISOString() : null,
    dob_failures: state === 'locked' ? 5 : 0,
  }).select('proposal_id').single()
  if (error || !proposal) throw new Error(`seedProposal: ${error?.message}`)

  const { data: option, error: optionError } = await db.from('treatment_proposal_options')
    .insert({ proposal_id: proposal.proposal_id, label: 'Foundation plan', position: 0 })
    .select('option_id').single()
  if (optionError || !option) throw new Error(`seedProposal (option): ${optionError?.message}`)

  const line = (required: boolean, name: string, retail: number) => ({
    patient_id: TEST_IDS.patient, provider_id: TEST_IDS.provider, clinic_id: TEST_IDS.clinic,
    catalog_item_id: TEST_IDS.catalogItem, pharmacy_id: TEST_IDS.pharmacyTier1, status: 'DRAFT', quantity: 1,
    wholesale_price_snapshot: retail / 2, retail_price_snapshot: retail,
    // Every snapshot a real draft carries (POST /api/orders), so the line can be signed.
    provider_npi_snapshot: '1234567890', shipping_state_snapshot: 'TX',
    pharmacy_snapshot: { pharmacy_id: TEST_IDS.pharmacyTier1, name: 'Test Pharmacy Tier1', integration_tier: 'TIER_1_API', fax_number: null },
    sig_text: 'Inject 10 units under the skin once daily',
    medication_snapshot: { medication_name: name, form: 'Injectable', dose: '10 mg/mL' },
    proposal_option_id: option.option_id, proposal_required: required,
  })
  const { error: ordersError } = await db.from('orders').insert([
    line(true, TEST_CATALOG.formulationName, 200),
    line(false, 'Test Optional E2E Capsule', 60),
  ])
  if (ordersError) throw new Error(`seedProposal (orders): ${ordersError.message}`)

  if (state === 'signed') {
    const { error: signError } = await db.from('treatment_proposals')
      .update({ status: 'signed', chosen_option_id: option.option_id, chosen_at: new Date(now).toISOString(), signed_at: new Date(now).toISOString() })
      .eq('proposal_id', proposal.proposal_id)
    if (signError) throw new Error(`seedProposal (signed): ${signError.message}`)
  }
  return { token, proposalId: proposal.proposal_id }
}

/** Close the E2E patient's open proposals (never deleted). Pair with cleanupTestOrders(). */
export async function closeTestProposals(): Promise<void> {
  const { error } = await service().from('treatment_proposals')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
    .eq('clinic_id', TEST_IDS.clinic)
    .eq('patient_id', TEST_IDS.patient)
    .in('status', ['draft', 'sent', 'chosen'])
  if (error) throw new Error(`closeTestProposals: ${error.message}`)
}

/** The proposal's events, oldest first (event names only). */
export async function proposalEvents(proposalId: string): Promise<string[]> {
  const { data, error } = await service().from('treatment_proposal_events').select('event, created_at')
    .eq('proposal_id', proposalId).order('created_at', { ascending: true })
  if (error) throw new Error(`proposalEvents: ${error.message}`)
  return (data ?? []).map(r => r.event as string)
}

export async function proposalRow(proposalId: string) {
  const { data, error } = await service().from('treatment_proposals')
    .select('proposal_id, status, chosen_option_id, dob_failures, signed_at').eq('proposal_id', proposalId).single()
  if (error) throw new Error(`proposalRow: ${error.message}`)
  return data
}

/** The latest proposal for the E2E patient (the one the provider just sent). */
export async function latestTestProposal() {
  const { data, error } = await service().from('treatment_proposals').select('proposal_id, status')
    .eq('clinic_id', TEST_IDS.clinic).eq('patient_id', TEST_IDS.patient)
    .order('created_at', { ascending: false }).limit(1).single()
  if (error) throw new Error(`latestTestProposal: ${error.message}`)
  return data
}

/** The proposal's options and their DRAFT lines (option label → order ids and required flags). */
export async function proposalLines(proposalId: string) {
  const db = service()
  const { data: options, error } = await db.from('treatment_proposal_options').select('option_id, label, position').eq('proposal_id', proposalId).order('position')
  if (error) throw new Error(`proposalLines: ${error.message}`)
  const ids = (options ?? []).map(o => o.option_id)
  const { data: orders, error: ordersError } = await db.from('orders')
    .select('order_id, proposal_option_id, proposal_required, status, medication_snapshot')
    .in('proposal_option_id', ids)
  if (ordersError) throw new Error(`proposalLines (orders): ${ordersError.message}`)
  return (options ?? []).map(o => ({
    optionId: o.option_id as string,
    label:    o.label as string,
    lines:    (orders ?? []).filter(r => r.proposal_option_id === o.option_id).map(r => ({
      orderId:  r.order_id as string,
      required: r.proposal_required as boolean,
      status:   r.status as string,
      name:     ((r.medication_snapshot ?? {}) as { medication_name?: string }).medication_name ?? '',
    })),
  }))
}

/** The order ids the patient kept in their latest choice. */
export async function latestChoice(proposalId: string): Promise<string[]> {
  const { data, error } = await service().from('proposal_choice_items').select('order_id, choice_no').eq('proposal_id', proposalId)
  if (error) throw new Error(`latestChoice: ${error.message}`)
  const rows = data ?? []
  const last = Math.max(0, ...rows.map(r => r.choice_no as number))
  return rows.filter(r => r.choice_no === last).map(r => r.order_id as string)
}
