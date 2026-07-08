/**
 * @jest-environment node
 *
 * Unit test for GET /api/cron/purge-phi-debug.
 *
 * LOW from the 2026-07-02 batch review of PR #94: the retention sweep
 * had no unit coverage — specifically the 0-row delete and the
 * `deleted` count surfacing that Vercel cron logs rely on to spot
 * drift ("if the table ever stops shrinking").
 *
 * Guards:
 *   - CRON_SECRET gating (401 without/with wrong header; 500 when the
 *     secret env var itself is unset — server misconfiguration, not
 *     an auth failure)
 *   - `deleted` count is surfaced verbatim from the delete result
 *     (N rows, 0 rows, and null count → 0)
 *   - the delete targets adapter_submission_debug_payloads with a
 *     created_at < cutoff predicate where cutoff ≈ now − 24h
 *   - delete failure → 500 with the error message
 *   - non-GET methods → 405
 */

import type { NextRequest } from 'next/server'
import { GET, POST, PUT, PATCH, DELETE } from '../route'

// ── Mocks ──────────────────────────────────────────────────────────────────

const deleteLtMock = jest.fn()
let lastFromTable: string | null = null
let lastDeleteOptions: unknown = null
let lastLtColumn: string | null = null
let lastLtCutoff: string | null = null

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn().mockReturnValue({
    from: (table: string) => {
      lastFromTable = table
      return {
        delete: (options: unknown) => {
          lastDeleteOptions = options
          return {
            lt: (column: string, cutoff: string) => {
              lastLtColumn = column
              lastLtCutoff = cutoff
              return deleteLtMock(table, column, cutoff)
            },
          }
        },
      }
    },
  }),
}))

// ── Helpers ──────────────────────────────────────────────────────────────

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
const RETENTION_MS = 24 * 60 * 60 * 1000

beforeEach(() => {
  deleteLtMock.mockReset()
  lastFromTable = null
  lastDeleteOptions = null
  lastLtColumn = null
  lastLtCutoff = null
  process.env['CRON_SECRET'] = CRON_SECRET
})

afterAll(() => {
  if (ORIGINAL_CRON_SECRET === undefined) {
    delete process.env['CRON_SECRET']
  } else {
    process.env['CRON_SECRET'] = ORIGINAL_CRON_SECRET
  }
})

// ── Tests ──────────────────────────────────────────────────────────────────

describe('GET /api/cron/purge-phi-debug auth', () => {
  it('rejects request with no Authorization header → 401', async () => {
    const res = await GET(mockRequest(null))
    expect(res.status).toBe(401)
    expect(deleteLtMock).not.toHaveBeenCalled()
  })

  it('rejects wrong bearer token → 401', async () => {
    const res = await GET(mockRequest('Bearer wrong-secret'))
    expect(res.status).toBe(401)
    expect(deleteLtMock).not.toHaveBeenCalled()
  })

  it('returns 500 (server misconfiguration) when CRON_SECRET is unset', async () => {
    delete process.env['CRON_SECRET']
    const res = await GET(mockRequest(AUTH_OK))
    expect(res.status).toBe(500)
    expect(deleteLtMock).not.toHaveBeenCalled()
  })
})

describe('GET /api/cron/purge-phi-debug sweep', () => {
  it('surfaces the deleted count and targets the right table/predicate', async () => {
    deleteLtMock.mockResolvedValue({ error: null, count: 5 })

    const before = Date.now()
    const res    = await GET(mockRequest(AUTH_OK))
    const after  = Date.now()
    const body   = await res.json()

    expect(res.status).toBe(200)
    expect(body.status).toBe('ok')
    expect(body.deleted).toBe(5)

    // Table + predicate shape
    expect(lastFromTable).toBe('adapter_submission_debug_payloads')
    expect(lastDeleteOptions).toEqual({ count: 'exact' })
    expect(lastLtColumn).toBe('created_at')

    // Cutoff ≈ now − 24h (absolute boundary, not delta-from-last-run)
    const cutoffMs = new Date(lastLtCutoff!).getTime()
    expect(cutoffMs).toBeGreaterThanOrEqual(before - RETENTION_MS)
    expect(cutoffMs).toBeLessThanOrEqual(after - RETENTION_MS)
    expect(body.cutoff).toBe(lastLtCutoff)
  })

  it('0-row delete is a success: 200 with deleted: 0 (idempotent re-run)', async () => {
    deleteLtMock.mockResolvedValue({ error: null, count: 0 })

    const res  = await GET(mockRequest(AUTH_OK))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.status).toBe('ok')
    expect(body.deleted).toBe(0)
  })

  it('null count coalesces to deleted: 0', async () => {
    deleteLtMock.mockResolvedValue({ error: null, count: null })

    const res  = await GET(mockRequest(AUTH_OK))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.deleted).toBe(0)
  })

  it('delete failure → 500 with the error message', async () => {
    deleteLtMock.mockResolvedValue({ error: { message: 'permission denied' }, count: null })

    const res  = await GET(mockRequest(AUTH_OK))
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.error).toBe('permission denied')
  })
})

describe('non-GET methods', () => {
  it.each([
    ['POST', POST],
    ['PUT', PUT],
    ['PATCH', PATCH],
    ['DELETE', DELETE],
  ])('%s → 405', (_name, handler) => {
    const res = handler()
    expect(res.status).toBe(405)
  })
})
