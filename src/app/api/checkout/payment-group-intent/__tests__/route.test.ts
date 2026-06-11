/**
 * @jest-environment node
 *
 * Tests for Phase C Stage 5 — POST /api/checkout/payment-group-intent.
 *
 * Coverage:
 *   - Feature flag (503 when off)
 *   - Body validation
 *   - Token verification (invalid / solo / group)
 *   - Group lookup (404, wrong clinic, wrong status)
 *   - Stripe retrieve happy path returns clientSecret + totalCents
 *   - Email attach happy path
 *   - Cancelled PI yields 410
 */

import { POST } from '../route'

const TEST_CLINIC_ID = 'aaaaaaaa-aaaa-4aaa-9aaa-aaaaaaaaaaaa'
const GROUP_ID       = 'cccccccc-cccc-4ccc-9ccc-cccccccccccc'
const PATIENT_ID     = 'bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb'

const verifyTokenMock     = jest.fn()
const groupFetchMock      = jest.fn()
const orderCountMock      = jest.fn()
const stripeRetrieveMock  = jest.fn()
const stripeUpdateMock    = jest.fn()

jest.mock('@/lib/auth/checkout-token', () => ({
  verifyCheckoutToken: (t: string) => verifyTokenMock(t),
}))

jest.mock('@/lib/stripe/client', () => ({
  createStripeClient: jest.fn().mockReturnValue({
    paymentIntents: {
      retrieve: (id: string) => stripeRetrieveMock(id),
      update:   (id: string, fields: unknown) => stripeUpdateMock(id, fields),
    },
  }),
}))

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn().mockReturnValue({
    from: (table: string) => {
      if (table === 'payment_groups') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => groupFetchMock(),
              }),
            }),
          }),
        }
      }
      if (table === 'orders') {
        return {
          select: () => ({
            eq: () => ({
              is: () => orderCountMock(),
            }),
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }),
}))

function makeRequest(body: unknown): import('next/server').NextRequest {
  return { json: async () => body } as unknown as import('next/server').NextRequest
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env['PHASE_C_GROUPS_ENABLED'] = 'true'
  verifyTokenMock.mockResolvedValue({
    groupId:   GROUP_ID,
    patientId: PATIENT_ID,
    clinicId:  TEST_CLINIC_ID,
    iat:       0,
    exp:       Math.floor(Date.now() / 1000) + 3600,
  })
})

afterAll(() => {
  delete process.env['PHASE_C_GROUPS_ENABLED']
})

describe('POST /api/checkout/payment-group-intent', () => {
  test('503 when feature disabled', async () => {
    delete process.env['PHASE_C_GROUPS_ENABLED']
    const res = await POST(makeRequest({ token: 'x' }))
    expect(res.status).toBe(503)
  })

  test('400 when token missing', async () => {
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)
  })

  test('400 when email malformed', async () => {
    const res = await POST(makeRequest({ token: 'x', email: 'not-an-email' }))
    expect(res.status).toBe(400)
  })

  test('400 when email is .invalid TLD', async () => {
    const res = await POST(makeRequest({ token: 'x', email: 'test@example.invalid' }))
    expect(res.status).toBe(400)
  })

  test('401 when token invalid', async () => {
    verifyTokenMock.mockResolvedValueOnce(null)
    const res = await POST(makeRequest({ token: 'bad' }))
    expect(res.status).toBe(401)
  })

  test('400 when token is solo flavor (no groupId)', async () => {
    verifyTokenMock.mockResolvedValueOnce({
      orderId:   'some-order',
      patientId: PATIENT_ID,
      clinicId:  TEST_CLINIC_ID,
      iat:       0,
      exp:       9999999999,
    })
    const res = await POST(makeRequest({ token: 'solo' }))
    expect(res.status).toBe(400)
  })

  test('404 when group not found', async () => {
    groupFetchMock.mockResolvedValueOnce({ data: null, error: null })
    const res = await POST(makeRequest({ token: 'x' }))
    expect(res.status).toBe(404)
  })

  test('409 when group already PAID', async () => {
    groupFetchMock.mockResolvedValueOnce({
      data: { group_id: GROUP_ID, status: 'PAID', total_cents: 1000, stripe_payment_intent_id: 'pi_x', clinic_id: TEST_CLINIC_ID },
      error: null,
    })
    const res = await POST(makeRequest({ token: 'x' }))
    expect(res.status).toBe(409)
  })

  test('500 when group has no stripe_payment_intent_id', async () => {
    groupFetchMock.mockResolvedValueOnce({
      data: { group_id: GROUP_ID, status: 'AWAITING_PAYMENT', total_cents: 1000, stripe_payment_intent_id: null, clinic_id: TEST_CLINIC_ID },
      error: null,
    })
    const res = await POST(makeRequest({ token: 'x' }))
    expect(res.status).toBe(500)
  })

  test('410 when PI is cancelled', async () => {
    groupFetchMock.mockResolvedValueOnce({
      data: { group_id: GROUP_ID, status: 'AWAITING_PAYMENT', total_cents: 1000, stripe_payment_intent_id: 'pi_x', clinic_id: TEST_CLINIC_ID },
      error: null,
    })
    orderCountMock.mockResolvedValueOnce({ count: 2, error: null })
    stripeRetrieveMock.mockResolvedValueOnce({ id: 'pi_x', client_secret: 'cs_x', status: 'canceled', receipt_email: null })

    const res = await POST(makeRequest({ token: 'x' }))
    expect(res.status).toBe(410)
  })

  test('happy path: returns clientSecret, totalCents, orderCount', async () => {
    groupFetchMock.mockResolvedValueOnce({
      data: { group_id: GROUP_ID, status: 'AWAITING_PAYMENT', total_cents: 17500, stripe_payment_intent_id: 'pi_x', clinic_id: TEST_CLINIC_ID },
      error: null,
    })
    orderCountMock.mockResolvedValueOnce({ count: 2, error: null })
    stripeRetrieveMock.mockResolvedValueOnce({ id: 'pi_x', client_secret: 'cs_secret', status: 'requires_payment_method', receipt_email: null })

    const res = await POST(makeRequest({ token: 'x' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.clientSecret).toBe('cs_secret')
    expect(body.totalCents).toBe(17500)
    expect(body.orderCount).toBe(2)
  })

  test('attaches receipt_email when supplied and differs', async () => {
    groupFetchMock.mockResolvedValueOnce({
      data: { group_id: GROUP_ID, status: 'AWAITING_PAYMENT', total_cents: 100, stripe_payment_intent_id: 'pi_x', clinic_id: TEST_CLINIC_ID },
      error: null,
    })
    orderCountMock.mockResolvedValueOnce({ count: 1, error: null })
    stripeRetrieveMock.mockResolvedValueOnce({ id: 'pi_x', client_secret: 'cs_secret', status: 'requires_payment_method', receipt_email: null })
    stripeUpdateMock.mockResolvedValueOnce({})

    const res = await POST(makeRequest({ token: 'x', email: 'patient@example.com' }))
    expect(res.status).toBe(200)
    expect(stripeUpdateMock).toHaveBeenCalledWith('pi_x', { receipt_email: 'patient@example.com' })
  })
})
