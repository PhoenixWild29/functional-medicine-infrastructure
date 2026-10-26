/**
 * @jest-environment node
 *
 * C-2026-10-25-17 (B15): the health check fails in production when
 * PHI_ACCESS_LOG_HASH_SECRET is not set (the audit log's email, IP and
 * user agent hashes would be left empty). The value is never printed.
 * Preview, local and CI runs are not failed for it (they are probed by
 * nothing that needs real audit hashes).
 */

import { GET } from '../route'

const KEY = 'PHI_ACCESS_LOG_HASH_SECRET'
const SECRET = 'do-not-print-this-secret-value'
const OLD = { ...process.env }
afterEach(() => { process.env = { ...OLD } })

const call = async () => {
  const res = GET()
  return { status: res.status, body: await res.json() as Record<string, unknown> }
}

it('production without the secret: 503, the check named, nothing printed', async () => {
  process.env['VERCEL_ENV'] = 'production'
  delete process.env[KEY]
  const { status, body } = await call()
  expect(status).toBe(503)
  expect(body).toMatchObject({ ok: false, checks: { phi_audit_hash_secret: 'missing' } })
})

it('production with the secret: 200, and the value is never in the body', async () => {
  process.env['VERCEL_ENV'] = 'production'
  process.env[KEY] = SECRET
  const { status, body } = await call()
  expect(status).toBe(200)
  expect(body).toMatchObject({ ok: true, checks: { phi_audit_hash_secret: 'set' } })
  expect(JSON.stringify(body)).not.toContain(SECRET)
})

it('preview or local without the secret: still 200, the check reported', async () => {
  process.env['VERCEL_ENV'] = 'preview'
  delete process.env[KEY]
  const { status, body } = await call()
  expect(status).toBe(200)
  expect(body).toMatchObject({ checks: { phi_audit_hash_secret: 'missing' } })
})
