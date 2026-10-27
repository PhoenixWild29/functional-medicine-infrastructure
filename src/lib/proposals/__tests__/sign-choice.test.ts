/**
 * @jest-environment node
 *
 * Patient protocol choice, PR 4: the provider signs what the patient chose.
 *
 * The patient chose an option and kept some of its optional items (PR 3
 * writes treatment_proposals.chosen_option_id and proposal_choice_items;
 * here they are seeded, as PR 1's tables). Signing goes through the
 * existing batch sign with exactly the chosen order ids: the option's
 * required lines plus the optional ones kept in the latest choice. Batch
 * sign runs every check again, allocates shipping, makes the payment group
 * (2+) or the solo checkout and sends the payment link, as today.
 *
 * Then, and only then: every other line of the proposal goes
 * DRAFT -> CANCELLED (never signed), the proposal is signed, its link
 * dies, 'signed' is recorded, and the chosen protocol lines start or
 * advance their protocol instance (decision 8). A check that fails at
 * sign stops the whole choice: nothing is signed or cancelled, and the
 * proposal stays chosen.
 */

import { CHEN, CLINIC, P1, PATEL, USER_ADMIN, USER_CHEN, USER_MA, draft, id, world, type World } from './world'
import { hashProposalToken, newProposalToken } from '../token'

const todayCents = new Map<string, number>()
const resolveLineMock = jest.fn()
jest.mock('@/lib/orders/resolve-line', () => ({ resolveLine: (...a: unknown[]) => resolveLineMock(...a) }))
const applyBundleShippingMock = jest.fn()
jest.mock('@/lib/orders/apply-bundle-shipping', () => ({ applyBundleShipping: (...a: unknown[]) => applyBundleShippingMock(...a) }))
const createPaymentGroupMock = jest.fn()
jest.mock('@/lib/payment-group/create-group', () => ({
  createPaymentGroup: (...a: unknown[]) => createPaymentGroupMock(...a),
  cancelPaymentGroup: jest.fn(async () => undefined),
}))
jest.mock('@/lib/auth/checkout-token', () => ({
  generateCheckoutToken:      jest.fn(async (orderId: string) => `solo-${orderId}`),
  generateGroupCheckoutToken: jest.fn(async (groupId: string) => `group-${groupId}`),
}))
const paymentSmsMock = jest.fn()
jest.mock('@/lib/sms/triggers', () => ({ sendPaymentLinkSms: (...a: unknown[]) => paymentSmsMock(...a) }))
jest.mock('@/lib/sla/creator', () => ({ createSlasForTransition: jest.fn(async () => undefined) }))
const historyMock = jest.fn()
jest.mock('@/lib/orders/status-history', () => ({ insertStatusHistory: (...a: unknown[]) => historyMock(...a) }))
jest.mock('@/lib/env', () => ({ serverEnv: { ...jest.requireActual('@/lib/env').serverEnv, appBaseUrl: () => 'https://app.test/' } }))
const linkageMock = jest.fn()
jest.mock('@/lib/protocols/resolve-instance', () => ({ resolveProtocolLinkage: (...a: unknown[]) => linkageMock(...a) }))
// The real batch sign, watched: signing goes through it and nothing else.
jest.mock('@/lib/orders/batch-sign', () => {
  const actual = jest.requireActual('@/lib/orders/batch-sign')
  return { ...actual, signBatch: jest.fn(actual.signBatch) }
})

import { signBatch } from '@/lib/orders/batch-sign'
import { signChosenProposal } from '../sign-choice'

const NOW = new Date('2026-10-26T15:00:00.000Z')
const SIGNATURE = {
  dataUrl:  'data:image/png;base64,SIG',
  strokes:  [[{ x: 10, y: 10 }, { x: 150, y: 12 }], [{ x: 20, y: 40 }, { x: 140, y: 42 }], [{ x: 30, y: 70 }, { x: 160, y: 72 }]],
  padWidth: 300,
}
const PROPOSAL = 'b0000000-0000-4000-8000-000000000001'
const OPT_A = 'opt-a'
const OPT_B = 'opt-b'
const TOKEN = newProposalToken()

/**
 * Option A "Foundation plan" (protocol proto-1): 1 required, 2 and 3
 * optional. Option B "Lean start": 4 required. The patient chose A,
 * then changed their mind: choice 1 kept 2, choice 2 kept 3 only.
 * Chosen: 1 and 3. Not chosen: 2 and 4.
 */
function chosenWorld(over: { proposal?: Record<string, unknown>; choiceItems?: Array<Record<string, unknown>>; orders?: Array<Record<string, unknown>>; tables?: Parameters<typeof world>[1] } = {}): World {
  const orders = over.orders ?? [
    draft(1, { proposal_option_id: OPT_A, proposal_required: true }),
    draft(2, { proposal_option_id: OPT_A, proposal_required: false }),
    draft(3, { proposal_option_id: OPT_A, proposal_required: false }),
    draft(4, { proposal_option_id: OPT_B, proposal_required: true }),
  ]
  return world(orders, {
    treatment_proposals: [{
      proposal_id: PROPOSAL, clinic_id: CLINIC, patient_id: P1, provider_id: CHEN, created_by: USER_CHEN,
      status: 'chosen', token_hash: hashProposalToken(TOKEN), sent_at: '2026-10-24T15:00:00.000Z', expires_at: '2026-10-31T15:00:00.000Z',
      chosen_option_id: OPT_A, chosen_at: '2026-10-25T15:00:00.000Z', signed_at: null, dob_failures: 0, locked_at: null,
      ...over.proposal,
    }],
    treatment_proposal_options: [
      { option_id: OPT_A, proposal_id: PROPOSAL, label: 'Foundation plan', position: 1, protocol_id: 'proto-1' },
      { option_id: OPT_B, proposal_id: PROPOSAL, label: 'Lean start', position: 2, protocol_id: null },
    ],
    proposal_choice_items: over.choiceItems ?? [
      { choice_item_id: 'c1', proposal_id: PROPOSAL, option_id: OPT_A, order_id: id(2), choice_no: 1 },
      { choice_item_id: 'c2', proposal_id: PROPOSAL, option_id: OPT_A, order_id: id(3), choice_no: 2 },
    ],
    ...over.tables,
  })
}

const sign = (db: World, caller: { userId: string; role: string } = { userId: USER_CHEN, role: 'provider' }, proposalId = PROPOSAL) =>
  signChosenProposal(db.client, { clinicId: CLINIC, userId: caller.userId, appRole: caller.role, proposalId, signature: SIGNATURE, now: NOW })

const row = (db: World, n: number) => db.tables['orders']!.find(o => o['order_id'] === id(n))!
const proposal = (db: World) => db.tables['treatment_proposals']![0]!
const events = (db: World) => db.tables['treatment_proposal_events']!.map(e => e['event'])
const signedIds = (db: World) => db.tables['orders']!.filter(o => o['status'] === 'AWAITING_PAYMENT').map(o => o['order_id'])

beforeEach(() => {
  process.env['PHASE_C_GROUPS_ENABLED'] = 'true'
  todayCents.clear()
  resolveLineMock.mockReset().mockImplementation(async (_db: unknown, input: { formulationId: string; pharmacyId: string }) =>
    ({ ok: true, wholesaleCents: todayCents.get(`${input.formulationId}|${input.pharmacyId}`) ?? 10000 }))
  applyBundleShippingMock.mockReset().mockResolvedValue({ ok: true, shipping: { totalCents: 900, byPharmacy: [] }, feesByOrder: {} })
  createPaymentGroupMock.mockReset().mockResolvedValue({ ok: true, groupId: 'g-1', stripePaymentIntentId: 'pi_1', totalCents: 1, orderCount: 2, patientId: P1, providerId: CHEN })
  paymentSmsMock.mockReset().mockResolvedValue({ ok: true })
  historyMock.mockReset().mockResolvedValue(true)
  linkageMock.mockReset().mockResolvedValue({ protocolInstanceId: 'inst-1', protocolVersionId: 'ver-1' })
  ;(signBatch as jest.Mock).mockClear()
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'info').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => { jest.restoreAllMocks() })

describe('signing the choice', () => {
  it('batch sign is called with exactly the chosen ids: the required lines and the optional ones kept last', async () => {
    const db = chosenWorld()
    const res = await sign(db)
    expect(res).toMatchObject({ ok: true, signedOrderIds: [id(1), id(3)], cancelledOrderIds: [id(2), id(4)] })
    expect(signBatch).toHaveBeenCalledTimes(1)
    expect(signBatch).toHaveBeenCalledWith(db.client, expect.objectContaining({
      clinicId: CLINIC, userId: USER_CHEN, appRole: 'provider', orderIds: [id(1), id(3)], signature: SIGNATURE,
    }))
    expect(signedIds(db)).toEqual([id(1), id(3)])
  })

  it('the lines not chosen are cancelled and never get a signature', async () => {
    const db = chosenWorld()
    await sign(db)
    for (const n of [2, 4]) {
      expect(row(db, n)['status']).toBe('CANCELLED')
      expect(row(db, n)['provider_signature_hash_snapshot']).toBeUndefined()
      expect(row(db, n)['locked_at']).toBeUndefined()
    }
    // Each unchosen line went through casTransition as the signer (B-2026-10-25-08).
    for (const n of [2, 4]) {
      expect(historyMock).toHaveBeenCalledWith(expect.anything(),
        expect.objectContaining({ order_id: id(n), old_status: 'DRAFT', new_status: 'CANCELLED', changed_by: USER_CHEN, metadata: expect.objectContaining({ reason: 'proposal_not_chosen' }) }),
        'casTransition')
    }
  })

  it('the proposal is signed, its link dies, and signed is recorded with the count', async () => {
    const db = chosenWorld()
    await sign(db)
    // PR 5: the hash is kept, so the plan link shows "Your provider has approved
    // your plan" (PR 3 looks the proposal up by it); the signed status alone
    // closes the plan.
    expect(proposal(db)).toMatchObject({ status: 'signed', signed_at: NOW.toISOString(), token_hash: hashProposalToken(TOKEN) })
    expect(events(db)).toEqual(['signed'])
    expect(db.tables['treatment_proposal_events']![0]).toMatchObject({ actor: 'provider', actor_user_id: USER_CHEN, option_id: OPT_A, item_count: 2 })
  })

  it('2+ chosen lines: one payment group; one chosen line: the solo checkout', async () => {
    const db = chosenWorld()
    await sign(db)
    expect(createPaymentGroupMock).toHaveBeenCalledTimes(1)

    const solo = chosenWorld({ choiceItems: [] })
    const res = await sign(solo)
    expect(res).toMatchObject({ ok: true, signedOrderIds: [id(1)], cancelledOrderIds: [id(2), id(3), id(4)] })
    expect(createPaymentGroupMock).toHaveBeenCalledTimes(1)
    expect(paymentSmsMock).toHaveBeenCalled()
  })

  it('choice items outside the chosen option are never signed', async () => {
    const db = chosenWorld({ choiceItems: [{ choice_item_id: 'c1', proposal_id: PROPOSAL, option_id: OPT_B, order_id: id(4), choice_no: 1 }] })
    await sign(db)
    expect((signBatch as jest.Mock).mock.calls[0]![1].orderIds).toEqual([id(1)])
  })

  it('protocol instances start at signing, for the chosen protocol lines only', async () => {
    const db = chosenWorld()
    await sign(db)
    expect(linkageMock).toHaveBeenCalledTimes(1)
    expect(linkageMock).toHaveBeenCalledWith(expect.objectContaining({ protocolId: 'proto-1', patientId: P1, providerId: CHEN, clinicId: CLINIC }))
    for (const n of [1, 3]) expect(row(db, n)).toMatchObject({ protocol_instance_id: 'inst-1', protocol_version_id: 'ver-1' })
    for (const n of [2, 4]) expect(row(db, n)['protocol_instance_id']).toBeUndefined()
  })
})

describe('a check that fails at sign stops the whole choice', () => {
  it.each([
    ['the price moved', (): void => { todayCents.set('f-plain|ph-strive', 12000) }, undefined, undefined],
    ['the license lapsed', (): void => undefined, { provider_state_licenses: [{ provider_id: CHEN, state: 'TX', license_number: 'TX-MD-001234', expires_on: '2026-01-31' }] }, undefined],
    ['the compounding status changed', (): void => undefined, undefined, { formulation_id: 'f-cat2' }],
  ] as const)('%s: nothing signed or cancelled, the proposal stays chosen, the reason is given', async (_name, before, tables, line1) => {
    before()
    const db = chosenWorld({
      tables: tables as Parameters<typeof world>[1],
      ...(line1 ? { orders: [
        draft(1, { proposal_option_id: OPT_A, proposal_required: true, ...line1 }),
        draft(2, { proposal_option_id: OPT_A, proposal_required: false }),
        draft(3, { proposal_option_id: OPT_A, proposal_required: false }),
        draft(4, { proposal_option_id: OPT_B, proposal_required: true }),
      ] } : {}),
    })
    const res = await sign(db)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.problems!.length).toBeGreaterThan(0)
    expect(res.error).toMatch(/Nothing was signed/)
    expect(signedIds(db)).toEqual([])
    expect([1, 2, 3, 4].map(n => row(db, n)['status'])).toEqual(['DRAFT', 'DRAFT', 'DRAFT', 'DRAFT'])
    expect(proposal(db)).toMatchObject({ status: 'chosen', signed_at: null })
    expect(proposal(db)['token_hash']).toBe(hashProposalToken(TOKEN))
    expect(events(db)).toEqual([])
    expect(linkageMock).not.toHaveBeenCalled()
  })
})

describe('who signs', () => {
  it('a medical assistant cannot', async () => {
    const db = chosenWorld()
    expect(await sign(db, { userId: USER_MA, role: 'medical_assistant' })).toMatchObject({ ok: false, status: 403 })
    expect(signedIds(db)).toEqual([])
    expect(proposal(db)['status']).toBe('chosen')
  })

  it("another provider cannot sign this provider's choice", async () => {
    const db = chosenWorld()
    expect(await sign(db, { userId: 'u-patel', role: 'provider' })).toMatchObject({ ok: false, status: 403 })
    expect(signedIds(db)).toEqual([])
    void PATEL
  })

  it('a clinic admin with no linked provider cannot sign', async () => {
    const db = chosenWorld()
    expect(await sign(db, { userId: USER_ADMIN, role: 'clinic_admin' })).toMatchObject({ ok: false, status: 403 })
  })

  it("a clinic admin signs only as their own linked, verified provider (a solo practice)", async () => {
    const db = chosenWorld({ tables: {
      providers: [{ provider_id: CHEN, user_id: USER_ADMIN, clinic_id: CLINIC, is_active: true, deleted_at: null, first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890' }],
    } })
    expect(await sign(db, { userId: USER_ADMIN, role: 'clinic_admin' })).toMatchObject({ ok: true, signedOrderIds: [id(1), id(3)] })
  })
})

describe('only a chosen proposal is signed', () => {
  it.each(['sent', 'signed', 'cancelled', 'expired', 'declined'])('%s: 409, nothing signed', async status => {
    const db = chosenWorld({ proposal: { status } })
    expect(await sign(db)).toMatchObject({ ok: false, status: 409 })
    expect(signBatch).not.toHaveBeenCalled()
  })

  it("another clinic's proposal, or none: 404", async () => {
    const db = chosenWorld()
    expect(await signChosenProposal(db.client, { clinicId: 'c-other', userId: USER_CHEN, appRole: 'provider', proposalId: PROPOSAL, signature: SIGNATURE, now: NOW })).toMatchObject({ ok: false, status: 404 })
    expect(await sign(db, undefined, 'b0000000-0000-4000-8000-00000000dead')).toMatchObject({ ok: false, status: 404 })
  })

  it('a chosen line that is no longer a draft: refused by batch sign, nothing cancelled', async () => {
    const db = chosenWorld({ orders: [
      draft(1, { proposal_option_id: OPT_A, proposal_required: true, status: 'CANCELLED' }),
      draft(2, { proposal_option_id: OPT_A, proposal_required: false }),
      draft(3, { proposal_option_id: OPT_A, proposal_required: false }),
      draft(4, { proposal_option_id: OPT_B, proposal_required: true }),
    ] })
    const res = await sign(db)
    expect(res.ok).toBe(false)
    expect(row(db, 4)['status']).toBe('DRAFT')
    expect(proposal(db)['status']).toBe('chosen')
  })
})

describe('L1: the sign rows are written before signing', () => {
  it('beforeWrite is passed to batch sign and called with the chosen lines and their patient', async () => {
    const db = chosenWorld()
    const beforeWrite = jest.fn(async () => true)
    const res = await signChosenProposal(db.client, { clinicId: CLINIC, userId: USER_CHEN, appRole: 'provider', proposalId: PROPOSAL, signature: SIGNATURE, now: NOW, beforeWrite })
    expect(res).toMatchObject({ ok: true })
    expect(beforeWrite).toHaveBeenCalledWith([{ orderId: id(1), patientId: P1 }, { orderId: id(3), patientId: P1 }])
  })

  it('a refused log: 503 with the standard message unchanged, nothing signed or cancelled, the plan stays chosen', async () => {
    const db = chosenWorld()
    const res = await signChosenProposal(db.client, { clinicId: CLINIC, userId: USER_CHEN, appRole: 'provider', proposalId: PROPOSAL, signature: SIGNATURE, now: NOW, beforeWrite: async () => false })
    expect(res).toEqual({ ok: false, status: 503, error: 'This change could not be recorded. Nothing was changed. Try again.' })
    expect(signedIds(db)).toEqual([])
    expect(row(db, 2)['status']).toBe('DRAFT')
    expect(proposal(db)['status']).toBe('chosen')
  })
})
