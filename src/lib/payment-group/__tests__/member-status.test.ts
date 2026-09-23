/**
 * @jest-environment node
 *
 * WO-99: batch signing creates a patient's payment group on their DRAFTs,
 * before it signs them — a signed order is locked for good, so a group
 * that failed after signing would strand signed orders with no link.
 * Combine and Send (the default) still bundles AWAITING_PAYMENT orders only.
 */

import { createPaymentGroup } from '../create-group'
import { fakeDb } from '@/lib/orders/__tests__/fake-db'

const piCreateMock = jest.fn()
jest.mock('@/lib/stripe/client', () => ({
  createStripeClient: () => ({ paymentIntents: { create: (...a: unknown[]) => piCreateMock(...a), cancel: jest.fn() } }),
}))
jest.mock('@/lib/orders/apply-bundle-shipping', () => ({
  loadShippingRates: async () => new Map([['ph-strive', { pharmacyId: 'ph-strive', pharmacyName: 'Strive', standardCents: 900, coldChainCents: 2200, freeShippingThresholdCents: null }]]),
}))

const CLINIC = 'c1'
function world(status: string) {
  const order = (n: number) => ({
    order_id: `o-${n}`, status, clinic_id: CLINIC, deleted_at: null, patient_id: 'pat', provider_id: 'prov',
    retail_price_snapshot: 200, wholesale_price_snapshot: 100, pharmacy_id: 'ph-strive', shipping_type: 'standard',
    payment_group_id: null, stripe_payment_intent_id: null,
  })
  return fakeDb({
    orders: [order(1), order(2)],
    providers: [{ provider_id: 'prov', user_id: 'u1', clinic_id: CLINIC, deleted_at: null }],
    clinics: [{ clinic_id: CLINIC, absorb_shipping: false, stripe_connect_account_id: 'poc_placeholder', stripe_connect_status: 'ACTIVE' }],
    payment_groups: [],
  })
}

beforeEach(() => {
  piCreateMock.mockReset().mockResolvedValue({ id: 'pi_1', client_secret: 'pi_1_secret' })
  jest.spyOn(console, 'info').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { jest.restoreAllMocks() })

// The fake DB assigns no group_id on insert; give the insert one.
function withGroupIds(db: ReturnType<typeof fakeDb>) {
  const from = (db.client as unknown as { from: (t: string) => Record<string, unknown> }).from
  ;(db.client as unknown as { from: (t: string) => unknown }).from = (t: string) => {
    const q = from(t)
    if (t !== 'payment_groups') return q
    const insert = q['insert'] as (r: Record<string, unknown>) => unknown
    q['insert'] = (r: Record<string, unknown>) => insert({ ...r, group_id: 'g-1' })
    return q
  }
  return db
}

describe('createPaymentGroup memberStatus', () => {
  it('by default refuses DRAFT orders (Combine and Send bundles signed orders only)', async () => {
    const db = world('DRAFT')
    const res = await createPaymentGroup({ supabase: db.client, clinicId: CLINIC, callerAppRole: 'provider', callerUserId: 'u1', orderIds: ['o-1', 'o-2'] })
    expect(res).toMatchObject({ ok: false, status: 409 })
    expect(piCreateMock).not.toHaveBeenCalled()
  })

  it("memberStatus 'DRAFT' links the drafts, charges shipping once, and creates the PaymentIntent", async () => {
    const db = withGroupIds(world('DRAFT'))
    const res = await createPaymentGroup({ supabase: db.client, clinicId: CLINIC, callerAppRole: 'provider', callerUserId: 'u1', orderIds: ['o-1', 'o-2'], memberStatus: 'DRAFT' })
    expect(res).toMatchObject({ ok: true, groupId: 'g-1', stripePaymentIntentId: 'pi_1' })
    expect(db.tables['orders']!.map(o => [o['order_id'], o['status'], o['payment_group_id']])).toEqual([['o-1', 'DRAFT', 'g-1'], ['o-2', 'DRAFT', 'g-1']])
    // $400 retail + $9 shipping once for the one pharmacy.
    expect(db.tables['payment_groups']![0]).toMatchObject({ total_cents: 40900, shipping_total: 9 })
    expect(piCreateMock).toHaveBeenCalledWith(expect.objectContaining({ amount: 40900 }), { idempotencyKey: 'checkout-group-pi-v1-g-1' })
  })

  it("memberStatus 'DRAFT' refuses an order that is already signed", async () => {
    const db = world('AWAITING_PAYMENT')
    const res = await createPaymentGroup({ supabase: db.client, clinicId: CLINIC, callerAppRole: 'provider', callerUserId: 'u1', orderIds: ['o-1', 'o-2'], memberStatus: 'DRAFT' })
    expect(res).toMatchObject({ ok: false, status: 409 })
  })
})
