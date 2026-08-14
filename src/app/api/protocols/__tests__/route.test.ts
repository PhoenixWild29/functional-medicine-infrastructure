/**
 * @jest-environment node
 *
 * Tests for the GET /api/protocols?id=xxx pricing enrichment (WO-85 fix).
 *
 * Protocol items carry no price of their own. The detail response must
 * resolve each item's LIVE pharmacy_formulations wholesale_price (active,
 * available, not soft-deleted), a formulation_active flag, and the
 * clinic's default_markup_pct — so the client computes real wholesale/
 * retail cents instead of the old $0.00 stubs that could flow into
 * signable orders.
 */

import { GET } from '../route'
import { NextRequest } from 'next/server'

// ── Mocks ────────────────────────────────────────────────────

const getSessionMock = jest.fn()
const fromMock       = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockResolvedValue({
    auth: { getSession: () => getSessionMock() },
  }),
}))

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn(() => ({
    from: (table: string) => fromMock(table),
  })),
}))

// ── Chainable query stub ─────────────────────────────────────
// Every builder method returns the chain; awaiting it (or calling
// single/maybeSingle) resolves to the provided result.

interface ChainResult {
  data: unknown
  error: { message: string } | null
}

interface QueryChain {
  select: jest.Mock
  eq: jest.Mock
  in: jest.Mock
  is: jest.Mock
  order: jest.Mock
  single: () => Promise<ChainResult>
  maybeSingle: () => Promise<ChainResult>
  then: (onfulfilled: (value: ChainResult) => unknown) => Promise<unknown>
}

function chain(result: ChainResult): QueryChain {
  const c = {} as QueryChain
  c.select = jest.fn(() => c)
  c.eq = jest.fn(() => c)
  c.in = jest.fn(() => c)
  c.is = jest.fn(() => c)
  c.order = jest.fn(() => c)
  c.single = () => Promise.resolve(result)
  c.maybeSingle = () => Promise.resolve(result)
  c.then = onfulfilled => Promise.resolve(result).then(onfulfilled)
  return c
}

// ── Helpers ──────────────────────────────────────────────────

const CLINIC = 'clinic-A'

const SESSION_IN_CLINIC = {
  data: { session: { user: { user_metadata: { clinic_id: CLINIC } } } },
}

function makeRequest(id?: string): NextRequest {
  const url = id
    ? `http://localhost/api/protocols?id=${id}`
    : 'http://localhost/api/protocols'
  return new NextRequest(new URL(url))
}

beforeEach(() => {
  jest.clearAllMocks()
})

// ── Tests ────────────────────────────────────────────────────

describe('GET /api/protocols?id — live pricing enrichment', () => {
  it('returns 401 without a session', async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } })

    const res = await GET(makeRequest('proto-1'))
    expect(res.status).toBe(401)
  })

  it('returns 403 when session has no clinic_id', async () => {
    getSessionMock.mockResolvedValue({
      data: { session: { user: { user_metadata: {} } } },
    })

    const res = await GET(makeRequest('proto-1'))
    expect(res.status).toBe(403)
  })

  it('resolves live wholesale_price + formulation_active per item and returns the clinic default markup', async () => {
    getSessionMock.mockResolvedValue(SESSION_IN_CLINIC)

    const items = [
      { item_id: 'i1', formulation_id: 'form-live', pharmacy_id: 'ph-1', sort_order: 1 },
      { item_id: 'i2', formulation_id: 'form-dead', pharmacy_id: 'ph-1', sort_order: 2 },
    ]

    fromMock.mockImplementation((table: string) => {
      switch (table) {
        case 'protocol_templates':
          return chain({ data: { protocol_id: 'proto-1', name: 'Test Protocol' }, error: null })
        case 'protocol_items':
          return chain({ data: items, error: null })
        case 'pharmacy_formulations':
          // Only form-live still has an active + available price row
          return chain({
            data: [{ formulation_id: 'form-live', pharmacy_id: 'ph-1', wholesale_price: 45 }],
            error: null,
          })
        case 'formulations':
          // form-dead was deactivated by a catalog reseed
          return chain({ data: [{ formulation_id: 'form-live' }], error: null })
        case 'clinics':
          return chain({ data: { default_markup_pct: 100 }, error: null })
        default:
          throw new Error(`unexpected table ${table}`)
      }
    })

    const res = await GET(makeRequest('proto-1'))
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.data.default_markup_pct).toBe(100)
    expect(json.data.items).toHaveLength(2)

    const [live, dead] = json.data.items
    expect(live).toMatchObject({
      item_id: 'i1',
      wholesale_price: 45,
      formulation_active: true,
    })
    expect(dead).toMatchObject({
      item_id: 'i2',
      wholesale_price: null,
      formulation_active: false,
    })
  })

  it('returns items with null price and inactive flag when the protocol has no live offerings at all', async () => {
    getSessionMock.mockResolvedValue(SESSION_IN_CLINIC)

    fromMock.mockImplementation((table: string) => {
      switch (table) {
        case 'protocol_templates':
          return chain({ data: { protocol_id: 'proto-1', name: 'Stale Protocol' }, error: null })
        case 'protocol_items':
          return chain({
            data: [{ item_id: 'i1', formulation_id: 'form-dead', pharmacy_id: 'ph-1', sort_order: 1 }],
            error: null,
          })
        case 'pharmacy_formulations':
          return chain({ data: [], error: null })
        case 'formulations':
          return chain({ data: [], error: null })
        case 'clinics':
          return chain({ data: null, error: null })
        default:
          throw new Error(`unexpected table ${table}`)
      }
    })

    const res = await GET(makeRequest('proto-1'))
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.data.default_markup_pct).toBeNull()
    expect(json.data.items[0]).toMatchObject({
      wholesale_price: null,
      formulation_active: false,
    })
  })
})
