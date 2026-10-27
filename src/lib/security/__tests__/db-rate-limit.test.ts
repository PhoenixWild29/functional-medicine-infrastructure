/**
 * @jest-environment node
 *
 * dbRateLimitHit: one hit on the shared (Postgres) count, through the
 * rate_limit_hit RPC (migration 20261024000007). The key is stored only as
 * an HMAC with the audit secret (never a raw IP, email or token). Returns
 * the window's count and start, or null when the count cannot be had: no
 * secret, an RPC error, an odd answer, or a throw. Nothing secret or raw
 * is logged.
 */

import { scriptedDb } from '@/__tests__/helpers/scripted-db'

let script: (c: { table: string }) => unknown = () => undefined
let db = scriptedDb(c => script(c) as never)
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.unmock('@/lib/security/db-rate-limit')

import { dbRateLimitHit } from '../db-rate-limit'
import { AUDIT_HASH_SECRET_ENV } from '@/lib/audit/keyed-hash'

let logs: string[] = []
beforeEach(() => {
  process.env[AUDIT_HASH_SECRET_ENV] = 'test-audit-secret'
  script = () => undefined
  db = scriptedDb(c => script(c) as never)
  logs = []
  for (const level of ['info', 'warn', 'error'] as const) {
    jest.spyOn(console, level).mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(' ')) })
  }
})
afterEach(() => { jest.restoreAllMocks(); delete process.env[AUDIT_HASH_SECRET_ENV] })

const WINDOW = '2026-10-25T12:00:00.000Z'

it('one RPC call with the bucket, a keyed hash of the key and the window; returns the count and window start', async () => {
  script = c => (c.table === 'rate_limit_hit' ? { data: [{ hits: 4, window_started: WINDOW }] } : undefined)
  const r = await dbRateLimitHit('signup', '203.0.113.7', 900)
  expect(r).toEqual({ count: 4, windowStart: Date.parse(WINDOW) })
  const call = db.to('rate_limit_hit')[0] as unknown as { payload: Record<string, unknown> }
  expect(call.payload['p_bucket']).toBe('signup')
  expect(call.payload['p_window_seconds']).toBe(900)
  expect(call.payload['p_key_hash']).toMatch(/^[0-9a-f]{64}$/)
  expect(JSON.stringify(call.payload)).not.toContain('203.0.113.7')
})

it('the hash depends on the bucket too: the same IP in two buckets is two keys', async () => {
  script = () => ({ data: [{ hits: 1, window_started: WINDOW }] })
  await dbRateLimitHit('signup', '203.0.113.7', 900)
  await dbRateLimitHit('join', '203.0.113.7', 3600)
  const [a, b] = db.to('rate_limit_hit').map(c => (c as unknown as { payload: Record<string, unknown> }).payload['p_key_hash'])
  expect(a).not.toBe(b)
})

it('an RPC error: null, a warning with the bucket and code only', async () => {
  script = () => ({ data: null, error: { message: 'connection reset 203.0.113.7', code: '08006' } })
  expect(await dbRateLimitHit('signup', '203.0.113.7', 900)).toBeNull()
  const all = logs.join('\n')
  expect(all).toContain('signup')
  expect(all).toContain('08006')
  expect(all).not.toContain('203.0.113.7')
})

it('an odd answer (no row): null', async () => {
  script = () => ({ data: [] })
  expect(await dbRateLimitHit('signup', 'k', 900)).toBeNull()
})

it('the client throws: null, nothing raw logged', async () => {
  script = () => { throw new Error('boom 203.0.113.7') }
  expect(await dbRateLimitHit('signup', '203.0.113.7', 900)).toBeNull()
  expect(logs.join('\n')).not.toContain('203.0.113.7')
})

it('no audit secret: null without any database call (a raw key is never stored)', async () => {
  delete process.env[AUDIT_HASH_SECRET_ENV]
  expect(await dbRateLimitHit('signup', '203.0.113.7', 900)).toBeNull()
  expect(db.to('rate_limit_hit')).toHaveLength(0)
})
