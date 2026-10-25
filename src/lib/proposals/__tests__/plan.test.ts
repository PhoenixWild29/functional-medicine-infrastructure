/**
 * @jest-environment node
 *
 * Patient protocol choice PR 3: the server side of the plan page
 * (lib/proposals/plan). Service role, always scoped to the proposal's
 * clinic.
 *   - resolvePlan: the token states (open, not_found, expired, locked,
 *     signed, closed) and "unavailable" on a database error.
 *   - verifyPlanDob: the patient's date of birth; a wrong one counts
 *     (dob_failed event) and the 5th locks the link (locked_at, locked
 *     event). The first right one records "viewed" once.
 *   - loadPlan: the options with their DRAFT items (name, form, strength,
 *     sig, quantity, days, price, required). No wholesale cost, no clinic
 *     or pharmacy name in it.
 *   - quotePlan: the total for a selection, computed on the server
 *     (subtotal + shipping once per pharmacy, computeBundleShipping).
 *   - choosePlan: required items cannot be dropped, one option's items
 *     only, at least one item; sent -> chosen (chosen event), chosen ->
 *     chosen (rechosen); the kept items are written as proposal_choice_items
 *     under the next choice_no.
 *   - declinePlan: -> declined, declined event.
 *   - Nothing after signed, expired, declined or cancelled.
 */

import { scriptedDb, type ScriptedCall } from '@/__tests__/helpers/scripted-db'
import { hashProposalToken, newProposalToken } from '../token'
import { choosePlan, declinePlan, loadPlan, quotePlan, resolvePlan, verifyPlanDob, type PlanProposal } from '../plan'

const NOW = new Date('2026-10-24T12:00:00Z')
const TOKEN = newProposalToken()
const CLINIC = 'c0000000-0000-4000-8000-000000000001'
const PATIENT = 'a0000000-0000-4000-8000-000000000001'
const PROPOSAL = 'b0000000-0000-4000-8000-000000000001'
const OPT_A = 'd0000000-0000-4000-8000-00000000000a'
const OPT_B = 'd0000000-0000-4000-8000-00000000000b'
const PH1 = 'e0000000-0000-4000-8000-000000000001'
const O1 = 'f0000000-0000-4000-8000-000000000001' // A, required
const O2 = 'f0000000-0000-4000-8000-000000000002' // A, optional
const O3 = 'f0000000-0000-4000-8000-000000000003' // B, required

const PROPOSAL_ROW = {
  proposal_id: PROPOSAL, clinic_id: CLINIC, patient_id: PATIENT, status: 'sent', token_hash: hashProposalToken(TOKEN),
  expires_at: '2026-10-31T12:00:00Z', locked_at: null, dob_failures: 0, first_viewed_at: null, chosen_option_id: null,
}
const proposal = (over: Partial<PlanProposal> = {}): PlanProposal => ({ ...PROPOSAL_ROW, ...over } as PlanProposal)

const ORDERS = [
  { order_id: O1, proposal_option_id: OPT_A, proposal_required: true, status: 'DRAFT', pharmacy_id: PH1, shipping_type: 'standard',
    retail_price_snapshot: 200, wholesale_price_snapshot: 95, sig_text: 'Inject 0.25 mg once weekly', days_supply: 28,
    dispense_quantity: 1, dispense_unit: 'mL', package_label: '1 mL vial',
    medication_snapshot: { medication_name: 'Semaglutide', form: 'Injectable', dose: '2.5 mg/mL' } },
  { order_id: O2, proposal_option_id: OPT_A, proposal_required: false, status: 'DRAFT', pharmacy_id: PH1, shipping_type: 'standard',
    retail_price_snapshot: 60, wholesale_price_snapshot: 20, sig_text: 'Take 1 capsule daily', days_supply: 30,
    dispense_quantity: 30, dispense_unit: 'capsules', package_label: null,
    medication_snapshot: { medication_name: 'Vitamin D3', form: 'Capsule', dose: '5000 IU' } },
  { order_id: O3, proposal_option_id: OPT_B, proposal_required: true, status: 'DRAFT', pharmacy_id: PH1, shipping_type: 'standard',
    retail_price_snapshot: 150, wholesale_price_snapshot: 70, sig_text: 'Inject 10 units daily', days_supply: 30,
    dispense_quantity: 1, dispense_unit: 'mL', package_label: '1 mL vial',
    medication_snapshot: { medication_name: 'Tirzepatide', form: 'Injectable', dose: '10 mg/mL' } },
]

function db(over: (c: ScriptedCall) => unknown = () => undefined) {
  return scriptedDb(c => {
    const o = over(c)
    if (o !== undefined) return o as never
    if (c.table === 'treatment_proposals' && c.op === 'select') return { data: PROPOSAL_ROW }
    if (c.table === 'treatment_proposals' && c.op === 'update') return { data: [{ proposal_id: PROPOSAL }] }
    if (c.table === 'clinics') return { data: { logo_url: 'https://cdn.example/logo.png', absorb_shipping: false } }
    if (c.table === 'patients') return { data: { date_of_birth: '1985-04-15' } }
    if (c.table === 'treatment_proposal_options') return { data: [{ option_id: OPT_A, label: 'Foundation plan', position: 0 }, { option_id: OPT_B, label: 'Weight focus', position: 1 }] }
    if (c.table === 'orders') return { data: ORDERS }
    if (c.table === 'pharmacies') return { data: [{ pharmacy_id: PH1, name: 'Strive', shipping_fee_standard: 15, shipping_fee_cold_chain: 30, free_shipping_threshold: null }] }
    if (c.table === 'proposal_choice_items' && c.op === 'select') return { data: [] }
    return undefined
  })
}
const events = (d: ReturnType<typeof scriptedDb>) => d.to('treatment_proposal_events', 'insert').map(c => c.payload as Record<string, unknown>)

describe('resolvePlan', () => {
  it('open: the proposal and the clinic logo only, looked up by the token hash', async () => {
    const d = db()
    const r = await resolvePlan(d.client as never, TOKEN, NOW)
    expect(r).toEqual({ state: 'open', proposal: expect.objectContaining({ proposal_id: PROPOSAL }), logoUrl: 'https://cdn.example/logo.png' })
    expect(d.to('treatment_proposals', 'select')[0]!.filters).toEqual(expect.objectContaining({ token_hash: hashProposalToken(TOKEN) }))
    expect(d.to('clinics', 'select')[0]!.filters).toEqual(expect.objectContaining({ clinic_id: CLINIC }))
  })

  it('a malformed token never reaches the database', async () => {
    const d = db()
    expect((await resolvePlan(d.client as never, 'nope', NOW)).state).toBe('not_found')
    expect(d.calls).toHaveLength(0)
  })

  it.each([
    ['no row', null, 'not_found'],
    ['draft', { ...PROPOSAL_ROW, status: 'draft' }, 'not_found'],
    ['expired', { ...PROPOSAL_ROW, expires_at: '2026-10-24T11:59:59Z' }, 'expired'],
    ['locked', { ...PROPOSAL_ROW, locked_at: '2026-10-24T11:00:00Z' }, 'locked'],
    ['signed', { ...PROPOSAL_ROW, status: 'signed' }, 'signed'],
    ['declined', { ...PROPOSAL_ROW, status: 'declined' }, 'closed'],
    ['cancelled', { ...PROPOSAL_ROW, status: 'cancelled' }, 'closed'],
    ['chosen (can still change)', { ...PROPOSAL_ROW, status: 'chosen', chosen_option_id: OPT_A }, 'open'],
  ])('%s: %s', async (_name, row, state) => {
    const d = db(c => (c.table === 'treatment_proposals' ? { data: row } : undefined))
    expect((await resolvePlan(d.client as never, TOKEN, NOW)).state).toBe(state)
  })

  it('a database error is "unavailable", never "expired"', async () => {
    const d = db(c => (c.table === 'treatment_proposals' ? { error: { message: 'down' } } : undefined))
    expect((await resolvePlan(d.client as never, TOKEN, NOW)).state).toBe('unavailable')
  })
})

describe('verifyPlanDob', () => {
  it('the right date: ok, and the first time records viewed once', async () => {
    const d = db()
    expect(await verifyPlanDob(d.client as never, proposal(), '1985-04-15', NOW)).toEqual({ ok: true })
    expect(d.to('patients', 'select')[0]!.filters).toEqual(expect.objectContaining({ patient_id: PATIENT, clinic_id: CLINIC }))
    expect(events(d)).toEqual([expect.objectContaining({ proposal_id: PROPOSAL, event: 'viewed', actor: 'patient' })])
    const d2 = db()
    await verifyPlanDob(d2.client as never, proposal({ first_viewed_at: '2026-10-24T10:00:00Z' }), '1985-04-15', NOW)
    expect(events(d2)).toEqual([])
  })

  it('a wrong date counts: dob_failed, and says how many tries are left', async () => {
    const d = db()
    expect(await verifyPlanDob(d.client as never, proposal({ dob_failures: 1 }), '1985-04-16', NOW)).toEqual({ ok: false, reason: 'wrong', remaining: 3 })
    const upd = d.to('treatment_proposals', 'update')[0]!
    expect(upd.payload).toEqual(expect.objectContaining({ dob_failures: 2 }))
    expect(upd.payload).not.toHaveProperty('locked_at')
    expect(upd.filters).toEqual(expect.objectContaining({ proposal_id: PROPOSAL, dob_failures: 1 }))
    expect(events(d)).toEqual([expect.objectContaining({ event: 'dob_failed', actor: 'patient' })])
  })

  it('the 5th wrong date locks the link', async () => {
    const d = db()
    expect(await verifyPlanDob(d.client as never, proposal({ dob_failures: 4 }), '2000-01-01', NOW)).toEqual({ ok: false, reason: 'locked' })
    expect(d.to('treatment_proposals', 'update')[0]!.payload).toEqual(expect.objectContaining({ dob_failures: 5, locked_at: NOW.toISOString() }))
    expect(events(d).map(e => e['event'])).toEqual(['dob_failed', 'locked'])
  })

  it('a malformed date is a wrong one (counted), never a crash', async () => {
    const d = db()
    expect(await verifyPlanDob(d.client as never, proposal(), '15/04/1985', NOW)).toEqual({ ok: false, reason: 'wrong', remaining: 4 })
  })

  it('a database error is "unavailable" and counts nothing', async () => {
    const d = db(c => (c.table === 'patients' ? { error: { message: 'down' } } : undefined))
    expect(await verifyPlanDob(d.client as never, proposal(), '1985-04-15', NOW)).toEqual({ ok: false, reason: 'unavailable' })
    expect(d.to('treatment_proposals', 'update')).toHaveLength(0)
  })
})

describe('loadPlan', () => {
  it('the options and their items, in order; no wholesale cost, no clinic or pharmacy name', async () => {
    const d = db()
    const plan = await loadPlan(d.client as never, proposal())
    expect(plan).not.toBeNull()
    expect(plan!.options.map(o => [o.optionId, o.label])).toEqual([[OPT_A, 'Foundation plan'], [OPT_B, 'Weight focus']])
    expect(plan!.options[0]!.items).toEqual([
      { orderId: O1, medicationName: 'Semaglutide', form: 'Injectable', strength: '2.5 mg/mL', sig: 'Inject 0.25 mg once weekly', quantity: '1 mL vial', daysSupply: 28, priceCents: 20000, required: true },
      { orderId: O2, medicationName: 'Vitamin D3', form: 'Capsule', strength: '5000 IU', sig: 'Take 1 capsule daily', quantity: '30 capsules', daysSupply: 30, priceCents: 6000, required: false },
    ])
    const text = JSON.stringify(plan)
    for (const leak of ['wholesale', '9500', 'Strive', 'pharmacy']) expect(text).not.toContain(leak)
    expect(d.to('orders', 'select')[0]!.filters).toEqual(expect.objectContaining({ clinic_id: CLINIC, status: 'DRAFT', 'proposal_option_id:in': [OPT_A, OPT_B] }))
    expect(plan!.chosen).toBeNull()
    expect(plan!.quote).toEqual({ optionId: OPT_A, subtotalCents: 26000, shippingCents: 1500, totalCents: 27500 })
  })

  it('a chosen proposal carries the latest choice', async () => {
    const d = db(c => (c.table === 'proposal_choice_items' && c.op === 'select'
      ? { data: [{ option_id: OPT_A, order_id: O1, choice_no: 2 }, { option_id: OPT_A, order_id: O2, choice_no: 1 }, { option_id: OPT_A, order_id: O1, choice_no: 1 }] }
      : undefined))
    const plan = await loadPlan(d.client as never, proposal({ status: 'chosen', chosen_option_id: OPT_A }))
    expect(plan!.chosen).toEqual({ optionId: OPT_A, orderIds: [O1] })
  })
})

describe('quotePlan', () => {
  it('subtotal + shipping once per pharmacy, from the database prices', async () => {
    const d = db()
    expect(await quotePlan(d.client as never, proposal(), { optionId: OPT_A, orderIds: [O1] })).toEqual({ ok: true, quote: { optionId: OPT_A, subtotalCents: 20000, shippingCents: 1500, totalCents: 21500 } })
  })

  it('the clinic pays shipping: the patient total has none', async () => {
    const d = db(c => (c.table === 'clinics' ? { data: { logo_url: null, absorb_shipping: true } } : undefined))
    const r = await quotePlan(d.client as never, proposal(), { optionId: OPT_A, orderIds: [O1, O2] })
    expect(r).toEqual({ ok: true, quote: { optionId: OPT_A, subtotalCents: 26000, shippingCents: 0, totalCents: 26000 } })
  })
})

describe('choosePlan', () => {
  it('sent -> chosen: the kept items under choice 1, a chosen event with the option and the count', async () => {
    const d = db()
    expect(await choosePlan(d.client as never, proposal(), { optionId: OPT_A, orderIds: [O1] }, NOW)).toEqual({ ok: true, rechosen: false })
    const upd = d.to('treatment_proposals', 'update')[0]!
    expect(upd.payload).toEqual(expect.objectContaining({ status: 'chosen', chosen_option_id: OPT_A, chosen_at: NOW.toISOString() }))
    expect(upd.filters).toEqual(expect.objectContaining({ proposal_id: PROPOSAL, clinic_id: CLINIC, 'status:in': ['sent', 'chosen'] }))
    expect(d.to('proposal_choice_items', 'insert')[0]!.payload).toEqual([{ proposal_id: PROPOSAL, option_id: OPT_A, order_id: O1, choice_no: 1 }])
    expect(events(d)).toEqual([expect.objectContaining({ event: 'chosen', actor: 'patient', option_id: OPT_A, item_count: 1 })])
  })

  it('chosen -> chosen again: rechosen, the next choice_no', async () => {
    const d = db(c => (c.table === 'proposal_choice_items' && c.op === 'select' ? { data: [{ choice_no: 1 }] } : undefined))
    expect(await choosePlan(d.client as never, proposal({ status: 'chosen', chosen_option_id: OPT_A }), { optionId: OPT_B, orderIds: [O3] }, NOW)).toEqual({ ok: true, rechosen: true })
    expect(d.to('proposal_choice_items', 'insert')[0]!.payload).toEqual([{ proposal_id: PROPOSAL, option_id: OPT_B, order_id: O3, choice_no: 2 }])
    expect(events(d)[0]).toEqual(expect.objectContaining({ event: 'rechosen', option_id: OPT_B }))
  })

  it.each([
    ['a required item dropped', { optionId: OPT_A, orderIds: [O2] }, 'required'],
    ['an item from another option', { optionId: OPT_A, orderIds: [O1, O3] }, 'option'],
    ['an unknown option', { optionId: 'd0000000-0000-4000-8000-00000000000c', orderIds: [O1] }, 'option'],
    ['nothing kept', { optionId: OPT_A, orderIds: [] }, 'empty'],
    ['the same item twice', { optionId: OPT_A, orderIds: [O1, O1] }, 'option'],
  ])('refused, nothing written: %s', async (_n, choice, code) => {
    const d = db()
    const r = await choosePlan(d.client as never, proposal(), choice, NOW)
    expect(r).toEqual(expect.objectContaining({ ok: false, status: 400, code }))
    expect(d.to('treatment_proposals', 'update')).toHaveLength(0)
    expect(d.to('proposal_choice_items', 'insert')).toHaveLength(0)
  })

  it('the proposal moved on meanwhile (signed): 409, nothing written', async () => {
    const d = db(c => (c.table === 'treatment_proposals' && c.op === 'update' ? { data: [] } : undefined))
    const r = await choosePlan(d.client as never, proposal(), { optionId: OPT_A, orderIds: [O1] }, NOW)
    expect(r).toEqual(expect.objectContaining({ ok: false, status: 409 }))
    expect(d.to('proposal_choice_items', 'insert')).toHaveLength(0)
  })

  it.each(['signed', 'declined', 'expired', 'cancelled', 'draft'] as const)('nothing after %s', async status => {
    const d = db()
    expect(await choosePlan(d.client as never, proposal({ status }), { optionId: OPT_A, orderIds: [O1] }, NOW)).toEqual(expect.objectContaining({ ok: false, status: 409 }))
    expect(d.calls.filter(c => c.op !== 'select')).toHaveLength(0)
  })
})

describe('declinePlan', () => {
  it('sent or chosen -> declined, with a declined event', async () => {
    const d = db()
    expect(await declinePlan(d.client as never, proposal(), NOW)).toEqual({ ok: true })
    expect(d.to('treatment_proposals', 'update')[0]!.payload).toEqual(expect.objectContaining({ status: 'declined', declined_at: NOW.toISOString() }))
    expect(events(d)).toEqual([expect.objectContaining({ event: 'declined', actor: 'patient' })])
  })

  it.each(['signed', 'declined', 'expired', 'cancelled'] as const)('nothing after %s', async status => {
    const d = db()
    expect(await declinePlan(d.client as never, proposal({ status }), NOW)).toEqual(expect.objectContaining({ ok: false, status: 409 }))
    expect(d.calls.filter(c => c.op !== 'select')).toHaveLength(0)
  })
})
