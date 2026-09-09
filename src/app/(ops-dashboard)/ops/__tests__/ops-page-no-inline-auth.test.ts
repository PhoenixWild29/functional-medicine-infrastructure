/**
 * @jest-environment node
 *
 * Regression guard for the 2026-09 ops-console hang.
 *
 * Four of the five /ops routes (sla, adapters, fax, catalog) each opened a
 * second Supabase auth client inside the page Server Component and called
 * auth.getSession() again, on top of the identical call the (ops-dashboard)
 * layout already makes for the same request. /ops/pipeline was the only route
 * without that block — and the only one that rendered.
 *
 * Two things go wrong when a page body does that:
 *
 *  1. redirect() raised from inside the loading.tsx Suspense boundary lands
 *     after the HTML shell has already been flushed. Next cannot turn that
 *     into an HTTP redirect, so the boundary is never revealed and the user
 *     sits on the spinner forever — no console error, no /api traffic.
 *  2. getSession() rotates the Supabase refresh token when the access token
 *     has expired. A Server Component cannot persist cookies, so the rotated
 *     pair is dropped and the browser is left holding a token the server has
 *     already consumed — which kills the session for every later request.
 *
 * Auth for /ops is enforced in two places that CAN do it safely:
 * src/middleware.ts and (ops-dashboard)/layout.tsx. Page bodies must not.
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const OPS_DIR = join(process.cwd(), 'src', 'app', '(ops-dashboard)')

const ROUTES = ['pipeline', 'sla', 'adapters', 'fax', 'catalog'] as const

function pageSource(route: string): string {
  return readFileSync(join(OPS_DIR, 'ops', route, 'page.tsx'), 'utf8')
}

/** Strip // line comments and block comments so prose about the bug
 *  (which necessarily names getSession) can't trip the assertions. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
}

describe('ops route pages', () => {
  describe.each(ROUTES)('/ops/%s', (route) => {
    const code = stripComments(pageSource(route))

    it('does not open a session-scoped Supabase client in the page body', () => {
      expect(code).not.toMatch(/from\s+['"]@\/lib\/supabase\/server['"]/)
      expect(code).not.toMatch(/createServerClient/)
    })

    it('does not call auth.getSession() in the page body', () => {
      expect(code).not.toMatch(/auth\s*\.\s*getSession/)
    })

    it('does not redirect() from inside the streamed page body', () => {
      // redirect() here fires after the shell has flushed and leaves the
      // loading.tsx Suspense boundary permanently unresolved.
      expect(code).not.toMatch(/\bredirect\s*\(/)
    })

    it('renders from a service client with force-dynamic', () => {
      expect(code).toMatch(/createServiceClient/)
      expect(code).toMatch(/export const dynamic = 'force-dynamic'/)
    })

    it('degrades a failed query to empty data rather than throwing', () => {
      // Every Supabase result is unwrapped with `?? []` (or `?? 0` for counts)
      // so an error response yields an empty state, never a hang.
      expect(code).toMatch(/\?\?\s*\[\]/)
    })
  })

  it('keeps both a loading.tsx and an error.tsx on the ops segment', () => {
    // loading.tsx without error.tsx means a throw inside the boundary has
    // nowhere to land and the spinner stays up forever.
    expect(existsSync(join(OPS_DIR, 'loading.tsx'))).toBe(true)
    expect(existsSync(join(OPS_DIR, 'error.tsx'))).toBe(true)
  })

  it('still enforces ops_admin in middleware and the ops layout', () => {
    const middleware = readFileSync(join(process.cwd(), 'src', 'middleware.ts'), 'utf8')
    expect(middleware).toMatch(/pathname\.startsWith\('\/ops'\)/)
    expect(middleware).toMatch(/ops_admin/)

    const layout = readFileSync(join(OPS_DIR, 'layout.tsx'), 'utf8')
    expect(layout).toMatch(/auth\.getSession\(\)/)
    expect(layout).toMatch(/ops_admin/)
    expect(layout).toMatch(/redirect\('\/unauthorized'\)/)
  })
})
