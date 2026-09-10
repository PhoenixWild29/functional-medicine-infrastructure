/**
 * @jest-environment node
 *
 * App-wide static guard for the 2026-09 prod silent-logout / console-hang
 * bug class.
 *
 * History
 * -------
 * PR #122 removed an in-page `auth.getSession()` from four /ops pages and
 * added src/app/(ops-dashboard)/ops/__tests__/ops-page-no-inline-auth.test.ts
 * to hold the line — but only for the five /ops routes.
 * PR #124 fixed middleware's setAll() cookie loss and made every gate
 * branch carry the refreshed cookies.
 *
 * Users were STILL being logged out on the #124 build. The remaining
 * instance was on the one page neither PR looked at: /unauthorized.
 * It called auth.getSession() while sitting in middleware's publicRoutes,
 * so middleware returned BEFORE its refresh block and that page call was
 * the first and only auth read of the request. On an expired access token
 * it rotated the refresh token from a Server Component — a context that
 * cannot persist cookies, because src/lib/supabase/server.ts swallows
 * setAll() by design. Supabase spent the refresh token server-side, the
 * rotated pair was dropped, and the NEXT navigation had no session.
 *
 * /unauthorized is the shared destination of every gate in middleware, so
 * that fired after ANY permission denial — but only once the token had
 * aged out, which is why it looked like a random, unreproducible logout.
 *
 * This suite generalises the #122 guard from five routes to every route,
 * so the class cannot reappear on a page nobody thought to check.
 *
 * Two invariants, both enforced here:
 *
 *   A. src/middleware.ts is the ONLY context that may rotate AND persist
 *      the Supabase token pair. Pages and layouts read with getUser(),
 *      never getSession().
 *
 *   B. Only code that runs BEFORE anything is flushed may redirect() for
 *      auth. loading.tsx in a route group puts every page body below it
 *      inside a Suspense boundary; a redirect raised from there cannot
 *      become an HTTP redirect and the boundary is never resolved, so the
 *      route hangs on the spinner forever. The route-group layout sits
 *      OUTSIDE the boundary its sibling loading.tsx creates, so it may
 *      still redirect — and so may src/app/page.tsx, which has no
 *      loading.tsx above it.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const APP_DIR = join(process.cwd(), 'src', 'app')
const MIDDLEWARE = join(process.cwd(), 'src', 'middleware.ts')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue
      walk(full, out)
    } else if (entry === 'page.tsx' || entry === 'layout.tsx') {
      out.push(full)
    }
  }
  return out
}

/** Strip // line comments and block comments so prose about the bug
 *  (which necessarily names getSession) can't trip the assertions. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
}

const toRel = (f: string): string => relative(process.cwd(), f).split(sep).join('/')

const FILES = walk(APP_DIR).map(toRel).sort()

// The only files permitted to redirect() for auth. Each one runs before
// anything has been flushed for the request — see invariant B above.
const AUTH_REDIRECT_ALLOWLIST = new Set([
  'src/app/page.tsx',
  'src/app/(clinic-app)/layout.tsx',
  'src/app/(ops-dashboard)/layout.tsx',
])

const read = (rel: string): string =>
  stripComments(readFileSync(join(process.cwd(), rel), 'utf8'))

describe('src/app route files', () => {
  it('finds the route tree (guard against a broken walk silently passing)', () => {
    expect(FILES.length).toBeGreaterThan(10)
    expect(FILES).toContain('src/app/unauthorized/page.tsx')
    expect(FILES).toContain('src/app/(clinic-app)/layout.tsx')
    expect(FILES).toContain('src/app/(clinic-app)/dashboard/page.tsx')
    expect(FILES).toContain('src/app/(ops-dashboard)/layout.tsx')
  })

  describe.each(FILES)('%s', (rel) => {
    it('does not call auth.getSession() — middleware owns token rotation', () => {
      expect(read(rel)).not.toMatch(/auth\s*\.\s*getSession/)
    })

    it('does not redirect() to /login or /unauthorized unless it runs pre-flush', () => {
      if (AUTH_REDIRECT_ALLOWLIST.has(rel)) return
      expect(read(rel)).not.toMatch(/redirect\s*\(\s*['"]\/(login|unauthorized)/)
    })
  })
})

describe('route-group layouts still enforce their role gates', () => {
  it('(clinic-app)/layout.tsx gates on the clinic roles with getUser()', () => {
    const src = read('src/app/(clinic-app)/layout.tsx')
    expect(src).toMatch(/auth\.getUser\(\)/)
    expect(src).toMatch(/clinic_admin/)
    expect(src).toMatch(/provider/)
    expect(src).toMatch(/medical_assistant/)
    expect(src).toMatch(/redirect\('\/unauthorized'\)/)
  })

  it('(ops-dashboard)/layout.tsx gates on ops_admin with getUser()', () => {
    const src = read('src/app/(ops-dashboard)/layout.tsx')
    expect(src).toMatch(/auth\.getUser\(\)/)
    expect(src).toMatch(/ops_admin/)
    expect(src).toMatch(/redirect\('\/unauthorized'\)/)
  })
})

describe('middleware invariants', () => {
  const raw = readFileSync(MIDDLEWARE, 'utf8')
  const src = stripComments(raw)

  it('does NOT list /unauthorized as a public route (2026-09 logout root cause)', () => {
    const publicRoutes = /const publicRoutes = \[([^\]]*)\]/.exec(src)?.[1] ?? ''
    expect(publicRoutes).not.toContain('/unauthorized')
    // The rest of the list must be intact — these are load-bearing.
    expect(publicRoutes).toContain('/login')
    expect(publicRoutes).toContain('/auth/callback')
    expect(publicRoutes).toContain('/api/webhooks')
    expect(publicRoutes).toContain('/api/cron')
    expect(publicRoutes).toContain('/api/health')
  })

  it('refreshes the session BEFORE exempting /unauthorized from the role gates', () => {
    const refreshAt = src.indexOf('supabase.auth.getUser()')
    const exemptAt  = src.indexOf("pathname === '/unauthorized'")
    expect(refreshAt).toBeGreaterThan(-1)
    expect(exemptAt).toBeGreaterThan(refreshAt)
  })

  it('exempts /unauthorized from the role gates so a denial cannot loop', () => {
    const exemptAt = src.indexOf("pathname === '/unauthorized'")
    const opsGateAt = src.indexOf("pathname.startsWith('/ops')")
    expect(exemptAt).toBeGreaterThan(-1)
    expect(exemptAt).toBeLessThan(opsGateAt)
  })

  it('never returns a bare NextResponse.redirect() after the session refresh', () => {
    // Bare redirects carry no Set-Cookie, so they discard the rotated
    // token pair. Every gate below the helper must use it. (PR #124.)
    const helperAt = src.indexOf('const redirectWithSessionCookies')
    expect(helperAt).toBeGreaterThan(-1)
    const gates = src.slice(src.indexOf('if (!user)', helperAt))
    expect(gates).not.toMatch(/NextResponse\.redirect\(/)
    expect(gates).toMatch(/redirectWithSessionCookies\(loginUrl\)/)
  })

  it('keeps the /ops gate and the provider-only sign gate', () => {
    expect(src).toMatch(/pathname\.startsWith\('\/ops'\)\s*&&\s*appRole !== 'ops_admin'/)
    expect(src).toMatch(/pathname === '\/new-prescription\/sign'/)
    expect(src).toMatch(/pathname\.startsWith\('\/new-prescription\/sign\/'\)/)
    expect(src).toMatch(/appRole !== 'provider'/)
  })

  it('reads role claims from getUser(), never getSession()', () => {
    expect(src).not.toMatch(/auth\s*\.\s*getSession/)
    expect(src).toMatch(/auth\.getUser\(\)/)
  })
})
