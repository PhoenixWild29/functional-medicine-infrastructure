/**
 * @jest-environment node
 *
 * Batch 3, PR 3: a payment group is not priced on a failed read.
 *
 * createPaymentGroup reads the clinic's absorb_shipping flag. Before, a
 * failed read meant "the clinic does not absorb shipping", so the patient
 * would be charged shipping the clinic had chosen to cover. Now it stops
 * with the existing 500 "Shipping lookup failed": no payment group row,
 * no PaymentIntent.
 *
 * Stripe is mocked; nothing is charged.
 */

import { scriptedDb, DB_DOWN } from '@/__tests__/helpers/scripted-db'
import { createPaymentGroup } from '../create-group'

const paymentIntentsCreate = jest.fn()
jest.mock('@/lib/stripe/client', () => ({
  createStripeClient: () => ({ paymentIntents: { create: (...a: unknown[]) => paymentIntentsCreate(...a) } }),
}))
jest.mock('@/lib/orders/apply-bundle-shipping', () => ({ loadShippingRates: async () => new Map() }))
jest.mock('@/lib/orders/shipping', () => ({
  ...jest.requireActual('@/lib/orders/shipping'),
  computeBundleShipping: () => ({ totalCents: 1500 }),
}))

jest.spyOn(console, 'error').mockImplementation(() => {})

const ORDER = {
  order_id: 'o-1', status: 'AWAITING_PAYMENT', clinic_id: 'c-1', patient_id: 'pt-1', provider_id: 'pr-1',
  retail_price_snapshot: 200, wholesale_price_snapshot: 100, pharmacy_id: 'ph-1', shipping_type: 'standard',
  payment_group_id: null, stripe_payment_intent_id: null,
}

it('a failed absorb_shipping read stops the group instead of charging the patient shipping', async () => {
  const db = scriptedDb(c => {
    if (c.table === 'orders') return { data: [ORDER] }
    if (c.table === 'clinics') return DB_DOWN
    return undefined
  })
  const result = await createPaymentGroup({
    supabase: db.client, clinicId: 'c-1', callerAppRole: 'clinic_admin', callerUserId: 'u1', orderIds: ['o-1'],
  })
  expect(result).toEqual({ ok: false, status: 500, error: 'Shipping lookup failed' })
  expect(db.to('payment_groups', 'insert')).toHaveLength(0)
  expect(paymentIntentsCreate).not.toHaveBeenCalled()
})
