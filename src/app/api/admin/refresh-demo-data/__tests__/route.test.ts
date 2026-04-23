/**
 * @jest-environment node
 *
 * Regression test for the status-code contract on
 * POST + GET /api/admin/refresh-demo-data (PR #12).
 *
 * PR #9 introduced a three-way status-code contract for the POST
 * method to distinguish configuration errors from execution errors
 * from successful refreshes:
 *
 *   200 — full success (report.ok === true)
 *   428 Precondition Required — skipped: 'not_poc_mode'
 *         (configuration problem, don't retry)
 *   500 — execution error (report.ok === false without skip)
 *
 * These tests lock the contract in so a future refactor can't
 * silently collapse 428 back into 200 (the original F6 bug class)
 * or into 500 (which would mask the specific "POC_MODE is unset"
 * diagnostic signal).
 *
 * Also covers the PR #9 GET endpoint which returns the last-refresh
 * timestamp for the RefreshDemoDataCard freshness indicator.
 */

import { GET, POST } from '../route'

// ── Mocks ────────────────────────────────────────────────────

const getSessionMock       = jest.fn()
const refreshDemoDataMock  = jest.fn()
const statusQueryMock      = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockResolvedValue({
    auth: { getSession: () => getSessionMock() },
  }),
}))

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn().mockReturnValue({
    from: () => ({
      select: () => ({
        contains: () => ({
          in: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: () => statusQueryMock(),
              }),
            }),
          }),
        }),
      }),
    }),
  }),
}))

jest.mock('@/lib/poc/refresh-demo-data', () => ({
  refreshDemoData: (...args: unknown[]) => refreshDemoDataMock(...args),
  POC_SEED_METADATA_MARKER: { poc_seed: true },
  DEMO_PHARMACIES: [
    { id: 'a4000000-0000-0000-0000-000000000001' },
    { id: 'a4000000-0000-0000-0000-000000000002' },
    { id: 'a4000000-0000-0000-0000-000000000003' },
    { id: 'a4000000-0000-0000-0000-000000000004' },
    { id: 'a4000000-0000-0000-0000-000000000005' },
  ],
}))

// ── Helpers ──────────────────────────────────────────────────

const ORIGINAL_POC_MODE = process.env['POC_MODE']

const OPS_SESSION = {
  data: {
    session: {
      user: { user_metadata: { app_role: 'ops_admin' } },
    },
  },
}

const CLINIC_SESSION = {
  data: {
    session: {
      user: { user_metadata: { app_role: 'clinic_admin' } },
    },
  },
}

beforeEach(() => {
  getSessionMock.mockReset()
  refreshDemoDataMock.mockReset()
  statusQueryMock.mockReset()
})

afterAll(() => {
  if (ORIGINAL_POC_MODE === undefined) {
    delete process.env['POC_MODE']
  } else {
    process.env['POC_MODE'] = ORIGINAL_POC_MODE
  }
})

// ── Auth tests ───────────────────────────────────────────────

describe('POST /api/admin/refresh-demo-data — auth', () => {
  it('returns 401 when no session', async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } })
    const res = await POST()
    expect(res.status).toBe(401)
    expect(refreshDemoDataMock).not.toHaveBeenCalled()
  })

  it('returns 403 for non-ops_admin role', async () => {
    getSessionMock.mockResolvedValue(CLINIC_SESSION)
    const res = await POST()
    expect(res.status).toBe(403)
    expect(refreshDemoDataMock).not.toHaveBeenCalled()
  })
})

// ── Status-code contract (PR #9 F6 regression guards) ───────

describe('POST /api/admin/refresh-demo-data — status-code contract', () => {
  beforeEach(() => {
    getSessionMock.mockResolvedValue(OPS_SESSION)
  })

  it('returns 200 on full success (ok:true)', async () => {
    refreshDemoDataMock.mockResolvedValue({
      ran_at:      '2026-04-23T10:00:00.000Z',
      ok:          true,
      scaffolding: { action: 'already_exists' },
      e2e_leak_cleanup: { action: 'clean', soft_deleted: 0 },
      fax_seed:         { pre_delete: 4, post_delete: 0, inserted: 4, action: 'refreshed' },
      submission_seed:  { pre_delete: 200, post_delete: 0, inserted: 200, action: 'refreshed' },
    })
    const res = await POST()
    expect(res.status).toBe(200)
  })

  it('returns 428 Precondition Required when skipped: not_poc_mode', async () => {
    // PR #9 contract: 428 distinguishes "config problem, don't
    // retry" from "execution error, might succeed on retry."
    // Previously this scenario returned 200 (bug F6 root cause).
    refreshDemoDataMock.mockResolvedValue({
      ran_at:      '2026-04-23T10:00:00.000Z',
      ok:          false,
      skipped:     'not_poc_mode',
      scaffolding: { action: 'already_exists' },
      e2e_leak_cleanup: { action: 'skipped', soft_deleted: 0 },
      fax_seed:         { pre_delete: 0, post_delete: 0, inserted: 0, action: 'skipped' },
      submission_seed:  { pre_delete: 0, post_delete: 0, inserted: 0, action: 'skipped' },
    })
    const res  = await POST()
    expect(res.status).toBe(428)
    const body = await res.json()
    expect(body.skipped).toBe('not_poc_mode')
  })

  it('returns 500 on execution error (ok:false, no skip)', async () => {
    refreshDemoDataMock.mockResolvedValue({
      ran_at:      '2026-04-23T10:00:00.000Z',
      ok:          false,
      scaffolding: { action: 'error', error: 'clinic insert: constraint violation' },
      e2e_leak_cleanup: { action: 'clean', soft_deleted: 0 },
      fax_seed:         { pre_delete: 0, post_delete: 0, inserted: 0, action: 'aborted', error: 'bad' },
      submission_seed:  { pre_delete: 0, post_delete: 0, inserted: 0, action: 'aborted', error: 'bad' },
    })
    const res = await POST()
    expect(res.status).toBe(500)
  })
})

// ── GET endpoint for last-refresh status ────────────────────

describe('GET /api/admin/refresh-demo-data — last-refresh status', () => {
  it('returns 401 when no session', async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } })
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('returns { last_refresh_at, poc_mode } for ops_admin', async () => {
    getSessionMock.mockResolvedValue(OPS_SESSION)
    statusQueryMock.mockResolvedValue({
      data: { created_at: '2026-04-23T09:58:00.000Z' },
      error: null,
    })
    process.env['POC_MODE'] = 'true'

    const res  = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.last_refresh_at).toBe('2026-04-23T09:58:00.000Z')
    expect(body.poc_mode).toBe(true)
  })

  it('returns last_refresh_at: null when no seed rows exist', async () => {
    getSessionMock.mockResolvedValue(OPS_SESSION)
    statusQueryMock.mockResolvedValue({ data: null, error: null })
    process.env['POC_MODE'] = 'true'

    const res  = await GET()
    const body = await res.json()
    expect(body.last_refresh_at).toBeNull()
    expect(body.poc_mode).toBe(true)
  })

  it('returns poc_mode: false when env is unset', async () => {
    getSessionMock.mockResolvedValue(OPS_SESSION)
    statusQueryMock.mockResolvedValue({ data: null, error: null })
    delete process.env['POC_MODE']

    const res  = await GET()
    const body = await res.json()
    expect(body.poc_mode).toBe(false)
  })
})
