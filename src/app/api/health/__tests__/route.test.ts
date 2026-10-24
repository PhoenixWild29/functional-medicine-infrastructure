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
