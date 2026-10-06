/**
 * @jest-environment node
 *
 * C7: createStripeClient() is the only way the app builds a Stripe client,
 * so every Stripe write goes through the PHI guard. A drug name in the
 * description or metadata never reaches the SDK.
 */

const piCreate     = jest.fn().mockResolvedValue({ id: 'pi_1' })
const piUpdate     = jest.fn().mockResolvedValue({ id: 'pi_1' })
const piRetrieve   = jest.fn().mockResolvedValue({ id: 'pi_1' })
const refundCreate = jest.fn().mockResolvedValue({ id: 're_1' })

jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    paymentIntents: { create: piCreate, update: piUpdate, retrieve: piRetrieve, cancel: jest.fn() },
    refunds:        { create: refundCreate, retrieve: jest.fn() },
    accounts:       { create: jest.fn() },
    accountLinks:   { create: jest.fn() },
    customers:      { create: jest.fn(), update: jest.fn() },
    charges:        { retrieve: jest.fn(), update: jest.fn() },
    webhooks:       { constructEvent: jest.fn() },
  }))
})

jest.mock('@/lib/env', () => ({
  serverEnv: { stripeSecretKey: () => 'sk_test_x' },
}))

import { createStripeClient } from '../client'

const ORDER_ID  = '11111111-1111-4111-8111-111111111111'
const CLINIC_ID = '22222222-2222-4222-8222-222222222222'

beforeEach(() => {
  piCreate.mockClear(); piUpdate.mockClear(); piRetrieve.mockClear(); refundCreate.mockClear()
})

describe('createStripeClient routes writes through the PHI guard', () => {
  it('lets a clean PaymentIntent create through to the SDK with its options', async () => {
    const stripe = createStripeClient()
    const params = {
      amount: 1000, currency: 'usd',
      metadata: { order_id: ORDER_ID, clinic_id: CLINIC_ID, platform: '8090ai' },
      description: 'CompoundIQ order',
      automatic_payment_methods: { enabled: true },
    }
    await stripe.paymentIntents.create(params, { idempotencyKey: 'k' })
    expect(piCreate).toHaveBeenCalledWith(params, { idempotencyKey: 'k' })
  })

  it('blocks a drug name in the description before the SDK is called', () => {
    const stripe = createStripeClient()
    expect(() => stripe.paymentIntents.create({
      amount: 1000, currency: 'usd',
      metadata: { order_id: ORDER_ID, clinic_id: CLINIC_ID, platform: '8090ai' },
      description: 'Tirzepatide 5 mg',
    })).toThrow(/description/)
    expect(piCreate).not.toHaveBeenCalled()
  })

  it('blocks a drug name in metadata before the SDK is called', () => {
    const stripe = createStripeClient()
    expect(() => stripe.paymentIntents.create({
      amount: 1000, currency: 'usd',
      metadata: { order_id: ORDER_ID, clinic_id: CLINIC_ID, platform: '8090ai', drug: 'Semaglutide' },
      description: 'CompoundIQ order',
    })).toThrow(/drug/)
    expect(piCreate).not.toHaveBeenCalled()
  })

  it('blocks receipt_email on a PaymentIntent update (id stays the first argument)', () => {
    const stripe = createStripeClient()
    expect(() => stripe.paymentIntents.update('pi_1', { receipt_email: 'p@example.com' })).toThrow(/receipt_email/)
    expect(piUpdate).not.toHaveBeenCalled()
  })

  it('leaves reads untouched', async () => {
    const stripe = createStripeClient()
    await stripe.paymentIntents.retrieve('pi_1')
    expect(piRetrieve).toHaveBeenCalledWith('pi_1')
  })

  it('guards refunds too', async () => {
    const stripe = createStripeClient()
    await stripe.refunds.create({ payment_intent: 'pi_1', reverse_transfer: true, refund_application_fee: true })
    expect(refundCreate).toHaveBeenCalled()
    expect(() => stripe.refunds.create({ payment_intent: 'pi_1', metadata: { reason: 'adverse reaction' } }))
      .toThrow(/reason/)
  })
})
