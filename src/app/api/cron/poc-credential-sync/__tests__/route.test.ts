/**
 * @jest-environment node
 *
 * Regression test for GET /api/cron/poc-credential-sync (PR #12).
 *
 * This is THE test that locks in the cowork round-4 bug class.
 * F6 reached prod because the cron handler returned 200 when
 * refreshDemoData() silently skipped due to POC_MODE being unset
 * — the skip looked identical to a successful sync in HTTP
 * telemetry, so nobody noticed the demo was running against stale
 * (or absent) seed data until an investor walkthrough.
 *
 * Specifically guards:
 *   - CRON_SECRET gating (401 without header; 200/500 only when
 *     authenticated)
 *   - A successful refresh returns 200
 *   - A credential-only failure returns 500
 *   - A demo-data-refresh-only failure (ok:false on that sub-op)
 *     returns 500 — NOT 200 — and fires Sentry.captureException
 *   - A POC_MODE short-circuit (skipped:'not_poc_mode') returns
 *     500 — NOT 200 — and fires Sentry.captureException
 *
 * Despite the route's misleading name (it does credential sync
 * AND demo-data refresh since PR #5 + #9; rename deferred — see
 * the route file's header comment), both sub-ops are gated
 * together here.
 */

import type { NextRequest } from 'next/server'
import { GET } from '../route'

// ── Mocks ────────────────────────────────────────────────────

const syncPocCredentialsMock = jest.fn()
const captureExceptionMock = jest.fn()

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn().mockReturnValue({}),
}))

jest.mock('@/lib/poc/sync-credentials', () => ({
  syncPocCredentials: (...args: unknown[]) => syncPocCredentialsMock(...args),
}))

jest.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}))

// ── Helpers ──────────────────────────────────────────────────

const ORIGINAL_CRON_SECRET = process.env['CRON_SECRET']

function mockRequest(authHeader: string | null): NextRequest {
  return {
    headers: {
      get: (name: string) => (name.toLowerCase() === 'authorization' ? authHeader : null),
    },
  } as unknown as NextRequest
}

const CRON_SECRET = 'test-cron-secret'
const AUTH_OK     = `Bearer ${CRON_SECRET}`

beforeEach(() => {
  syncPocCredentialsMock.mockReset()
  captureExceptionMock.mockReset()
  process.env['CRON_SECRET'] = CRON_SECRET
})

afterAll(() => {
  if (ORIGINAL_CRON_SECRET === undefined) {
    delete process.env['CRON_SECRET']
  } else {
    process.env['CRON_SECRET'] = ORIGINAL_CRON_SECRET
  }
})

// ── Tests ────────────────────────────────────────────────────

describe('GET /api/cron/poc-credential-sync auth', () => {
  it('rejects request with no Authorization header → 401', async () => {
    const res = await GET(mockRequest(null))
    expect(res.status).toBe(401)
    expect(syncPocCredentialsMock).not.toHaveBeenCalled()
  })

  it('rejects wrong bearer token → 401', async () => {
    const res = await GET(mockRequest('Bearer wrong-secret'))
    expect(res.status).toBe(401)
    expect(syncPocCredentialsMock).not.toHaveBeenCalled()
  })
})

describe('GET /api/cron/poc-credential-sync success path', () => {
  it('returns 200 when credentials AND demo-data refresh both OK', async () => {
    syncPocCredentialsMock.mockResolvedValue({
      ran_at:  '2026-04-23T10:00:00.000Z',
      ok:      true,
      results: [{ label: 'ops_admin', email: 'ops@test', action: 'synced' }],
      demo_data_refresh: {
        ran_at:           '2026-04-23T10:00:00.100Z',
        ok:               true,
        scaffolding:      { action: 'already_exists' },
        e2e_leak_cleanup: { action: 'clean', soft_deleted: 0 },
        fax_seed:         { pre_delete: 4, post_delete: 0, inserted: 4, action: 'refreshed' },
        submission_seed:  { pre_delete: 200, post_delete: 0, inserted: 200, action: 'refreshed' },
      },
    })

    const res  = await GET(mockRequest(AUTH_OK))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.demo_data_refresh?.ok).toBe(true)
    expect(captureExceptionMock).not.toHaveBeenCalled()
  })
})

describe('GET /api/cron/poc-credential-sync failure paths (F6 regression guards)', () => {
  it('returns 500 + fires Sentry when demo-data refresh silently skipped (POC_MODE unset)', async () => {
    // This is THE bug class F6 exposed. Previously this scenario
    // returned 200 because `ok` was computed ignoring `skipped`.
    syncPocCredentialsMock.mockResolvedValue({
      ran_at:  '2026-04-23T10:00:00.000Z',
      ok:      true,           // credentials still synced fine
      results: [{ label: 'ops_admin', email: 'ops@test', action: 'synced' }],
      demo_data_refresh: {
        ran_at:           '2026-04-23T10:00:00.100Z',
        ok:               false,                    // PR #9: ok false on skip
        skipped:          'not_poc_mode',
        scaffolding:      { action: 'already_exists' },
        e2e_leak_cleanup: { action: 'skipped', soft_deleted: 0 },
        fax_seed:         { pre_delete: 0, post_delete: 0, inserted: 0, action: 'skipped' },
        submission_seed:  { pre_delete: 0, post_delete: 0, inserted: 0, action: 'skipped' },
      },
    })

    const res = await GET(mockRequest(AUTH_OK))

    expect(res.status).toBe(500)
    expect(captureExceptionMock).toHaveBeenCalledTimes(1)
    const errMsg = (captureExceptionMock.mock.calls[0]![0] as Error).message
    expect(errMsg).toMatch(/demo_data_ok=false/)
  })

  it('returns 500 + fires Sentry when demo-data refresh fails (execution error)', async () => {
    syncPocCredentialsMock.mockResolvedValue({
      ran_at:  '2026-04-23T10:00:00.000Z',
      ok:      true,
      results: [{ label: 'ops_admin', email: 'ops@test', action: 'synced' }],
      demo_data_refresh: {
        ran_at:           '2026-04-23T10:00:00.100Z',
        ok:               false,
        scaffolding:      { action: 'error', error: 'clinic insert: constraint violation' },
        e2e_leak_cleanup: { action: 'clean', soft_deleted: 0 },
        fax_seed:         { pre_delete: 0, post_delete: 0, inserted: 0, action: 'aborted', error: 'bad' },
        submission_seed:  { pre_delete: 0, post_delete: 0, inserted: 0, action: 'aborted', error: 'bad' },
      },
    })

    const res = await GET(mockRequest(AUTH_OK))

    expect(res.status).toBe(500)
    expect(captureExceptionMock).toHaveBeenCalledTimes(1)
  })

  it('returns 500 + fires Sentry when credentials fail (ok:false)', async () => {
    syncPocCredentialsMock.mockResolvedValue({
      ran_at:  '2026-04-23T10:00:00.000Z',
      ok:      false,
      results: [{ label: 'ops_admin', email: 'ops@test', action: 'skipped', error: 'auth API down' }],
      demo_data_refresh: {
        ran_at:           '2026-04-23T10:00:00.100Z',
        ok:               true,
        scaffolding:      { action: 'already_exists' },
        e2e_leak_cleanup: { action: 'clean', soft_deleted: 0 },
        fax_seed:         { pre_delete: 4, post_delete: 0, inserted: 4, action: 'refreshed' },
        submission_seed:  { pre_delete: 200, post_delete: 0, inserted: 200, action: 'refreshed' },
      },
    })

    const res = await GET(mockRequest(AUTH_OK))

    expect(res.status).toBe(500)
    expect(captureExceptionMock).toHaveBeenCalledTimes(1)
    const errMsg = (captureExceptionMock.mock.calls[0]![0] as Error).message
    expect(errMsg).toMatch(/credentials_ok=false/)
  })
})
