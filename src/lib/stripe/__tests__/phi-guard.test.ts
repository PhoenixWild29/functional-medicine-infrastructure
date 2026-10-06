/**
 * @jest-environment node
 *
 * C7: no protected health information may reach Stripe (no BAA). Every
 * Stripe write goes through one guard that allows only opaque ids in
 * metadata, a fixed set of neutral descriptions, and a per-call list of
 * top-level fields. In dev and tests a violation throws; in production it
 * is logged (key names only, never values) and stripped.
 */

import { guardStripeParams, NEUTRAL_DESCRIPTION, bundleDescription } from '../phi-guard'

const ORDER_ID  = '11111111-1111-4111-8111-111111111111'
const CLINIC_ID = '22222222-2222-4222-8222-222222222222'
const GROUP_ID  = '33333333-3333-4333-8333-333333333333'

function soloCreate(over: Record<string, unknown> = {}) {
  return {
    amount: 30000,
    currency: 'usd',
    application_fee_amount: 16500,
    transfer_data: { destination: 'acct_123' },
    metadata: { order_id: ORDER_ID, clinic_id: CLINIC_ID, platform: '8090ai' },
    description: NEUTRAL_DESCRIPTION,
    automatic_payment_methods: { enabled: true },
    ...over,
  }
}

describe('neutral descriptions', () => {
  it('are free of clinical words', () => {
    expect(NEUTRAL_DESCRIPTION).toBe('CompoundIQ order')
    expect(bundleDescription(3)).toBe('CompoundIQ order bundle (3 items)')
    for (const d of [NEUTRAL_DESCRIPTION, bundleDescription(2)]) {
      expect(d).not.toMatch(/prescription|rx|medication|patient/i)
    }
  })
})

describe('guardStripeParams (dev/test: throws)', () => {
  it('passes a solo PaymentIntent create with only allowed fields, unchanged', () => {
    const params = soloCreate()
    expect(guardStripeParams('paymentIntents.create', params)).toEqual(params)
  })

  it('passes a group PaymentIntent create', () => {
    const params = soloCreate({
      metadata: { payment_group_id: GROUP_ID, clinic_id: CLINIC_ID, platform: '8090ai' },
      description: bundleDescription(2),
    })
    expect(guardStripeParams('paymentIntents.create', params)).toEqual(params)
  })

  it('rejects a drug name in a metadata value', () => {
    expect(() => guardStripeParams('paymentIntents.create', soloCreate({
      metadata: { order_id: 'Semaglutide 2.5 mg', clinic_id: CLINIC_ID, platform: '8090ai' },
    }))).toThrow(/metadata/)
  })

  it('rejects a metadata key outside the allow-list', () => {
    expect(() => guardStripeParams('paymentIntents.create', soloCreate({
      metadata: { order_id: ORDER_ID, clinic_id: CLINIC_ID, platform: '8090ai', medication: 'Tirzepatide' },
    }))).toThrow(/medication/)
  })

  it('rejects order_count (not an opaque id)', () => {
    expect(() => guardStripeParams('paymentIntents.create', soloCreate({
      metadata: { payment_group_id: GROUP_ID, clinic_id: CLINIC_ID, platform: '8090ai', order_count: '2' },
    }))).toThrow(/order_count/)
  })

  it('rejects a drug name in the description', () => {
    expect(() => guardStripeParams('paymentIntents.create', soloCreate({
      description: 'Semaglutide 2.5 mg/mL injection',
    }))).toThrow(/description/)
  })

  it('rejects the old "prescription" descriptions', () => {
    expect(() => guardStripeParams('paymentIntents.create', soloCreate({
      description: 'CompoundIQ prescription service',
    }))).toThrow(/description/)
    expect(() => guardStripeParams('paymentIntents.create', soloCreate({
      description: 'CompoundIQ prescription bundle (2 items)',
    }))).toThrow(/description/)
  })

  it.each([
    ['receipt_email', 'patient@example.com'],
    ['statement_descriptor', 'SEMAGLUTIDE'],
    ['statement_descriptor_suffix', 'WEIGHT LOSS'],
    ['shipping', { name: 'Jane Doe', address: { line1: '1 Main St' } }],
    ['customer', 'cus_123'],
  ])('rejects %s on a PaymentIntent create', (key, value) => {
    expect(() => guardStripeParams('paymentIntents.create', soloCreate({ [key]: value }))).toThrow(key)
  })

  it('rejects receipt_email on a PaymentIntent update', () => {
    expect(() => guardStripeParams('paymentIntents.update', { receipt_email: 'patient@example.com' }))
      .toThrow(/receipt_email/)
  })

  it('passes a Connect refund with no metadata', () => {
    const params = { payment_intent: 'pi_1', amount: 500, reverse_transfer: true, refund_application_fee: true }
    expect(guardStripeParams('refunds.create', params)).toEqual(params)
  })

  it('passes Connect account create and account link create', () => {
    expect(guardStripeParams('accounts.create', { type: 'express', metadata: { clinic_id: CLINIC_ID } }))
      .toEqual({ type: 'express', metadata: { clinic_id: CLINIC_ID } })
    const link = { account: 'acct_1', refresh_url: 'https://x/settings', return_url: 'https://x/settings', type: 'account_onboarding' }
    expect(guardStripeParams('accountLinks.create', link)).toEqual(link)
  })

  it('rejects clinic identity on a Connect account create', () => {
    expect(() => guardStripeParams('accounts.create', {
      type: 'express', business_profile: { name: 'Sunrise Hormone Clinic' },
    })).toThrow(/business_profile/)
  })

  it('rejects any customer object write', () => {
    expect(() => guardStripeParams('customers.create', { name: 'Jane Doe', email: 'jane@example.com' }))
      .toThrow(/customers\.create/)
  })

  it('allows a PaymentIntent cancel with no params', () => {
    expect(guardStripeParams('paymentIntents.cancel', undefined)).toBeUndefined()
  })
})

describe('guardStripeParams (production: logs and strips)', () => {
  const env = process.env as Record<string, string | undefined>
  const original = env['NODE_ENV']
  let errorSpy: jest.SpyInstance

  beforeEach(() => {
    env['NODE_ENV'] = 'production'
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    env['NODE_ENV'] = original
    errorSpy.mockRestore()
  })

  it('strips disallowed fields and metadata, neutralises the description, and never logs values', () => {
    const out = guardStripeParams('paymentIntents.create', soloCreate({
      description: 'Semaglutide 2.5 mg for Jane Doe',
      receipt_email: 'jane@example.com',
      metadata: { order_id: ORDER_ID, clinic_id: CLINIC_ID, platform: '8090ai', drug: 'Semaglutide' },
    })) as Record<string, unknown>

    expect(out['receipt_email']).toBeUndefined()
    expect(out['description']).toBe(NEUTRAL_DESCRIPTION)
    expect(out['metadata']).toEqual({ order_id: ORDER_ID, clinic_id: CLINIC_ID, platform: '8090ai' })
    expect(out['amount']).toBe(30000)
    expect(out['application_fee_amount']).toBe(16500)
    expect(out['transfer_data']).toEqual({ destination: 'acct_123' })

    expect(errorSpy).toHaveBeenCalled()
    const logged = errorSpy.mock.calls.map(c => c.join(' ')).join('\n')
    expect(logged).toMatch(/receipt_email/)
    expect(logged).not.toMatch(/Semaglutide|Jane|jane@example\.com/)
  })
})
