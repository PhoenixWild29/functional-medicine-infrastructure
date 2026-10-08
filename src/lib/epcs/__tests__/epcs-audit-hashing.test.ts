/**
 * @jest-environment node
 *
 * Compliance C10: epcs_audit_log stored the raw client IP and user agent.
 * New rows store keyed hashes instead (HMAC-SHA256 with
 * PHI_ACCESS_LOG_HASH_SECRET, the same key and form as phi_access_log), in
 * ip_hash and user_agent_hash; ip_address and user_agent are left NULL.
 * Rows already written are not changed (the table is append-only).
 * Without the secret no hash is written, and never the raw values.
 */

import fs from 'node:fs'
import path from 'node:path'
import type { NextRequest } from 'next/server'
import { scriptedDb } from '@/__tests__/helpers/scripted-db'
import { epcsRequestFields } from '../audit-request'

const HEX64 = /^[0-9a-f]{64}$/
const headers = (h: Record<string, string>) => new Headers(h)

afterEach(() => { delete process.env['PHI_ACCESS_LOG_HASH_SECRET'] })

describe('epcsRequestFields', () => {
  it('keyed hashes of the first forwarded IP and the user agent; raw columns null', async () => {
    process.env['PHI_ACCESS_LOG_HASH_SECRET'] = 'k'
    const f = await epcsRequestFields(headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1', 'user-agent': 'Mozilla/5.0 (Mac)' }))
    expect(f.ip_address).toBeNull()
    expect(f.user_agent).toBeNull()
    expect(f.ip_hash).toMatch(HEX64)
    expect(f.user_agent_hash).toMatch(HEX64)
    // The same IP hashes the same way (rows can be correlated); another does not.
    expect((await epcsRequestFields(headers({ 'x-forwarded-for': '203.0.113.7' }))).ip_hash).toBe(f.ip_hash)
    expect((await epcsRequestFields(headers({ 'x-forwarded-for': '203.0.113.8' }))).ip_hash).not.toBe(f.ip_hash)
  })

  it('without the secret: no hashes, and never the raw values', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    const f = await epcsRequestFields(headers({ 'x-forwarded-for': '203.0.113.7', 'user-agent': 'Mozilla/5.0' }))
    expect(f).toEqual({ ip_address: null, user_agent: null, ip_hash: null, user_agent_hash: null })
  })
})

describe('POST /api/epcs?action=audit', () => {
  let db = scriptedDb(() => undefined)
  beforeAll(() => {
    jest.doMock('@/lib/supabase/server', () => ({
      createServerClient: jest.fn().mockResolvedValue({ auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) } }),
    }))
    jest.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
  })

  it('writes the hashes, not the IP or user agent', async () => {
    process.env['PHI_ACCESS_LOG_HASH_SECRET'] = 'k'
    db = scriptedDb(() => undefined)
    const { POST } = await import('@/app/api/epcs/route')
    const res = await POST({
      url: 'https://app.test/api/epcs?action=audit',
      headers: headers({ 'x-forwarded-for': '203.0.113.7', 'user-agent': 'Mozilla/5.0 (Mac)' }),
      json: async () => ({ provider_id: 'pr-1', event_type: 'PRE_SIGN_REVIEW', dea_schedule: 0, medication_name: 'X' }),
    } as unknown as NextRequest)
    expect(res.status).toBe(200)
    const [insert] = db.to('epcs_audit_log', 'insert')
    const row = insert!.payload as Record<string, unknown>
    expect(row['ip_address']).toBeNull()
    expect(row['user_agent']).toBeNull()
    expect(row['ip_hash']).toMatch(HEX64)
    expect(row['user_agent_hash']).toMatch(HEX64)
    expect(JSON.stringify(row)).not.toContain('203.0.113.7')
    expect(JSON.stringify(row)).not.toContain('Mozilla')
  })
})

it('every epcs_audit_log writer takes its request fields from epcsRequestFields', () => {
  const root = process.cwd()
  for (const rel of ['src/app/api/epcs/route.ts', 'src/lib/orders/batch-sign.ts']) {
    const src = fs.readFileSync(path.join(root, rel), 'utf8')
    if (!src.includes("from('epcs_audit_log')")) continue
    expect(src).toContain('epcsRequestFields')
    expect(src).not.toMatch(/ip_address:\s*(req|meta|request|headers)/)
    expect(src).not.toMatch(/user_agent:\s*(req|meta|request|headers)/)
  }
})
