/**
 * @jest-environment node
 *
 * Static guards for the 2026-09 refresh fan-out fix.
 *
 * Behavioural coverage lives in src/__tests__/middleware-prefetch.test.ts.
 * These are the cheap source-level invariants that a refactor is most
 * likely to break silently:
 *
 *   1. The prefetch short-circuit must run BEFORE createServerClient in
 *      src/middleware.ts. Ordering is the entire fix — a short-circuit that
 *      runs after the auth client is built has already paid for the refresh
 *      and can still lose the rotation race.
 *   2. SidebarNav must keep prefetch={false}. It is mounted on every
 *      authenticated clinic page and renders its three links twice, so it is
 *      the dominant prefetch fan-out and the reason the bug reproduced under
 *      automation but not under manual clicking.
 *   3. src/middleware.ts must remain the only context that both rotates and
 *      persists the token pair (re-asserted here so this file fails loudly
 *      if someone "fixes" the race by refreshing somewhere else).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (rel: string): string =>
  readFileSync(join(process.cwd(), rel), 'utf8')

describe('refresh fan-out guards', () => {
  const middlewareSrc = read('src/middleware.ts')

  it('middleware short-circuits prefetch requests', () => {
    expect(middlewareSrc).toMatch(/isPrefetchRequest/)
    expect(middlewareSrc).toMatch(/next-router-prefetch/)
    expect(middlewareSrc).toMatch(/status:\s*204/)
  })

  it('the short-circuit runs BEFORE the Supabase client is constructed', () => {
    const shortCircuitAt = middlewareSrc.indexOf('if (isPrefetchRequest(request))')
    const clientAt       = middlewareSrc.indexOf('const supabase = createServerClient(')
    expect(shortCircuitAt).toBeGreaterThan(-1)
    expect(clientAt).toBeGreaterThan(-1)
    expect(shortCircuitAt).toBeLessThan(clientAt)
  })

  it('does not key the skip on the RSC header alone (that would skip real navigations)', () => {
    // A client-side navigation sends RSC: 1 without any prefetch marker.
    // Skipping on RSC would hand every soft navigation an ungated response.
    const detector = middlewareSrc.slice(
      middlewareSrc.indexOf('function isPrefetchRequest'),
      middlewareSrc.indexOf('// Edge Middleware'),
    )
    expect(detector).not.toMatch(/get\('rsc'\)/i)
  })

  it('SidebarNav disables <Link> prefetch', () => {
    expect(read('src/components/sidebar-nav.tsx')).toMatch(/prefetch=\{false\}/)
  })

  it('middleware is still the only rotate-and-persist context', () => {
    // Server Components swallow the cookie write by design; if that guard
    // disappears, a page-level refresh can orphan a rotated pair again.
    expect(read('src/lib/supabase/server.ts')).toMatch(/catch\s*\{/)
    expect(middlewareSrc).toMatch(/response\.cookies\.set\(name, value, options\)/)
  })
})
