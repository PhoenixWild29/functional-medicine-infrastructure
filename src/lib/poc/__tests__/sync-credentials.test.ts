/**
 * @jest-environment node
 *
 * Regression test for the POC_MODE gate on syncPocCredentials()
 * (audit X-1 follow-up, Codex Section 2 finding).
 *
 * Before this gate, the helper would happily (re)create / reset the
 * canonical POC accounts in any environment — meaning a production
 * deployment that retained an ops_admin session OR the daily cron
 * (gated only by CRON_SECRET) could mutate auth users to known
 * demo passwords.
 *
 * Contract under test:
 *   - POC_MODE !== 'true'   → returns immediately with
 *                              { ok: false, skipped: 'not_poc_mode', results: [] }
 *                              and DOES NOT touch supabase.auth.admin.
 *   - POC_MODE === 'true'   → proceeds (verified by reaching the
 *                              listUsers mock).
 *
 * Both API callers (reset-poc-credentials, cron/poc-credential-sync)
 * map skipped='not_poc_mode' to HTTP 428.
 */

import { syncPocCredentials } from '../sync-credentials'

// ── Mocks ──────────────────────────────────────────────────────────

const listUsersMock = jest.fn()

const mockSupabase = {
  auth: {
    admin: {
      listUsers: (...args: unknown[]) => listUsersMock(...args),
    },
  },
} as unknown as Parameters<typeof syncPocCredentials>[0]

// ── Setup ──────────────────────────────────────────────────────────

const ORIGINAL_POC_MODE = process.env['POC_MODE']

beforeEach(() => {
  listUsersMock.mockReset()
})

afterAll(() => {
  if (ORIGINAL_POC_MODE === undefined) {
    delete process.env['POC_MODE']
  } else {
    process.env['POC_MODE'] = ORIGINAL_POC_MODE
  }
})

// ── Tests ──────────────────────────────────────────────────────────

describe('syncPocCredentials — POC_MODE gate (audit X-1 follow-up)', () => {
  it('returns skipped=not_poc_mode and DOES NOT call auth.admin when POC_MODE is unset', async () => {
    delete process.env['POC_MODE']

    const report = await syncPocCredentials(mockSupabase)

    expect(report.skipped).toBe('not_poc_mode')
    expect(report.ok).toBe(false)
    expect(report.results).toEqual([])
    expect(listUsersMock).not.toHaveBeenCalled()
  })

  it('returns skipped=not_poc_mode when POC_MODE is empty string', async () => {
    process.env['POC_MODE'] = ''

    const report = await syncPocCredentials(mockSupabase)

    expect(report.skipped).toBe('not_poc_mode')
    expect(listUsersMock).not.toHaveBeenCalled()
  })

  it('returns skipped=not_poc_mode when POC_MODE is "false"', async () => {
    process.env['POC_MODE'] = 'false'

    const report = await syncPocCredentials(mockSupabase)

    expect(report.skipped).toBe('not_poc_mode')
    expect(listUsersMock).not.toHaveBeenCalled()
  })

  it('returns skipped=not_poc_mode when POC_MODE is "1" (no truthy coercion)', async () => {
    // Locks in the exact-string compare. A future "helpful" refactor
    // to `if (process.env.POC_MODE)` would silently enable mutation.
    process.env['POC_MODE'] = '1'

    const report = await syncPocCredentials(mockSupabase)

    expect(report.skipped).toBe('not_poc_mode')
    expect(listUsersMock).not.toHaveBeenCalled()
  })

  it('returns skipped=not_poc_mode when POC_MODE is "TRUE" (case-sensitive)', async () => {
    process.env['POC_MODE'] = 'TRUE'

    const report = await syncPocCredentials(mockSupabase)

    expect(report.skipped).toBe('not_poc_mode')
    expect(listUsersMock).not.toHaveBeenCalled()
  })

  it('PROCEEDS to listUsers when POC_MODE is exactly "true"', async () => {
    process.env['POC_MODE'] = 'true'
    listUsersMock.mockResolvedValue({
      data: { users: [] },
      error: { message: 'list users not implemented in mock — proves we got past the gate' },
    })

    const report = await syncPocCredentials(mockSupabase)

    expect(listUsersMock).toHaveBeenCalledTimes(1)
    // Helper still returns ok:false because listUsers errored in the
    // mock, but skipped is NOT set — proves we got past the gate.
    expect(report.skipped).toBeUndefined()
  })
})
