/**
 * @jest-environment node
 *
 * POST /api/checkout/payment-intent for a clinic on the demo payout path:
 * the PaymentIntent omits Connect routing (no transfer_data, no
 * application fee) for the exact 'poc_placeholder' and for the per-clinic
 * 'poc_placeholder_<clinic_id>' set on approval. A real acct_ id keeps its
 * Connect split.
 */

import type { NextRequest } from 'next/server'

const clinicFetchMock = jest.fn()
const stripeCreateMock = jest.fn()

jest.mock('@/lib/auth/checkout-token', () => ({
  verifyCheckoutToken: async () => ({ orderId: 'o-1', clinicId: 'c-1', patientId: 'p-1' }),
}))
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ is: () => ({ maybeSingle: async () => (table === 'orders' ? ORDER : clinicFetchMock()) }) }),
          maybeSingle: async () => (table === 'clinics' ? clinicFetchMock() : ORDER),
        }),
      }),
      update: () => ({ eq: () => ({ eq: () => ({ is: () => ({ select: async () => ({ data: [{ order_id: 'o-1' }], error: null }) }) }) }) }),
    }),
  }),
}))
jest.mock('@/lib/stripe/client', () => ({
  createStripeClient: () => ({ paymentIntents: { retrieve: jest.fn(), update: jest.fn(), create: (a: unknown) => stripeCreateMock(a) } }),
}))

const ORDER = {
  data: { order_id: 'o-1', status: 'AWAITING_PAYMENT', retail_price_snapshot: 300, wholesale_price_snapshot: 150, stripe_payment_intent_id: null, payment_group_id: null },
  error: null,
}

import { POST } from '../route'

const req = () => ({ json: async () => ({ token: 'ok' }) }) as unknown as NextRequest
const clinic = (id: string) => clinicFetchMock.mockResolvedValue({ data: { stripe_connect_account_id: id, stripe_connect_status: 'ACTIVE' }, error: null })

beforeEach(() => {
  clinicFetchMock.mockReset()
  stripeCreateMock.mockReset().mockResolvedValue({ id: 'pi_new', client_secret: 'pi_new_secret' })
})

it.each(['poc_placeholder', 'poc_placeholder_c1000000-0000-4000-8000-000000000001'])('%s: no Connect routing', async id => {
  clinic(id)
  const res = await POST(req())
  expect(res.status).toBe(200)
  const args = stripeCreateMock.mock.calls[0]![0] as Record<string, unknown>
  expect(args).not.toHaveProperty('transfer_data')
  expect(args).not.toHaveProperty('application_fee_amount')
  expect(args['amount']).toBe(30000)
})

it('a real Connect account keeps the split', async () => {
  clinic('acct_1PqRsTuVwXyZ0123')
  await POST(req())
  const args = stripeCreateMock.mock.calls[0]![0] as Record<string, unknown>
  expect(args['transfer_data']).toEqual({ destination: 'acct_1PqRsTuVwXyZ0123' })
  expect(args['application_fee_amount']).toBe(15000)
})
