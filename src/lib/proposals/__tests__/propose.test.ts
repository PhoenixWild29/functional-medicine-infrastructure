/**
 * @jest-environment node
 *
 * Patient protocol choice, PR 2: the provider proposes.
 *
 * "Send to patient for choice" stores a proposal, its options and the
 * DRAFT lines tagged to them, and gives the provider the plan link. It
 * runs every signing check except the signature first
 * (canSign, the read-only half of batch sign), so the patient is never
 * offered something that could not be signed: each refusal is the one
 * sign gives, with the same words. Nothing is signed, grouped or charged.
 *
 * Who: the provider on the lines, or a clinic admin on their behalf. A
 * medical assistant may prepare the plan but not send it.
 *
 * The link does not depend on texting. The text goes only when texting
 * is set up and the patient opted in; otherwise the provider copies the
 * link or shows the QR code, and each delivery is recorded.
 */

import { CALLERS, CHEN, CLINIC, P2, PATEL, USER_CHEN, draft, id, oneOption, world, type World } from './world'
import { checkBatch } from '@/lib/orders/batch-sign'
import { hashProposalToken, proposalLinkState, PROPOSAL_LINK_TTL_DAYS } from '../token'
import { cancelProposal, createProposal, recordLinkDelivery, revokeProposalLinkForOrder, sendProposal } from '../propose'

const todayCents = new Map<string, number>()
const resolveLineMock = jest.fn()
jest.mock('@/lib/orders/resolve-line', () => ({ resolveLine: (...a: unknown[]) => resolveLineMock(...a) }))
const historyMock = jest.fn()
jest.mock('@/lib/orders/status-history', () => ({ insertStatusHistory: (...a: unknown[]) => historyMock(...a) }))
jest.mock('@/lib/env', () => ({ serverEnv: { appBaseUrl: () => 'https://app.test/' } }))
const twilioCreate = jest.fn()
jest.mock('@/lib/twilio/client', () => ({ createTwilioClient: () => ({ messages: { create: (p: unknown) => twilioCreate(p) } }) }))

const NOW = new Date('2026-10-24T16:00:00.000Z')

function textingOn() {
  process.env['TWILIO_ACCOUNT_SID'] = 'AC1'
  process.env['TWILIO_AUTH_TOKEN'] = 'tok'
  process.env['TWILIO_PHONE_NUMBER'] = '+15005550006'
  delete process.env['TWILIO_ENABLED']
}
function textingOff() {
  for (const k of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER', 'TWILIO_ENABLED']) delete process.env[k]
}

beforeEach(() => {
  textingOff()
  todayCents.clear()
  resolveLineMock.mockReset().mockImplementation(async (_db: unknown, input: { formulationId: string; pharmacyId: string }) =>
    ({ ok: true, wholesaleCents: todayCents.get(`${input.formulationId}|${input.pharmacyId}`) ?? 10000 }))
  historyMock.mockReset().mockResolvedValue(true)
  twilioCreate.mockReset().mockResolvedValue({ sid: 'SM1' })
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'info').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => { jest.restoreAllMocks(); textingOff() })

const propose = (db: World, input: unknown, caller: { userId: string; role: string } = CALLERS.chen) =>
  createProposal(db.client, { clinicId: CLINIC, caller, input, now: NOW })

const tokenOf = (url: string) => url.split('/plan/')[1]!
const proposals = (db: World) => db.tables['treatment_proposals']!
const events = (db: World) => db.tables['treatment_proposal_events']!.map(e => e['event'])
const order = (db: World, n: number) => db.tables['orders']!.find(o => o['order_id'] === id(n))!

// ── Every signing refusal blocks propose, in sign's words ──────────────

type Setup = { orders: Array<Record<string, unknown>>; over?: Parameters<typeof world>[1]; clinic?: Record<string, unknown>; before?: () => void }
const REFUSALS: Array<[string, Setup]> = [
  ['C4: the provider NPI is not verified', { orders: [draft(1)], over: { provider_npi_verifications: [{ provider_id: CHEN, npi: '1234567890', status: 'not_found' }] } }],
  ['C4: no license in the patient state', { orders: [draft(1, { shipping_state_snapshot: 'FL' })] }],
  ['C4: the license has expired', { orders: [draft(1)], over: { provider_state_licenses: [{ provider_id: CHEN, state: 'TX', license_number: 'TX-MD-001234', expires_on: '2020-01-31' }] } }],
  ['C5: the pharmacy is not licensed in the state', { orders: [draft(1)], over: { pharmacy_state_licenses: [] } }],
  ['C5: a sterile product outside the license scope', { orders: [draft(1, { formulation_id: 'f-inj' })], over: { pharmacy_state_licenses: [{ pharmacy_id: 'ph-strive', state_code: 'TX', is_active: true, deleted_at: null, expiration_date: '2099-12-31', sterile_compounding: false }] } }],
  ['the pharmacy is inactive', { orders: [draft(1)], over: { pharmacies: [{ pharmacy_id: 'ph-strive', name: 'Strive', integration_tier: 'TIER_2_PORTAL', is_active: false, pharmacy_status: 'ACTIVE', deleted_at: null }] } }],
  ['C6: a controlled substance', { orders: [draft(1, { formulation_id: 'f-testo', medication_snapshot: { medication_name: 'Testosterone Cypionate', dea_schedule: 3 } })] }],
  ['C8: an ingredient that may not be compounded', { orders: [draft(1, { formulation_id: 'f-cat2' })] }],
  ['C8: an unverified compounding status', { orders: [draft(1, { formulation_id: 'f-nad' })] }],
  ['price: the pharmacy price moved', { orders: [draft(1)], before: () => todayCents.set('f-plain|ph-strive', 12000) }],
  ['price: below cost', { orders: [draft(1, { retail_price_snapshot: 50 })] }],
  ['price: no longer offered as saved', { orders: [draft(1)], before: () => resolveLineMock.mockResolvedValue({ ok: false, status: 404, error: 'package withdrawn' }) }],
  ['rule-required details are missing', { orders: [draft(1, { formulation_id: 'f-glp1' })] }],
  ['the patient has not finished intake', { orders: [draft(1, { patients: { intake_status: 'pending' } })] }],
  ['the clinic is not approved', { orders: [draft(1)], clinic: { onboarding_status: 'submitted' } }],
  ["the clinic's Stripe account is not active", { orders: [draft(1)], clinic: { stripe_connect_status: 'PENDING' } }],
]

describe('every refusal batch sign gives also blocks propose, with the same message', () => {
  it.each(REFUSALS)('%s', async (_name, setup) => {
    setup.before?.()
    const ids = setup.orders.map(o => o['order_id'] as string)
    const signCheck = await checkBatch(world(setup.orders, setup.over, setup.clinic).client, { clinicId: CLINIC, userId: USER_CHEN, orderIds: ids, atSigning: true })
    expect(signCheck.problems.length).toBeGreaterThan(0)

    const db = world(setup.orders, setup.over, setup.clinic)
    const res = await propose(db, oneOption(ids))
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.problems?.map(p => [p.code, p.message])).toEqual(signCheck.problems.map(p => [p.code, p.message]))
    // Nothing stored, nothing tagged.
    expect(proposals(db)).toHaveLength(0)
    expect(db.writes).toHaveLength(0)
  })

  it('a refusal also blocks preparing the plan (a medical assistant saves it for later)', async () => {
    const db = world([draft(1, { retail_price_snapshot: 50 })])
    const res = await propose(db, oneOption([id(1)], { send: false }), CALLERS.ma)
    expect(res).toMatchObject({ ok: false, problems: [expect.objectContaining({ code: 'below_cost' })] })
    expect(db.writes).toHaveLength(0)
  })
})

describe('a controlled item is never proposable', () => {
  it('one controlled line in any option refuses the whole proposal; nothing is tagged', async () => {
    const db = world([draft(1), draft(2, { formulation_id: 'f-testo', medication_snapshot: { medication_name: 'Testosterone Cypionate', dea_schedule: 3 } })])
    const res = await propose(db, {
      patientId: 'pat-1', providerId: CHEN, send: true,
      options: [
        { label: 'Option A', protocolId: null, lines: [{ orderId: id(1), required: true }] },
        { label: 'Option B', protocolId: null, lines: [{ orderId: id(2), required: false }] },
      ],
    })
    expect(res).toMatchObject({ ok: false, status: 422, problems: [expect.objectContaining({ orderId: id(2), code: 'controlled_substance' })] })
    expect(order(db, 2)['proposal_option_id']).toBeNull()
    expect(db.writes).toHaveLength(0)
  })

  it('a schedule that cannot be read is treated as controlled', async () => {
    const db = world([draft(1, { formulation_id: 'f-missing', medication_snapshot: { medication_name: 'Mystery' } })])
    const res = await propose(db, oneOption([id(1)]))
    expect(res.ok).toBe(false)
    expect(db.writes).toHaveLength(0)
  })
})

// ── Sending ─────────────────────────────────────────────────

describe('sending', () => {
  it('stores the proposal, its options and the tagged drafts, and returns the plan link', async () => {
    const db = world([draft(1), draft(2), draft(3)])
    const res = await propose(db, {
      patientId: 'pat-1', providerId: CHEN, send: true,
      options: [
        { label: '  Foundation plan ', protocolId: 'proto-1', lines: [{ orderId: id(1), required: true }, { orderId: id(2), required: false }] },
        { label: 'Lean start', protocolId: null, lines: [{ orderId: id(3), required: true }] },
      ],
    })
    expect(res).toMatchObject({ ok: true, status: 'sent' })
    if (!res.ok || !res.link) throw new Error('unreachable')
    expect(res.link.url).toMatch(/^https:\/\/app\.test\/plan\/[A-Za-z0-9_-]{43}$/)

    const [p] = proposals(db)
    expect(p).toMatchObject({ clinic_id: CLINIC, patient_id: 'pat-1', provider_id: CHEN, created_by: USER_CHEN, status: 'sent', sent_at: NOW.toISOString() })
    expect(p!['token_hash']).toBe(hashProposalToken(tokenOf(res.link.url)))
    expect(new Date(p!['expires_at'] as string).getTime() - NOW.getTime()).toBe(PROPOSAL_LINK_TTL_DAYS * 86_400_000)
    expect(res.link.expiresAt).toBe(p!['expires_at'])

    const options = db.tables['treatment_proposal_options']!
    expect(options.map(o => [o['label'], o['position'], o['protocol_id']])).toEqual([['Foundation plan', 1, 'proto-1'], ['Lean start', 2, null]])
    expect([1, 2, 3].map(n => [order(db, n)['proposal_option_id'], order(db, n)['proposal_required']])).toEqual([
      [options[0]!['option_id'], true], [options[0]!['option_id'], false], [options[1]!['option_id'], true],
    ])
    // Still drafts: nothing signed, grouped or charged.
    expect([1, 2, 3].map(n => order(db, n)['status'])).toEqual(['DRAFT', 'DRAFT', 'DRAFT'])
    expect(db.writesTo('orders', 'update').every(w => !('status' in (w.patch ?? {})) && !('locked_at' in (w.patch ?? {})))).toBe(true)
    expect(events(db)).toEqual(['created', 'sent'])
    expect(proposalLinkState(p as never, tokenOf(res.link.url), NOW)).toBe('open')
  })

  it('refuses a label over 80 characters, an empty label, an empty option or a line twice', async () => {
    const db = world([draft(1), draft(2)])
    const bad = [
      oneOption([id(1)], { options: [{ label: 'x'.repeat(81), protocolId: null, lines: [{ orderId: id(1), required: true }] }] }),
      oneOption([id(1)], { options: [{ label: '   ', protocolId: null, lines: [{ orderId: id(1), required: true }] }] }),
      oneOption([id(1)], { options: [{ label: 'A', protocolId: null, lines: [] }] }),
      oneOption([id(1)], { options: [
        { label: 'A', protocolId: null, lines: [{ orderId: id(1), required: true }] },
        { label: 'B', protocolId: null, lines: [{ orderId: id(1), required: false }] },
      ] }),
    ]
    for (const input of bad) {
      expect(await propose(db, input)).toMatchObject({ ok: false, status: 400 })
    }
    expect(db.writes).toHaveLength(0)
  })

  it("refuses another patient's line, a line not a draft, and a line already in a plan", async () => {
    const db = world([draft(1, { patient_id: P2 }), draft(2, { status: 'AWAITING_PAYMENT' }), draft(3, { proposal_option_id: 'opt-old', proposal_required: true })])
    expect(await propose(db, oneOption([id(1)]))).toMatchObject({ ok: false, status: 422 })
    expect(await propose(db, oneOption([id(2)]))).toMatchObject({ ok: false, status: 409 })
    expect(await propose(db, oneOption([id(3)]))).toMatchObject({ ok: false, status: 409 })
    expect(db.writes).toHaveLength(0)
  })
})

// ── Who may send ─────────────────────────────────────────────

describe('who may send', () => {
  it('the provider on the lines sends (actor provider)', async () => {
    const db = world([draft(1)])
    expect(await propose(db, oneOption([id(1)]))).toMatchObject({ ok: true, status: 'sent' })
    expect(db.tables['treatment_proposal_events']!.map(e => e['actor'])).toEqual(['provider', 'provider'])
  })

  it("a provider cannot send a plan of another provider's lines", async () => {
    const db = world([draft(1, { provider_id: PATEL })])
    expect(await propose(db, oneOption([id(1)], { providerId: PATEL }))).toMatchObject({ ok: false, status: 403 })
    expect(db.writes).toHaveLength(0)
  })

  it("a clinic admin sends on the provider's behalf; the checks are the provider's (C4)", async () => {
    const db = world([draft(1)])
    expect(await propose(db, oneOption([id(1)]), CALLERS.admin)).toMatchObject({ ok: true, status: 'sent' })
    expect(db.tables['treatment_proposal_events']!.map(e => [e['actor'], e['actor_user_id']])).toEqual([['clinic_staff', 'u-admin'], ['clinic_staff', 'u-admin']])

    const lapsed = world([draft(1)], { provider_state_licenses: [] })
    expect(await propose(lapsed, oneOption([id(1)]), CALLERS.admin)).toMatchObject({ ok: false, status: 403, problems: [expect.objectContaining({ code: 'prescriber_license_missing' })] })
  })

  it('a medical assistant prepares the plan (no link) but gets 403 on send', async () => {
    const db = world([draft(1)])
    expect(await propose(db, oneOption([id(1)]), CALLERS.ma)).toMatchObject({ ok: false, status: 403, code: 'MA_CANNOT_SEND' })
    expect(db.writes).toHaveLength(0)

    const prepared = await propose(db, oneOption([id(1)], { send: false }), CALLERS.ma)
    expect(prepared).toMatchObject({ ok: true, status: 'draft', link: null })
    if (!prepared.ok) throw new Error('unreachable')
    expect(proposals(db)[0]).toMatchObject({ status: 'draft', token_hash: null })
    expect(order(db, 1)['proposal_option_id']).toBeTruthy()

    expect(await sendProposal(db.client, { clinicId: CLINIC, caller: CALLERS.ma, proposalId: prepared.proposalId, now: NOW })).toMatchObject({ ok: false, status: 403, code: 'MA_CANNOT_SEND' })
    const sent = await sendProposal(db.client, { clinicId: CLINIC, caller: CALLERS.chen, proposalId: prepared.proposalId, now: NOW })
    expect(sent).toMatchObject({ ok: true, resent: false })
    expect(proposals(db)[0]!['status']).toBe('sent')
    expect(events(db)).toEqual(['created', 'sent'])
  })

  it.each(['ops_admin', 'pharmacy_admin', null])('%s cannot prepare or send', async role => {
    const db = world([draft(1)])
    for (const send of [true, false]) {
      expect(await propose(db, oneOption([id(1)], { send }), { userId: 'u-x', role: role as string })).toMatchObject({ ok: false, status: 403 })
    }
    expect(db.writes).toHaveLength(0)
  })
})

// ── Re-send, cancel, edit ────────────────────────────────────

async function sentProposal(db: World) {
  const res = await propose(db, oneOption([id(1), id(2)]))
  if (!res.ok || !res.link) throw new Error('setup failed')
  return { proposalId: res.proposalId, token: tokenOf(res.link.url) }
}
const current = (db: World) => proposals(db)[0]! as never

describe('re-send', () => {
  it('a new link replaces the old one: the old token no longer opens', async () => {
    const db = world([draft(1), draft(2)])
    const first = await sentProposal(db)
    const later = new Date(NOW.getTime() + 3_600_000)
    const res = await sendProposal(db.client, { clinicId: CLINIC, caller: CALLERS.chen, proposalId: first.proposalId, now: later })
    expect(res).toMatchObject({ ok: true, resent: true })
    if (!res.ok) throw new Error('unreachable')
    const second = tokenOf(res.link.url)
    expect(second).not.toBe(first.token)
    expect(proposalLinkState(current(db), first.token, later)).toBe('not_found')
    expect(proposalLinkState(current(db), second, later)).toBe('open')
    expect(proposals(db)[0]).toMatchObject({ status: 'sent', sent_at: later.toISOString() })
    expect(events(db)).toEqual(['created', 'sent', 'resent'])
  })

  it('re-send runs the checks again: a price that moved refuses it, and the old link stays as it was', async () => {
    const db = world([draft(1), draft(2)])
    const first = await sentProposal(db)
    todayCents.set('f-plain|ph-strive', 12000)
    const res = await sendProposal(db.client, { clinicId: CLINIC, caller: CALLERS.chen, proposalId: first.proposalId, now: NOW })
    expect(res).toMatchObject({ ok: false, problems: expect.arrayContaining([expect.objectContaining({ code: 'reprice' })]) })
    expect(proposalLinkState(current(db), first.token, NOW)).toBe('open')
  })
})

describe('cancel', () => {
  it('DRAFT → CANCELLED for every line, the proposal cancelled, the link revoked', async () => {
    const db = world([draft(1), draft(2)])
    const { proposalId, token } = await sentProposal(db)
    const res = await cancelProposal(db.client, { clinicId: CLINIC, caller: CALLERS.chen, proposalId, now: NOW })
    expect(res).toMatchObject({ ok: true, cancelledOrderIds: [id(1), id(2)] })
    expect([order(db, 1)['status'], order(db, 2)['status']]).toEqual(['CANCELLED', 'CANCELLED'])
    expect(proposals(db)[0]).toMatchObject({ status: 'cancelled', cancelled_at: NOW.toISOString(), token_hash: null })
    expect(proposalLinkState(current(db), token, NOW)).toBe('not_found')
    expect(events(db)).toEqual(['created', 'sent', 'cancelled'])
    expect(historyMock).toHaveBeenCalledWith(expect.anything(), [
      expect.objectContaining({ order_id: id(1), old_status: 'DRAFT', new_status: 'CANCELLED', changed_by: USER_CHEN }),
      expect.objectContaining({ order_id: id(2), old_status: 'DRAFT', new_status: 'CANCELLED', changed_by: USER_CHEN }),
    ], 'proposal-cancel')
  })

  it('a medical assistant cannot cancel; a cancelled proposal cannot be cancelled or sent again', async () => {
    const db = world([draft(1), draft(2)])
    const { proposalId } = await sentProposal(db)
    expect(await cancelProposal(db.client, { clinicId: CLINIC, caller: CALLERS.ma, proposalId, now: NOW })).toMatchObject({ ok: false, status: 403 })
    await cancelProposal(db.client, { clinicId: CLINIC, caller: CALLERS.admin, proposalId, now: NOW })
    expect(await cancelProposal(db.client, { clinicId: CLINIC, caller: CALLERS.chen, proposalId, now: NOW })).toMatchObject({ ok: false, status: 409 })
    expect(await sendProposal(db.client, { clinicId: CLINIC, caller: CALLERS.chen, proposalId, now: NOW })).toMatchObject({ ok: false, status: 409 })
  })

  it("another clinic's proposal is not found", async () => {
    const db = world([draft(1), draft(2)])
    const { proposalId } = await sentProposal(db)
    expect(await cancelProposal(db.client, { clinicId: 'c-other', caller: CALLERS.chen, proposalId, now: NOW })).toMatchObject({ ok: false, status: 404 })
  })
})

describe('edit', () => {
  it('editing a proposed line revokes its link (re-send makes a new one); other orders are untouched', async () => {
    const db = world([draft(1), draft(2), draft(9)])
    const { token } = await sentProposal(db)
    expect(await revokeProposalLinkForOrder(db.client, { clinicId: CLINIC, orderId: id(1) })).toBe(true)
    expect(proposalLinkState(current(db), token, NOW)).toBe('not_found')
    expect(proposals(db)[0]).toMatchObject({ status: 'sent', token_hash: null })
    expect(await revokeProposalLinkForOrder(db.client, { clinicId: CLINIC, orderId: id(9) })).toBe(false)
  })
})

// ── Delivery: copy, QR, text ─────────────────────────────────

describe('how the link reaches the patient', () => {
  it('Copy link and Show QR code are recorded as link_copied and qr_shown', async () => {
    const db = world([draft(1), draft(2)])
    const { proposalId } = await sentProposal(db)
    expect(await recordLinkDelivery(db.client, { clinicId: CLINIC, caller: CALLERS.chen, proposalId, delivery: 'copied' })).toEqual({ ok: true })
    expect(await recordLinkDelivery(db.client, { clinicId: CLINIC, caller: CALLERS.admin, proposalId, delivery: 'qr' })).toEqual({ ok: true })
    expect(events(db)).toEqual(['created', 'sent', 'link_copied', 'qr_shown'])
    expect(await recordLinkDelivery(db.client, { clinicId: CLINIC, caller: CALLERS.ma, proposalId, delivery: 'qr' })).toMatchObject({ ok: false, status: 403 })
    expect(await recordLinkDelivery(db.client, { clinicId: CLINIC, caller: CALLERS.chen, proposalId: 'nope', delivery: 'qr' })).toMatchObject({ ok: false, status: 404 })
  })

  it('texting off: no text is attempted, and the result says so', async () => {
    const db = world([draft(1)])
    const res = await propose(db, oneOption([id(1)]))
    expect(res).toMatchObject({ ok: true, link: { texting: 'texting_off' } })
    expect(twilioCreate).not.toHaveBeenCalled()
    expect(db.tables['sms_log']).toHaveLength(0)
    expect(events(db)).not.toContain('sms_sent')
  })

  it('TWILIO_ENABLED=false is off even with credentials', async () => {
    textingOn()
    process.env['TWILIO_ENABLED'] = 'false'
    const db = world([draft(1)])
    expect(await propose(db, oneOption([id(1)]))).toMatchObject({ ok: true, link: { texting: 'texting_off' } })
    expect(twilioCreate).not.toHaveBeenCalled()
  })

  it('texting on and opted in: one name-free text with the link, logged, recorded as sms_sent', async () => {
    textingOn()
    const db = world([draft(1)])
    const res = await propose(db, oneOption([id(1)]))
    if (!res.ok || !res.link) throw new Error('unreachable')
    expect(res.link.texting).toBe('sent')
    expect(twilioCreate).toHaveBeenCalledTimes(1)
    const { body, to } = twilioCreate.mock.calls[0]![0] as { body: string; to: string }
    expect(to).toBe('+15125550123')
    expect(body).toBe(`Hi Jordan, Dr. Chen has a treatment plan ready for you to review: ${res.link.url} Reply STOP to opt out.`)
    expect(body).not.toMatch(/Plain compound|Sunrise|prescription/i)
    expect(db.tables['sms_log']).toEqual([expect.objectContaining({ order_id: null, patient_id: 'pat-1', template_name: 'proposal_link', status: 'sent', twilio_message_sid: 'SM1' })])
    expect(events(db)).toEqual(['created', 'sent', 'sms_sent'])
  })

  it('texting on but the patient has not opted in: not texted; copy or QR instead', async () => {
    textingOn()
    const db = world([draft(1, { patient_id: P2 })])
    const res = await propose(db, oneOption([id(1)], { patientId: P2 }))
    expect(res).toMatchObject({ ok: true, link: { texting: 'not_opted_in' } })
    expect(twilioCreate).not.toHaveBeenCalled()
    expect(events(db)).not.toContain('sms_sent')
  })

  it('a failed text is not a failed send: the link is still returned', async () => {
    textingOn()
    twilioCreate.mockRejectedValue(Object.assign(new Error('boom'), { code: 21211 }))
    const db = world([draft(1)])
    const res = await propose(db, oneOption([id(1)]))
    expect(res).toMatchObject({ ok: true, status: 'sent', link: { texting: 'failed' } })
    expect(db.tables['sms_log']).toEqual([expect.objectContaining({ status: 'failed', error_code: '21211' })])
  })
})
