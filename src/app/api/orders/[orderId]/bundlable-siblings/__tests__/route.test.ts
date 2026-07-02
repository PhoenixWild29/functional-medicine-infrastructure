/**
 * @jest-environment node
 *
 * Tests for Phase C Stage 4 — GET /api/orders/[orderId]/bundlable-siblings.
 *
 * Coverage:
 *   - Feature flag (503 when off)
 *   - Auth gate (401)
 *   - Role gate (403)
 *   - Anchor not bundlable (reason variants)
 *   - Happy path: returns siblings
 *   - Excludes anchor from peers
 */

import { GET } from '../route'

const TEST_CLINIC_ID    = 'aaaaaaaa-aaaa-4aaa-9aaa-aaaaaaaaaaaa'
const TEST_PATIENT_ID   = 'bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb'
const TEST_PROVIDER_ID  = 'eeeeeeee-eeee-4eee-9eee-eeeeeeeeeeee'
const ORDER_ID          = '11111111-1111-4111-9111-111111111111'
const SIBLING_ID        = '22222222-2222-4222-9222-222222222222'

const getSessionMock  = jest.fn()
const anchorFetchMock = jest.fn()
const peersFetchMock  = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockResolvedValue({
    auth: { getSession: () => getSessionMock() },
  }),
}))

// Build a recursive chain stub. Every chained method returns the same
// object, so any combination of .eq().is().neq().order().maybeSingle()
// works. Terminal calls (.maybeSingle / .order) return the appropriate
// mock based on whether we're on the anchor path (single row) or peers
// path (list).
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn().mockReturnValue({
    from: () => {
      let isAnchorPath = false
      const builder: Record<string, unknown> = {}
      const chain = (col?: string, val?: unknown) => {
        if (col === 'order_id' && typeof val === 'string') {
          isAnchorPath = true
        }
        return builder
      }
      builder['select']      = chain
      builder['eq']          = chain
      builder['is']          = chain
      builder['neq']         = chain
      builder['order']       = () => peersFetchMock()
      builder['maybeSingle'] = () => (isAnchorPath ? anchorFetchMock() : peersFetchMock())
      return builder
    },
  }),
}))

function makeRequest(): import('next/server').NextRequest {
  return {} as unknown as import('next/server').NextRequest
}

function makeParams(orderId: string) {
  return { params: Promise.resolve({ orderId }) }
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env['PHASE_C_GROUPS_ENABLED'] = 'true'
  getSessionMock.mockResolvedValue({
    data: { session: { user: { id: 'auth-uid', user_metadata: { app_role: 'clinic_admin', clinic_id: TEST_CLINIC_ID } } } },
  })
})

afterAll(() => {
  delete process.env['PHASE_C_GROUPS_ENABLED']
})

describe('GET /api/orders/[orderId]/bundlable-siblings', () => {
  test('503 when feature disabled', async () => {
    delete process.env['PHASE_C_GROUPS_ENABLED']
    const res = await GET(makeRequest(), makeParams(ORDER_ID))
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.reason).toBe('feature_disabled')
  })

  test('400 when orderId not a UUID', async () => {
    const res = await GET(makeRequest(), makeParams('not-a-uuid'))
    expect(res.status).toBe(400)
  })

  test('401 when no session', async () => {
    getSessionMock.mockResolvedValueOnce({ data: { session: null } })
    const res = await GET(makeRequest(), makeParams(ORDER_ID))
    expect(res.status).toBe(401)
  })

  test('403 when role is ops_admin', async () => {
    getSessionMock.mockResolvedValueOnce({
      data: { session: { user: { id: 'u', user_metadata: { app_role: 'ops_admin', clinic_id: TEST_CLINIC_ID } } } },
    })
    const res = await GET(makeRequest(), makeParams(ORDER_ID))
    expect(res.status).toBe(403)
  })

  test('404 when anchor order not found', async () => {
    anchorFetchMock.mockResolvedValueOnce({ data: null, error: null })
    const res = await GET(makeRequest(), makeParams(ORDER_ID))
    expect(res.status).toBe(404)
  })

  test('anchorBundlable=false when order already grouped', async () => {
    anchorFetchMock.mockResolvedValueOnce({
      data: {
        order_id:                ORDER_ID,
        status:                  'AWAITING_PAYMENT',
        patient_id:              TEST_PATIENT_ID,
        provider_id:             TEST_PROVIDER_ID,
        clinic_id:               TEST_CLINIC_ID,
        payment_group_id:        'some-group-uuid',
        stripe_payment_intent_id: null,
        medication_snapshot:     { name: 'Foo' },
        retail_price_snapshot:   100,
        created_at:              '2026-06-11T00:00:00Z',
      },
      error: null,
    })
    const res = await GET(makeRequest(), makeParams(ORDER_ID))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.anchorBundlable).toBe(false)
    expect(body.reason).toBe('already_grouped')
    expect(body.siblings).toEqual([])
  })

  test('anchorBundlable=false when solo PI exists', async () => {
    anchorFetchMock.mockResolvedValueOnce({
      data: {
        order_id:                ORDER_ID,
        status:                  'AWAITING_PAYMENT',
        patient_id:              TEST_PATIENT_ID,
        provider_id:             TEST_PROVIDER_ID,
        clinic_id:               TEST_CLINIC_ID,
        payment_group_id:        null,
        stripe_payment_intent_id: 'pi_existing',
        medication_snapshot:     { name: 'Foo' },
        retail_price_snapshot:   100,
        created_at:              '2026-06-11T00:00:00Z',
      },
      error: null,
    })
    const res = await GET(makeRequest(), makeParams(ORDER_ID))
    const body = await res.json()
    expect(body.anchorBundlable).toBe(false)
    expect(body.reason).toBe('solo_pi_exists')
  })

  test('happy path: returns anchor + sibling list', async () => {
    anchorFetchMock.mockResolvedValueOnce({
      data: {
        order_id:                ORDER_ID,
        status:                  'AWAITING_PAYMENT',
        patient_id:              TEST_PATIENT_ID,
        provider_id:             TEST_PROVIDER_ID,
        clinic_id:               TEST_CLINIC_ID,
        payment_group_id:        null,
        stripe_payment_intent_id: null,
        medication_snapshot:     { name: 'Anchor Med' },
        retail_price_snapshot:   100,
        created_at:              '2026-06-11T00:00:00Z',
      },
      error: null,
    })
    peersFetchMock.mockResolvedValueOnce({
      data: [
        {
          order_id:              SIBLING_ID,
          medication_snapshot:   { name: 'Sibling Med' },
          retail_price_snapshot: 75,
          created_at:            '2026-06-11T01:00:00Z',
        },
      ],
      error: null,
    })

    const res = await GET(makeRequest(), makeParams(ORDER_ID))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.anchorBundlable).toBe(true)
    expect(body.anchor.orderId).toBe(ORDER_ID)
    expect(body.anchor.medicationName).toBe('Anchor Med')
    expect(body.siblings).toHaveLength(1)
    expect(body.siblings[0].orderId).toBe(SIBLING_ID)
    expect(body.siblings[0].medicationName).toBe('Sibling Med')
  })

  test('falls back to generic medication name when snapshot missing', async () => {
    anchorFetchMock.mockResolvedValueOnce({
      data: {
        order_id:                ORDER_ID,
        status:                  'AWAITING_PAYMENT',
        patient_id:              TEST_PATIENT_ID,
        provider_id:             TEST_PROVIDER_ID,
        clinic_id:               TEST_CLINIC_ID,
        payment_group_id:        null,
        stripe_payment_intent_id: null,
        medication_snapshot:     null,
        retail_price_snapshot:   100,
        created_at:              '2026-06-11T00:00:00Z',
      },
      error: null,
    })
    peersFetchMock.mockResolvedValueOnce({ data: [], error: null })

    const res = await GET(makeRequest(), makeParams(ORDER_ID))
    const body = await res.json()
    expect(body.anchor.medicationName).toBe('Compounded prescription')
    expect(body.siblings).toEqual([])
  })
})
