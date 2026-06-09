/**
 * @jest-environment node
 *
 * Regression test for the LF-1 catalog-sync fix.
 *
 * Before this fix, the route read `pharmacies.api_base_url` — a column
 * that does not exist in the schema. The read was masked by an
 * `as unknown as Record<string, unknown>` cast, so TypeScript never
 * caught it; at runtime every sync attempt resolved `apiBase` to
 * undefined and returned 409 "Pharmacy has no API base URL configured".
 *
 * The actual base URL lives on pharmacy_api_configs.base_url (a 1:N
 * child table). This test locks the fix in by asserting:
 *   - tier mismatch (TIER_4_FAX) → 409 BEFORE any api_configs lookup
 *   - active api_config missing → 409 with the corrected error string
 *
 * Full sync-path coverage (fetch → upsert → history) is intentionally
 * out of scope — that flow has never had unit tests and adding them
 * here would balloon the PR. LF-2 (mocked contract test for the
 * LifeFile transformer/parser pair) is the higher-leverage follow-up.
 */

import { POST } from '../route'

// ── Helpers ────────────────────────────────────────────────────────

const TEST_PHARMACY_ID = '11111111-1111-4111-9111-111111111111'

function makeParams() {
  return { params: Promise.resolve({ pharmacyId: TEST_PHARMACY_ID }) }
}

function makeRequest(): import('next/server').NextRequest {
  return {} as unknown as import('next/server').NextRequest
}

// ── Mocks ──────────────────────────────────────────────────────────

const getSessionMock = jest.fn()
const pharmacyFetchMock = jest.fn()
const apiConfigFetchMock = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockResolvedValue({
    auth: { getSession: () => getSessionMock() },
  }),
}))

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn().mockReturnValue({
    from: (table: string) => {
      if (table === 'pharmacies') {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                maybeSingle: () => pharmacyFetchMock(),
              }),
            }),
          }),
        }
      }
      if (table === 'pharmacy_api_configs') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => apiConfigFetchMock(),
              }),
            }),
          }),
        }
      }
      throw new Error(`Unexpected table query in test: ${table}`)
    },
  }),
}))

// ── Setup ──────────────────────────────────────────────────────────

beforeEach(() => {
  getSessionMock.mockReset()
  pharmacyFetchMock.mockReset()
  apiConfigFetchMock.mockReset()
})

function mockOpsAdminSession() {
  getSessionMock.mockResolvedValue({
    data: {
      session: {
        user: {
          email: 'ops@example.test',
          id: 'user-ops',
          user_metadata: { app_role: 'ops_admin' },
        },
      },
    },
  })
}

// ── Tests ──────────────────────────────────────────────────────────

describe('POST /api/ops/catalog/sync/[pharmacyId] — LF-1 regression', () => {
  it('returns 409 with tier-not-supported BEFORE consulting pharmacy_api_configs', async () => {
    mockOpsAdminSession()
    pharmacyFetchMock.mockResolvedValue({
      data: {
        pharmacy_id: TEST_PHARMACY_ID,
        name: 'Tier 4 Pharmacy',
        integration_tier: 'TIER_4_FAX',
      },
      error: null,
    })

    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(409)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/TIER_4_FAX/)
    // Critical: the api_config lookup must NOT have been called for non-API tiers
    expect(apiConfigFetchMock).not.toHaveBeenCalled()
  })

  it('returns 409 with corrected error when an API-tier pharmacy has no active config', async () => {
    mockOpsAdminSession()
    pharmacyFetchMock.mockResolvedValue({
      data: {
        pharmacy_id: TEST_PHARMACY_ID,
        name: 'Tier 1 API Pharmacy',
        integration_tier: 'TIER_1_API',
      },
      error: null,
    })
    apiConfigFetchMock.mockResolvedValue({ data: null, error: null })

    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(409)
    const body = await res.json() as { error: string }
    // The new error message references pharmacy_api_configs, not the old
    // (and incorrect) "no API base URL configured" string. Locking the
    // wording in catches a regression where someone "helpfully" reverts
    // to reading pharmacies.<something> again.
    expect(body.error).toMatch(/pharmacy_api_configs/)
    expect(apiConfigFetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns 401 for unauthenticated request and does not touch the DB', async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } })

    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(401)
    expect(pharmacyFetchMock).not.toHaveBeenCalled()
    expect(apiConfigFetchMock).not.toHaveBeenCalled()
  })

  it('returns 403 for non-ops_admin session', async () => {
    getSessionMock.mockResolvedValue({
      data: {
        session: {
          user: {
            email: 'clinic@example.test',
            id: 'user-clinic',
            user_metadata: { app_role: 'clinic_admin' },
          },
        },
      },
    })

    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(403)
    expect(pharmacyFetchMock).not.toHaveBeenCalled()
  })

  it('returns 400 when pharmacyId is not a UUID', async () => {
    mockOpsAdminSession()
    const res = await POST(
      makeRequest(),
      { params: Promise.resolve({ pharmacyId: 'not-a-uuid' }) },
    )
    expect(res.status).toBe(400)
    expect(pharmacyFetchMock).not.toHaveBeenCalled()
  })
})
