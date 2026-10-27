/**
 * @jest-environment node
 *
 * GET /api/health: the deploy and rollback health checks call it.
 *
 *   - Next 16 deprecates the Edge Runtime ("The Edge Runtime is deprecated"
 *     on next build), so the route runs on Node.js like every other route.
 *   - The answer is unchanged: 200 { ok: true, timestamp, version }.
 */

import * as route from '../route'

describe('GET /api/health', () => {
  it('runs on the Node.js runtime, not the deprecated Edge Runtime', () => {
    expect(route.runtime).toBe('nodejs')
    expect(route.dynamic).toBe('force-dynamic')
  })

  it('answers 200 with ok, a timestamp and the short commit', async () => {
    const res = route.GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(new Date(body.timestamp).toString()).not.toBe('Invalid Date')
    expect(typeof body.version).toBe('string')
  })
})

describe('B review T1: the prescription binding key', () => {
  const env = process.env as Record<string, string | undefined>
  // The PHI audit hash secret is set here, so only the binding key decides
  // (the same route fails in production without either; phi-audit-secret.test).
  beforeEach(() => { env['PHI_ACCESS_LOG_HASH_SECRET'] = 'phi-hash-secret-for-tests' })
  afterEach(() => { delete env['RX_BINDING_SECRET']; delete env['VERCEL_ENV']; delete env['VERCEL']; delete env['PHI_ACCESS_LOG_HASH_SECRET'] })

  it('reports "set" or "missing" by name only, never the value', async () => {
    env['RX_BINDING_SECRET'] = 'the-actual-secret-value-0123456789'
    const set = await route.GET().json()
    expect(set.checks).toMatchObject({ rx_binding_secret: 'set' })
    expect(JSON.stringify(set)).not.toContain('the-actual-secret-value')
    delete env['RX_BINDING_SECRET']
    expect((await route.GET().json()).checks).toMatchObject({ rx_binding_secret: 'missing' })
  })

  it('reports both secrets; production fails when either is missing', async () => {
    env['VERCEL_ENV'] = 'production'
    env['RX_BINDING_SECRET'] = 'set-0123456789abcdef0123456789abcd'
    expect((await route.GET().json()).checks).toEqual({ phi_audit_hash_secret: 'set', rx_binding_secret: 'set' })
    delete env['PHI_ACCESS_LOG_HASH_SECRET']
    const res = route.GET()
    expect(res.status).toBe(503)
    expect((await res.json()).checks).toEqual({ phi_audit_hash_secret: 'missing', rx_binding_secret: 'set' })
  })

  it("fails (503) on any Vercel deployment when it is missing, preview included (D's finding 2); local and tests only report it", async () => {
    env['VERCEL_ENV'] = 'production'
    const res = route.GET()
    expect(res.status).toBe(503)
    expect((await res.json()).ok).toBe(false)
    env['VERCEL_ENV'] = 'preview'
    expect(route.GET().status).toBe(503)
    delete env['VERCEL_ENV']
    env['VERCEL'] = '1'
    expect(route.GET().status).toBe(503)
    delete env['VERCEL']
    expect(route.GET().status).toBe(200)
    env['VERCEL_ENV'] = 'production'
    env['RX_BINDING_SECRET'] = 'set-0123456789abcdef0123456789abcd'
    expect(route.GET().status).toBe(200)
  })
})
