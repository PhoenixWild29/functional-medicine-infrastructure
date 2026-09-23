/**
 * @jest-environment node
 *
 * WO-99: batch signing — the only way an order is signed.
 *
 * Every check the single-draft path had (#164–#166) holds for every line
 * of a batch, plus WO-99's own: all or nothing, one payment group per
 * patient (never shared across patients), shipping once per pharmacy,
 * signer is always the provider on the line, EPCS code verified in the
 * signing request itself, and signing touches nothing but the signature
 * fields (a titration keeps its steps, a refill its source).
 */

import { signBatch, checkBatch } from '../batch-sign'
import { fakeDb } from './fake-db'

// ── Collaborators ─────────────────────────────────────────────

const todayCents = new Map<string, number>()
const resolveLineMock = jest.fn()
jest.mock('../resolve-line', () => ({ resolveLine: (...a: unknown[]) => resolveLineMock(...a) }))

const applyBundleShippingMock = jest.fn()
jest.mock('../apply-bundle-shipping', () => ({ applyBundleShipping: (...a: unknown[]) => applyBundleShippingMock(...a) }))

const createPaymentGroupMock = jest.fn()
const cancelPaymentGroupMock = jest.fn()
jest.mock('@/lib/payment-group/create-group', () => ({
  createPaymentGroup: (...a: unknown[]) => createPaymentGroupMock(...a),
  cancelPaymentGroup: (...a: unknown[]) => cancelPaymentGroupMock(...a),
}))

jest.mock('@/lib/auth/checkout-token', () => ({
  generateCheckoutToken:      jest.fn(async (orderId: string) => `solo-${orderId}`),
  generateGroupCheckoutToken: jest.fn(async (groupId: string) => `group-${groupId}`),
}))
const smsMock = jest.fn()
jest.mock('@/lib/sms/triggers', () => ({ sendPaymentLinkSms: (...a: unknown[]) => smsMock(...a) }))
jest.mock('@/lib/sla/creator', () => ({ createSlasForTransition: jest.fn(async () => undefined) }))
const historyMock = jest.fn()
jest.mock('../status-history', () => ({ insertStatusHistory: (...a: unknown[]) => historyMock(...a) }))
const totpMock = jest.fn()
jest.mock('@/lib/epcs/totp', () => ({ verifyProviderTotp: (...a: unknown[]) => totpMock(...a) }))
jest.mock('@/lib/env', () => ({ serverEnv: { appBaseUrl: () => 'https://app.test/' } }))

// ── Fixture ──────────────────────────────────────────────────

const CLINIC = 'c0000000-0000-4000-8000-000000000001'
const USER_CHEN = 'u-chen'
const CHEN = 'p-chen'
const PATEL = 'p-patel'
const P1 = 'pat-1'
const P2 = 'pat-2'
const id = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function draft(n: number, over: Record<string, unknown> = {}) {
  return {
    order_id: id(n), status: 'DRAFT', clinic_id: CLINIC, is_active: true, deleted_at: null,
    patient_id: P1, provider_id: CHEN, catalog_item_id: null, formulation_id: 'f-plain',
    pharmacy_id: 'ph-strive', retail_price_snapshot: 200, wholesale_price_snapshot: 100,
    shipping_state_snapshot: 'TX',
    medication_snapshot: { medication_name: `Plain compound ${n}`, dea_schedule: 0 },
    package_id: null, package_count: 1, refills: 0, substitution_allowed: true,
    syringe_option: 'none', shipping_type: 'standard', clinical_difference: null,
    diagnosis_code: null, diagnosis_text: null, special_instructions: null,
    days_supply: 30, dispense_quantity: 1, dispense_unit: 'vial',
    sig_mode: 'standard', titration_steps: [], refill_of_order_id: null, payment_group_id: null,
    ...over,
  }
}

function world(orders: Array<Record<string, unknown>>) {
  return fakeDb({
    orders,
    providers: [
      { provider_id: CHEN, user_id: USER_CHEN, clinic_id: CLINIC, is_active: true, deleted_at: null, first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890' },
      { provider_id: PATEL, user_id: 'u-patel', clinic_id: CLINIC, is_active: true, deleted_at: null, first_name: 'Raj', last_name: 'Patel', npi_number: '1987654321' },
    ],
    clinics: [{ clinic_id: CLINIC, stripe_connect_status: 'ACTIVE' }],
    pharmacies: [
      { pharmacy_id: 'ph-strive', name: 'Strive', integration_tier: 'TIER_2_PORTAL', is_active: true, pharmacy_status: 'ACTIVE', deleted_at: null },
      { pharmacy_id: 'ph-fax', name: 'Fax Rx', integration_tier: 'TIER_4_FAX', is_active: true, pharmacy_status: 'ACTIVE', deleted_at: null },
    ],
    pharmacy_state_licenses: [
      { pharmacy_id: 'ph-strive', state_code: 'TX', is_active: true },
      { pharmacy_id: 'ph-fax', state_code: 'TX', is_active: true },
    ],
    catalog: [],
    formulations: [
      { formulation_id: 'f-plain', requires_clinical_difference: false },
      { formulation_id: 'f-glp1', requires_clinical_difference: true },
      { formulation_id: 'f-testo', requires_clinical_difference: false },
    ],
    patients: [
      { patient_id: P1, allergies: ['sulfa'], nkda: false },
      { patient_id: P2, allergies: [], nkda: true },
    ],
    drug_interactions: [
      { interaction_id: 'i1', severity: 'warning', description: 'Monitor', ingredient_a: { common_name: 'Semaglutide' }, ingredient_b: { common_name: 'Testosterone' } },
    ],
    epcs_audit_log: [],
  })
}

const GOOD_SIGNATURE = {
  dataUrl:  'data:image/png;base64,SIG',
  strokes:  [[{ x: 10, y: 10 }, { x: 150, y: 12 }], [{ x: 20, y: 40 }, { x: 140, y: 42 }], [{ x: 30, y: 70 }, { x: 160, y: 72 }]],
  padWidth: 300,
}

function sign(db: ReturnType<typeof fakeDb>, orderIds: string[], over: Record<string, unknown> = {}) {
  return signBatch(db.client, {
    clinicId: CLINIC, userId: USER_CHEN, appRole: 'provider',
    orderIds, signature: GOOD_SIGNATURE, ...over,
  })
}

function orderRow(db: ReturnType<typeof fakeDb>, n: number) {
  return db.tables['orders']!.find(o => o['order_id'] === id(n))!
}

const signingUpdates = (db: ReturnType<typeof fakeDb>) =>
  db.writesTo('orders', 'update').filter(w => w.patch?.['status'] === 'AWAITING_PAYMENT')

let groupSeq = 0
beforeEach(() => {
  process.env['PHASE_C_GROUPS_ENABLED'] = 'true'
  todayCents.clear()
  groupSeq = 0
  resolveLineMock.mockReset().mockImplementation(async (_db: unknown, input: { formulationId: string; pharmacyId: string }) =>
    ({ ok: true, wholesaleCents: todayCents.get(`${input.formulationId}|${input.pharmacyId}`) ?? 10000 }))
  applyBundleShippingMock.mockReset().mockResolvedValue({ ok: true, shipping: { totalCents: 900, byPharmacy: [] }, feesByOrder: {} })
  createPaymentGroupMock.mockReset().mockImplementation(async () => {
    groupSeq++
    return { ok: true, groupId: `g-${groupSeq}`, stripePaymentIntentId: `pi_${groupSeq}`, totalCents: 1, orderCount: 2, patientId: 'x', providerId: CHEN }
  })
  cancelPaymentGroupMock.mockReset().mockResolvedValue(undefined)
  smsMock.mockReset().mockResolvedValue({ ok: true })
  historyMock.mockReset().mockResolvedValue(true)
  totpMock.mockReset()
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'info').mockImplementation(() => {})
})
afterEach(() => { jest.restoreAllMocks() })

// ── Signature ────────────────────────────────────────────────

describe('the signature', () => {
  it('a single dot is rejected — nothing is read or signed', async () => {
    const db = world([draft(1)])
    const res = await sign(db, [id(1)], { signature: { dataUrl: 'data:image/png;base64,SIG', strokes: [[{ x: 150, y: 60 }]], padWidth: 300 } })
    expect(res).toMatchObject({ ok: false, status: 400, code: 'SIGNATURE_REJECTED' })
    expect(signingUpdates(db)).toHaveLength(0)
  })

  it('three strokes across the pad sign', async () => {
    const db = world([draft(1)])
    expect(await sign(db, [id(1)])).toMatchObject({ ok: true })
  })
})

// ── Who signs ────────────────────────────────────────────────

describe('who signs', () => {
  it('only providers: another role is refused before anything is read', async () => {
    const db = world([draft(1)])
    const res = await signBatch(db.client, { clinicId: CLINIC, userId: 'u-ma', appRole: 'medical_assistant', orderIds: [id(1)], signature: GOOD_SIGNATURE })
    expect(res).toMatchObject({ ok: false, status: 403 })
    expect(db.writes).toHaveLength(0)
  })

  it("another provider's draft is never signed under my name: 403, the line is named, nothing is signed", async () => {
    const db = world([draft(1), draft(2, { provider_id: PATEL })])
    const res = await sign(db, [id(1), id(2)])
    expect(res).toMatchObject({ ok: false, status: 403 })
    if (res.ok) throw new Error('unreachable')
    expect(res.problems).toEqual([expect.objectContaining({ orderId: id(2), code: 'not_signer', message: expect.stringContaining('Raj Patel') })])
    expect(res.problems![0]!.message).toContain('Sign as me')
    expect(signingUpdates(db)).toHaveLength(0)
    expect(orderRow(db, 1)['status']).toBe('DRAFT')
  })

  it('a login with no provider row cannot sign', async () => {
    const db = world([draft(1)])
    const res = await signBatch(db.client, { clinicId: CLINIC, userId: 'u-nobody', appRole: 'provider', orderIds: [id(1)], signature: GOOD_SIGNATURE })
    expect(res).toMatchObject({ ok: false, status: 403 })
    expect(signingUpdates(db)).toHaveLength(0)
  })
})

// ── All or nothing ───────────────────────────────────────────

describe('all or nothing', () => {
  it('one below-cost line: nothing is signed, no group is formed, the line is named', async () => {
    todayCents.set('f-plain|ph-strive', 10000)
    const db = world([draft(1), draft(2, { retail_price_snapshot: 95, wholesale_price_snapshot: 90 })])
    const res = await sign(db, [id(1), id(2)])
    expect(res).toMatchObject({ ok: false, status: 422 })
    if (res.ok) throw new Error('unreachable')
    expect(res.problems).toEqual([expect.objectContaining({ orderId: id(2), code: 'below_cost' })])
    expect(signingUpdates(db)).toHaveLength(0)
    expect(createPaymentGroupMock).not.toHaveBeenCalled()
    expect(applyBundleShippingMock).not.toHaveBeenCalled()
  })

  it('WO-108: a line whose price moved since the draft was saved blocks the batch (either direction)', async () => {
    todayCents.set('f-plain|ph-strive', 9000)   // fell from $100
    const db = world([draft(1), draft(2)])
    const res = await sign(db, [id(1), id(2)])
    if (res.ok) throw new Error('expected a refusal')
    expect(res.status).toBe(422)
    expect(res.problems!.map(p => [p.orderId, p.code])).toEqual([[id(1), 'reprice'], [id(2), 'reprice']])
    expect(res.problems![0]!.message).toContain('$100.00 → $90.00')
    expect(signingUpdates(db)).toHaveLength(0)
  })

  it('a package the pharmacy no longer offers blocks the line (reprice), not an internal error', async () => {
    resolveLineMock.mockResolvedValueOnce({ ok: false, status: 400, error: 'Package is not offered by this pharmacy for this formulation' })
    const db = world([draft(1, { package_id: 'pkg-old' })])
    const res = await sign(db, [id(1)])
    if (res.ok) throw new Error('expected a refusal')
    expect(res.problems![0]).toMatchObject({ orderId: id(1), code: 'reprice' })
  })

  it("a pharmacy soft-deleted since the draft was saved blocks its line, and says so", async () => {
    const db = world([draft(1)])
    db.tables['pharmacies']!.find(p => p['pharmacy_id'] === 'ph-strive')!['deleted_at'] = '2026-04-23T00:00:00Z'
    const res = await sign(db, [id(1)])
    if (res.ok) throw new Error('expected a refusal')
    expect(res.problems![0]).toMatchObject({ orderId: id(1), code: 'pharmacy', message: expect.stringContaining('Strive is no longer active') })
    expect(signingUpdates(db)).toHaveLength(0)
  })

  it('a draft already signed elsewhere: 409, the others are not signed', async () => {
    const db = world([draft(1), draft(2, { status: 'AWAITING_PAYMENT' })])
    const res = await sign(db, [id(1), id(2)])
    expect(res).toMatchObject({ ok: false, status: 409 })
    expect(orderRow(db, 1)['status']).toBe('DRAFT')
  })

  it('WO-96 clinical difference missing on one line names that line and signs none', async () => {
    const db = world([draft(1), draft(2, { formulation_id: 'f-glp1', medication_snapshot: { medication_name: 'Semaglutide 5mg/mL', dea_schedule: 0 } })])
    const res = await sign(db, [id(1), id(2)])
    if (res.ok) throw new Error('expected a refusal')
    expect(res.status).toBe(422)
    expect(res.problems).toEqual([expect.objectContaining({ orderId: id(2), code: 'rx_details', message: expect.stringContaining('clinical difference') })])
    expect(signingUpdates(db)).toHaveLength(0)
  })
})

// ── Checks that could not run ────────────────────────────────

describe('a check that could not run blocks the whole batch (503), never reads as a pass', () => {
  it('the clinical-difference rule could not be read', async () => {
    const db = world([draft(1), draft(2)])
    db.failOn('formulations:select')
    const res = await sign(db, [id(1), id(2)])
    expect(res).toMatchObject({ ok: false, status: 503 })
    if (res.ok) throw new Error('unreachable')
    expect(res.problems!.every(p => p.code === 'rules_unavailable')).toBe(true)
    expect(signingUpdates(db)).toHaveLength(0)
  })

  it("the patient's allergy status could not be read", async () => {
    const db = world([draft(1)])
    db.failOn('patients:select')
    const res = await sign(db, [id(1)])
    expect(res).toMatchObject({ ok: false, status: 503 })
    if (res.ok) throw new Error('unreachable')
    expect(res.problems![0]).toMatchObject({ orderId: id(1), code: 'allergy_unavailable' })
    expect(signingUpdates(db)).toHaveLength(0)
  })

  it('the drug interaction check could not run', async () => {
    const db = world([draft(1)])
    db.failOn('drug_interactions:select')
    const res = await sign(db, [id(1)])
    expect(res).toMatchObject({ ok: false, status: 503 })
    if (res.ok) throw new Error('unreachable')
    expect(res.problems![0]).toMatchObject({ code: 'interactions_unavailable' })
  })

  it("today's price could not be read", async () => {
    resolveLineMock.mockResolvedValueOnce({ ok: false, status: 503, error: 'lookup failed' })
    const db = world([draft(1)])
    const res = await sign(db, [id(1)])
    expect(res).toMatchObject({ ok: false, status: 503 })
  })

  it('checks that ran and FOUND something do not block: recorded allergies and a known interaction still sign', async () => {
    const db = world([
      draft(1, { medication_snapshot: { medication_name: 'Semaglutide 5mg/mL', dea_schedule: 0 }, formulation_id: 'f-plain' }),
      draft(2, { medication_snapshot: { medication_name: 'Testosterone Cypionate 200mg/mL', dea_schedule: 0 } }),
    ])
    expect(await sign(db, [id(1), id(2)])).toMatchObject({ ok: true })
  })

  it('the preflight (no patient checks) reports the line problems without signing', async () => {
    todayCents.set('f-plain|ph-strive', 11000)
    const db = world([draft(1)])
    const check = await checkBatch(db.client, { clinicId: CLINIC, userId: USER_CHEN, orderIds: [id(1)], atSigning: false })
    expect(check.problems).toEqual([expect.objectContaining({ orderId: id(1), code: 'reprice' })])
    expect(db.writes).toHaveLength(0)
  })
})

// ── Controlled substances ────────────────────────────────────

describe('EPCS: the authenticator code is checked in the signing request', () => {
  const testo = (n: number, over: Record<string, unknown> = {}) => draft(n, {
    formulation_id: 'f-testo', pharmacy_id: 'ph-fax', wholesale_price_snapshot: 150, retail_price_snapshot: 250,
    medication_snapshot: { medication_name: 'Testosterone Cypionate 200mg/mL', dea_schedule: 3 },
    diagnosis_code: 'E29.1', ...over,
  })
  beforeEach(() => { todayCents.set('f-testo|ph-fax', 15000) })

  it('Schedule III with no code: 401 TOTP_REQUIRED, nothing signed', async () => {
    const db = world([draft(1), testo(2)])
    const res = await sign(db, [id(1), id(2)])
    expect(res).toMatchObject({ ok: false, status: 401, code: 'TOTP_REQUIRED' })
    expect(signingUpdates(db)).toHaveLength(0)
    expect(createPaymentGroupMock).not.toHaveBeenCalled()
  })

  it('a wrong code: 401 TOTP_INVALID, a TOTP_FAILED audit row, nothing signed', async () => {
    totpMock.mockResolvedValue('invalid')
    const db = world([testo(2)])
    const res = await sign(db, [id(2)], { totpCode: '000000' })
    expect(res).toMatchObject({ ok: false, status: 401, code: 'TOTP_INVALID' })
    expect(db.tables['epcs_audit_log']!.map(r => r['event_type'])).toEqual(['TOTP_FAILED'])
    expect(signingUpdates(db)).toHaveLength(0)
  })

  it('the code is verified once for the batch; the audit references every controlled order id', async () => {
    totpMock.mockResolvedValue('valid')
    const db = world([draft(1), testo(2), testo(3, { medication_snapshot: { medication_name: 'Testosterone Enanthate', dea_schedule: 3 } })])
    const res = await sign(db, [id(1), id(2), id(3)], { totpCode: '123456' })
    expect(res).toMatchObject({ ok: true })
    expect(totpMock).toHaveBeenCalledTimes(1)
    expect(totpMock).toHaveBeenCalledWith(expect.anything(), CHEN, '123456')
    const audit = db.tables['epcs_audit_log']!
    expect(audit.filter(r => r['event_type'] === 'TOTP_VERIFIED').map(r => r['order_id'])).toEqual([id(2), id(3)])
    expect(audit.filter(r => r['event_type'] === 'ORDER_SIGNED').map(r => r['order_id'])).toEqual([id(2), id(3)])
    for (const row of audit) {
      expect((row['details'] as { batch_controlled_order_ids: string[] }).batch_controlled_order_ids).toEqual([id(2), id(3)])
    }
  })

  it('the TOTP_VERIFIED record is written BEFORE signing; if it cannot be, nothing is signed', async () => {
    totpMock.mockResolvedValue('valid')
    const db = world([testo(2)])
    db.failOn('epcs_audit_log:insert')
    const res = await sign(db, [id(2)], { totpCode: '123456' })
    expect(res).toMatchObject({ ok: false, status: 503 })
    expect(signingUpdates(db)).toHaveLength(0)
  })

  it('an UNKNOWN schedule counts as controlled: it must go by fax AND needs the code', async () => {
    todayCents.set('null|ph-fax', 15000)
    const db = world([testo(2, { catalog_item_id: 'cat-1', formulation_id: null, medication_snapshot: { medication_name: 'Legacy item' } })])
    db.failOn('catalog:select')
    const res = await sign(db, [id(2)])
    expect(res).toMatchObject({ ok: false, status: 401, code: 'TOTP_REQUIRED' })
  })

  it('Schedule III at a non-fax pharmacy is refused before the code is asked for', async () => {
    const db = world([testo(2, { pharmacy_id: 'ph-strive' })])
    const res = await sign(db, [id(2)], { totpCode: '123456' })
    if (res.ok) throw new Error('expected a refusal')
    expect(res.problems![0]).toMatchObject({ code: 'dea_fax' })
    expect(totpMock).not.toHaveBeenCalled()
  })
})

// ── Payment groups ───────────────────────────────────────────

describe('one payment link per patient', () => {
  it('two drafts for one patient: shipping allocated across them, ONE group created on the drafts BEFORE signing, one link, one SMS', async () => {
    const db = world([draft(1), draft(2)])
    const order: string[] = []
    applyBundleShippingMock.mockImplementation(async () => { order.push('shipping'); return { ok: true, shipping: { totalCents: 900, byPharmacy: [] }, feesByOrder: {} } })
    createPaymentGroupMock.mockImplementation(async () => { order.push('group'); return { ok: true, groupId: 'g-1', stripePaymentIntentId: 'pi_1', totalCents: 1, orderCount: 2, patientId: P1, providerId: CHEN } })

    const res = await sign(db, [id(1), id(2)])
    if (!res.ok) throw new Error(res.error)
    expect(order).toEqual(['shipping', 'group'])
    expect(applyBundleShippingMock).toHaveBeenCalledWith(expect.anything(), CLINIC, [id(1), id(2)])
    expect(createPaymentGroupMock).toHaveBeenCalledWith(expect.objectContaining({ orderIds: [id(1), id(2)], memberStatus: 'DRAFT', callerAppRole: 'provider', callerUserId: USER_CHEN }))
    expect(res.patients).toEqual([{ patientId: P1, orderIds: [id(1), id(2)], paymentGroupId: 'g-1', checkoutUrl: 'https://app.test/checkout/group-g-1' }])
    expect(smsMock).toHaveBeenCalledTimes(1)
    expect(smsMock).toHaveBeenCalledWith(id(1), 'https://app.test/checkout/group-g-1')
  })

  it('different patients never share a group, a link or a checkout', async () => {
    const db = world([draft(1), draft(2), draft(3, { patient_id: P2 })])
    const res = await sign(db, [id(1), id(2), id(3)])
    if (!res.ok) throw new Error(res.error)
    expect(createPaymentGroupMock).toHaveBeenCalledTimes(1)
    expect(createPaymentGroupMock.mock.calls[0]![0]).toMatchObject({ orderIds: [id(1), id(2)] })
    expect(res.patients).toEqual([
      { patientId: P1, orderIds: [id(1), id(2)], paymentGroupId: 'g-1', checkoutUrl: 'https://app.test/checkout/group-g-1' },
      { patientId: P2, orderIds: [id(3)], paymentGroupId: null, checkoutUrl: `https://app.test/checkout/solo-${id(3)}` },
    ])
    expect(applyBundleShippingMock.mock.calls.map(c => c[2])).toEqual([[id(1), id(2)], [id(3)]])
    expect(smsMock).toHaveBeenCalledTimes(2)
  })

  it('if the group cannot be created, nothing is signed and groups already made are cancelled', async () => {
    createPaymentGroupMock
      .mockResolvedValueOnce({ ok: true, groupId: 'g-1', stripePaymentIntentId: 'pi_1', totalCents: 1, orderCount: 2, patientId: P1, providerId: CHEN })
      .mockResolvedValueOnce({ ok: false, status: 502, error: 'Failed to create Stripe PaymentIntent for group' })
    const db = world([draft(1), draft(2), draft(3, { patient_id: P2 }), draft(4, { patient_id: P2 })])
    const res = await sign(db, [id(1), id(2), id(3), id(4)])
    expect(res).toMatchObject({ ok: false, status: 503 })
    expect(signingUpdates(db)).toHaveLength(0)
    expect(cancelPaymentGroupMock).toHaveBeenCalledWith(expect.objectContaining({ groupId: 'g-1', orderIds: [id(1), id(2)], stripePaymentIntentId: 'pi_1' }))
  })

  it('if shipping cannot be allocated, nothing is signed', async () => {
    applyBundleShippingMock.mockResolvedValue({ ok: false, status: 500, error: 'Failed to load pharmacy shipping rates' })
    const db = world([draft(1), draft(2)])
    const res = await sign(db, [id(1), id(2)])
    expect(res).toMatchObject({ ok: false, status: 503 })
    expect(signingUpdates(db)).toHaveLength(0)
    expect(createPaymentGroupMock).not.toHaveBeenCalled()
  })

  it('with payment groups switched off, a multi-prescription batch is refused before anything is written', async () => {
    process.env['PHASE_C_GROUPS_ENABLED'] = 'false'
    const db = world([draft(1), draft(2)])
    const res = await sign(db, [id(1), id(2)])
    expect(res).toMatchObject({ ok: false, status: 503 })
    expect(db.writes).toHaveLength(0)
  })
})

// ── What signing writes ──────────────────────────────────────

describe('the signature record', () => {
  it('one statement signs every order with the same hash and time, and touches nothing else', async () => {
    const steps = [{ dose: '10', unit: 'units', frequency: 'QW', weeks: 4 }, { dose: '20', unit: 'units', frequency: 'QW', weeks: 4 }]
    const db = world([
      draft(1, { sig_mode: 'titration', titration_steps: steps }),
      draft(2, { refill_of_order_id: 'src-order' }),
    ])
    const res = await sign(db, [id(1), id(2)])
    if (!res.ok) throw new Error(res.error)

    const updates = signingUpdates(db)
    expect(updates).toHaveLength(1)
    expect(Object.keys(updates[0]!.patch!).sort()).toEqual(['locked_at', 'provider_signature_hash_snapshot', 'status', 'updated_at'])
    expect(updates[0]!.matched!.map(r => r['order_id'])).toEqual([id(1), id(2)])

    const [a, b] = [orderRow(db, 1), orderRow(db, 2)]
    expect(a['status']).toBe('AWAITING_PAYMENT')
    expect(a['provider_signature_hash_snapshot']).toMatch(/^[0-9a-f]{64}$/)
    expect(b['provider_signature_hash_snapshot']).toBe(a['provider_signature_hash_snapshot'])
    expect(b['locked_at']).toBe(a['locked_at'])
    // A titration keeps its steps; a refill keeps its source.
    expect(a['sig_mode']).toBe('titration')
    expect(a['titration_steps']).toEqual(steps)
    expect(b['refill_of_order_id']).toBe('src-order')

    // One history row per order, naming the batch and the group.
    const rows = historyMock.mock.calls[0]![1] as Array<{ order_id: string; metadata: Record<string, unknown> }>
    expect(rows.map(r => r.order_id)).toEqual([id(1), id(2)])
    expect(rows[0]!.metadata).toMatchObject({ actor: 'provider_batch_sign', batch_order_ids: [id(1), id(2)], payment_group_id: 'g-1' })
  })
})
