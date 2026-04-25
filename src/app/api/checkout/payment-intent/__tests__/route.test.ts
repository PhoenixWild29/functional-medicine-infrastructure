/**
 * @jest-environment node
 *
 * Tests for POST /api/checkout/payment-intent (PR #15 Option B).
 *
 * Covers the email-for-receipt paths that are awkward to exercise via E2E:
 *   - No email on page-load call → PI created without receipt_email
 *   - Valid email on pre-submit call → existing PI updated with receipt_email
 *   - Malformed email → 400
 *   - .invalid TLD rejected (defensive; seed fixtures use this TLD)
 *   - Missing / invalid token paths still return 400 / 401
 *
 * Happy-path payment confirmation is covered end-to-end by the existing
 * checkout E2E spec; these unit tests pin the branches on top.
 */

import { POST } from '../route'
import type { NextRequest } from 'next/server'

// ── Mocks ────────────────────────────────────────────────────

const verifyTokenMock    = jest.fn()
const orderFetchMock     = jest.fn()
const clinicFetchMock    = jest.fn()
const orderUpdateMock    = jest.fn().mockResolvedValue({ error: null })
const stripeRetrieveMock = jest.fn()
const stripeUpdateMock   = jest.fn().mockResolvedValue({})
const stripeCreateMock   = jest.fn()

jest.mock('@/lib/auth/checkout-token', () => ({
  verifyCheckoutToken: (token: string) => verifyTokenMock(token),
}))

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            is: () => ({
              maybeSingle: () => (table === 'orders' ? orderFetchMock() : clinicFetchMock()),
            }),
          }),
          maybeSingle: () => (table === 'clinics' ? clinicFetchMock() : orderFetchMock()),
        }),
      }),
      update: () => ({
        eq: () => ({
          eq: () => orderUpdateMock(),
        }),
      }),
    }),
  }),
}))

jest.mock('@/lib/stripe/client', () => ({
  createStripeClient: () => ({
    paymentIntents: {
      retrieve: (id: string)          => stripeRetrieveMock(id),
      update:   (id: string, args: unknown) => stripeUpdateMock(id, args),
      create:   (args: unknown)       => stripeCreateMock(args),
    },
  }),
}))

// ── Helpers ──────────────────────────────────────────────────

function makeRequest(body: Record<string, unknown>): NextRequest {
  return {
    json: async () => body,
  } as unknown as NextRequest
}

const VALID_ORDER = {
  order_id:                 'o-1',
  status:                   'AWAITING_PAYMENT',
  retail_price_snapshot:    300,
  wholesale_price_snapshot: 150,
  stripe_payment_intent_id: 'pi_existing',
}

const VALID_CLINIC = {
  stripe_connect_account_id: 'acct_test_123',
  stripe_connect_status:     'ACTIVE',
}

beforeEach(() => {
  verifyTokenMock.mockReset()
  orderFetchMock.mockReset()
  clinicFetchMock.mockReset()
  stripeRetrieveMock.mockReset()
  stripeUpdateMock.mockReset().mockResolvedValue({})
  stripeCreateMock.mockReset()

  verifyTokenMock.mockResolvedValue({ orderId: 'o-1', clinicId: 'c-1', patientId: 'p-1' })
  orderFetchMock.mockResolvedValue({ data: VALID_ORDER, error: null })
  clinicFetchMock.mockResolvedValue({ data: VALID_CLINIC, error: null })
})

// ── Auth / payload validation ────────────────────────────────

describe('POST /api/checkout/payment-intent — auth', () => {
  it('returns 400 when token is missing', async () => {
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)
  })

  it('returns 401 when token is invalid / expired', async () => {
    verifyTokenMock.mockResolvedValue(null)
    const res = await POST(makeRequest({ token: 'bad.jwt' }))
    expect(res.status).toBe(401)
  })
})

// ── Email validation (PR #15) ────────────────────────────────

describe('POST /api/checkout/payment-intent — email validation', () => {
  it('returns 400 on syntactically malformed email', async () => {
    const res = await POST(makeRequest({ token: 'ok', email: 'not-an-email' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/email/i)
  })

  it('returns 400 on .invalid TLD (defensive against seed fixtures leaking)', async () => {
    const res = await POST(makeRequest({ token: 'ok', email: 'demo-fixture@compoundiq-poc.invalid' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 on excessively long email (>254 chars per RFC 5321)', async () => {
    const longEmail = `${'a'.repeat(250)}@x.co`  // 256 chars
    const res = await POST(makeRequest({ token: 'ok', email: longEmail }))
    expect(res.status).toBe(400)
  })

  it('returns 400 on non-string email', async () => {
    const res = await POST(makeRequest({ token: 'ok', email: 123 }))
    expect(res.status).toBe(400)
  })

  it('returns 200 on valid email with normal TLD', async () => {
    stripeRetrieveMock.mockResolvedValue({
      id:            'pi_existing',
      client_secret: 'pi_existing_secret_xxx',
      status:        'requires_payment_method',
      receipt_email: null,
    })
    const res = await POST(makeRequest({ token: 'ok', email: 'alice@example.com' }))
    expect(res.status).toBe(200)
  })
})

// ── Existing PI branch: email attachment ─────────────────────

describe('POST /api/checkout/payment-intent — existing PI + email', () => {
  it('updates existing PI receipt_email when a new email is supplied', async () => {
    stripeRetrieveMock.mockResolvedValue({
      id:            'pi_existing',
      client_secret: 'pi_existing_secret_xxx',
      status:        'requires_payment_method',
      receipt_email: null,
    })
    const res = await POST(makeRequest({ token: 'ok', email: 'alice@example.com' }))
    expect(res.status).toBe(200)
    expect(stripeUpdateMock).toHaveBeenCalledTimes(1)
    expect(stripeUpdateMock).toHaveBeenCalledWith('pi_existing', { receipt_email: 'alice@example.com' })
  })

  it('does NOT re-update when the PI already has the same receipt_email', async () => {
    stripeRetrieveMock.mockResolvedValue({
      id:            'pi_existing',
      client_secret: 'pi_existing_secret_xxx',
      status:        'requires_payment_method',
      receipt_email: 'alice@example.com',
    })
    const res = await POST(makeRequest({ token: 'ok', email: 'alice@example.com' }))
    expect(res.status).toBe(200)
    expect(stripeUpdateMock).not.toHaveBeenCalled()
  })

  it('does NOT update when no email was supplied (page-load call)', async () => {
    stripeRetrieveMock.mockResolvedValue({
      id:            'pi_existing',
      client_secret: 'pi_existing_secret_xxx',
      status:        'requires_payment_method',
      receipt_email: null,
    })
    const res = await POST(makeRequest({ token: 'ok' }))
    expect(res.status).toBe(200)
    expect(stripeUpdateMock).not.toHaveBeenCalled()
    // PI create path must NOT fire either — we're returning the existing PI
    expect(stripeCreateMock).not.toHaveBeenCalled()
  })

  it('tolerates update() failure without blocking the checkout (non-fatal)', async () => {
    stripeRetrieveMock.mockResolvedValue({
      id:            'pi_existing',
      client_secret: 'pi_existing_secret_xxx',
      status:        'requires_payment_method',
      receipt_email: null,
    })
    stripeUpdateMock.mockRejectedValueOnce(new Error('Stripe API 500'))
    const res = await POST(makeRequest({ token: 'ok', email: 'alice@example.com' }))
    // Critical: the client MUST still receive a clientSecret so checkout can proceed.
    // Worst case we just don't attach the receipt_email; better than blocking the sale.
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.clientSecret).toBe('pi_existing_secret_xxx')
  })
})

// ── Fresh PI create branch: email on create ──────────────────

describe('POST /api/checkout/payment-intent — new PI create + email', () => {
  beforeEach(() => {
    // Order has no existing PI, so we'll create one
    orderFetchMock.mockResolvedValue({
      data: { ...VALID_ORDER, stripe_payment_intent_id: null },
      error: null,
    })
    stripeCreateMock.mockResolvedValue({
      id:            'pi_new',
      client_secret: 'pi_new_secret_yyy',
    })
  })

  it('includes receipt_email on create when email is supplied', async () => {
    const res = await POST(makeRequest({ token: 'ok', email: 'bob@example.com' }))
    expect(res.status).toBe(200)
    expect(stripeCreateMock).toHaveBeenCalledTimes(1)
    const createArgs = stripeCreateMock.mock.calls[0]![0] as Record<string, unknown>
    expect(createArgs.receipt_email).toBe('bob@example.com')
  })

  it('omits receipt_email on create when no email is supplied', async () => {
    const res = await POST(makeRequest({ token: 'ok' }))
    expect(res.status).toBe(200)
    const createArgs = stripeCreateMock.mock.calls[0]![0] as Record<string, unknown>
    expect(createArgs).not.toHaveProperty('receipt_email')
  })

  // R7-Bucket-1: regression guard for Stripe Link UI suppression
  it('passes payment_method_options.link.display = "never" to suppress Link auto-fill panel', async () => {
    const res = await POST(makeRequest({ token: 'ok' }))
    expect(res.status).toBe(200)
    const createArgs = stripeCreateMock.mock.calls[0]![0] as {
      payment_method_options?: { link?: { display?: string } }
    }
    expect(createArgs.payment_method_options?.link?.display).toBe('never')
  })
})
