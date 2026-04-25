/**
 * @jest-environment node
 *
 * Regression test for the DELETE /api/favorites?id=xxx clinic-scope
 * guard (PR #19). Before this PR, DELETE only verified that the
 * caller had a session — it did not verify that the favorite being
 * deleted belonged to a provider in the caller's clinic. Anyone
 * logged in could delete any favorite by guessing its UUID.
 *
 * The POST handler already had this scoping (route.ts:82); DELETE
 * now matches. These tests lock the contract in so a future refactor
 * can't quietly drop the cross-clinic check.
 */

import { DELETE } from '../route'
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

// ── Helpers ──────────────────────────────────────────────────

function makeRequest(id?: string | null): NextRequest {
  const url = id == null
    ? 'http://localhost/api/favorites'
    : `http://localhost/api/favorites?id=${id}`
  return new NextRequest(new URL(url), { method: 'DELETE' })
}

const FAV_ID         = 'fav-uuid-123'
const PROVIDER_IN    = 'provider-in-clinic'
const PROVIDER_OUT   = 'provider-other-clinic'
const CALLER_CLINIC  = 'clinic-A'

const SESSION_IN_CLINIC = {
  data: { session: { user: { user_metadata: { clinic_id: CALLER_CLINIC } } } },
}

const SESSION_NO_CLINIC = {
  data: { session: { user: { user_metadata: {} } } },
}

beforeEach(() => {
  jest.clearAllMocks()
})

// ── Tests ────────────────────────────────────────────────────

describe('DELETE /api/favorites — clinic-scope guard', () => {
  it('returns 401 when no session', async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } })

    const res = await DELETE(makeRequest(FAV_ID))
    expect(res.status).toBe(401)
  })

  it('returns 403 when session has no clinic_id', async () => {
    getSessionMock.mockResolvedValue(SESSION_NO_CLINIC)

    const res = await DELETE(makeRequest(FAV_ID))
    expect(res.status).toBe(403)
  })

  it('returns 400 when id query param is missing', async () => {
    getSessionMock.mockResolvedValue(SESSION_IN_CLINIC)

    const res = await DELETE(makeRequest(null))
    expect(res.status).toBe(400)
  })

  it('returns 404 when favorite does not exist', async () => {
    getSessionMock.mockResolvedValue(SESSION_IN_CLINIC)
    fromMock.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    }))

    const res = await DELETE(makeRequest(FAV_ID))
    expect(res.status).toBe(404)
  })

  it('returns 403 when favorite belongs to a provider in another clinic', async () => {
    getSessionMock.mockResolvedValue(SESSION_IN_CLINIC)
    fromMock.mockImplementation((table: string) => {
      if (table === 'provider_favorites') {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({
                data: { provider_id: PROVIDER_OUT },
                error: null,
              }),
            }),
          }),
          delete: () => ({
            eq: () => Promise.resolve({ error: null }),
          }),
        }
      }
      if (table === 'providers') {
        // Caller's clinic owns PROVIDER_IN only — not PROVIDER_OUT
        return {
          select: () => ({
            eq: () => Promise.resolve({
              data: [{ provider_id: PROVIDER_IN }],
              error: null,
            }),
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    })

    const res = await DELETE(makeRequest(FAV_ID))
    expect(res.status).toBe(403)
  })

  it('returns 200 when favorite belongs to a provider in caller\'s clinic', async () => {
    getSessionMock.mockResolvedValue(SESSION_IN_CLINIC)

    const deleteEqSpy = jest.fn(() => Promise.resolve({ error: null }))

    fromMock.mockImplementation((table: string) => {
      if (table === 'provider_favorites') {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({
                data: { provider_id: PROVIDER_IN },
                error: null,
              }),
            }),
          }),
          delete: () => ({ eq: deleteEqSpy }),
        }
      }
      if (table === 'providers') {
        return {
          select: () => ({
            eq: () => Promise.resolve({
              data: [{ provider_id: PROVIDER_IN }],
              error: null,
            }),
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    })

    const res = await DELETE(makeRequest(FAV_ID))
    expect(res.status).toBe(200)
    expect(deleteEqSpy).toHaveBeenCalledWith('favorite_id', FAV_ID)
  })
})
