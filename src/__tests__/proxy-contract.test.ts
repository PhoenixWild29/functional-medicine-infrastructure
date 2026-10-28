/**
 * @jest-environment node
 *
 * Next 16: src/middleware.ts became src/proxy.ts (the "middleware" file
 * convention is deprecated) and so moved from the Edge runtime to Node.js,
 * the only runtime a proxy has. This pins what every page and API response
 * must still carry, and where every gate still sends a request, through
 * proxy() itself:
 *
 *   - The file convention: src/proxy.ts exports proxy and the matcher;
 *     there is no src/middleware.ts and no `runtime` key (a proxy throws on
 *     one).
 *   - The matcher: pages and API routes run through the proxy; Next
 *     internals and static files do not.
 *   - Headers: an enforced CSP whose script-src carries this request's
 *     nonce, the same nonce forwarded to the page as x-nonce, a fresh nonce
 *     per request; no-store on authenticated pages and on every redirect;
 *     HSTS and the other static headers on every path (next.config).
 *   - Redirects: signed out to /login?redirectTo=<path+query>; the MFA gate
 *     to /mfa/enroll or /mfa/challenge; the ops, pharmacy, practice and
 *     signing role gates to /unauthorized; a deactivated member to
 *     /login?error=deactivated after a local sign-out.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server'
import * as proxyModule from '../proxy'
import { proxy, config } from '../proxy'
import { baseConfig } from '../../next.config'

const getUserMock = jest.fn()
const getClaimsMock = jest.fn()
const signOutMock = jest.fn()
const verifyCheckoutTokenMock = jest.fn()

jest.mock('@/lib/auth/checkout-token', () => ({
  verifyCheckoutToken: (token: string) => verifyCheckoutTokenMock(token),
}))
jest.mock('@supabase/ssr', () => ({
  createServerClient: jest.fn(() => ({
    auth: {
      getUser: () => getUserMock(),
      getClaims: () => getClaimsMock(),
      signOut: (...a: unknown[]) => signOutMock(...a),
    },
  })),
}))

process.env['NEXT_PUBLIC_SUPABASE_URL'] = 'https://abcdefgh.supabase.co'
process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] = 'anon'

const ROOT = process.cwd()
const req = (path: string, headers: Record<string, string> = {}) =>
  new NextRequest(new URL(`https://app.test${path}`), { method: 'GET', headers: { 'x-forwarded-proto': 'https', ...headers } })
const user = (meta: Record<string, unknown>, factors: unknown[] = []) =>
  ({ data: { user: { id: 'u-1', email: 'staff@clinic.test', app_metadata: meta, factors } } })
const location = (res: Response) => new URL(res.headers.get('location')!)
const NO_STORE = 'no-store, no-cache, must-revalidate, private'

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env['REQUIRE_MFA']
  delete process.env['MFA_ENFORCED_EMAILS']
  getUserMock.mockResolvedValue(user({ app_role: 'clinic_admin', clinic_id: 'c-1' }))
  getClaimsMock.mockResolvedValue({ data: { claims: { aal: 'aal2', sub: 'u-1' } }, error: null })
  signOutMock.mockResolvedValue({ error: null })
  verifyCheckoutTokenMock.mockResolvedValue({ orderId: 'o-1', clinicId: 'c-1', iat: 0, exp: 9999999999 })
})

describe('the file convention', () => {
  it('src/proxy.ts exports proxy and config; src/middleware.ts is gone', () => {
    expect(existsSync(join(ROOT, 'src', 'proxy.ts'))).toBe(true)
    expect(existsSync(join(ROOT, 'src', 'middleware.ts'))).toBe(false)
    expect(typeof proxy).toBe('function')
    expect(Object.keys(proxyModule).sort()).toEqual(['config', 'proxy'])
  })

  it('declares no runtime (a proxy always runs on Node.js and throws on one)', () => {
    expect(Object.keys(config)).toEqual(['matcher'])
    expect(readFileSync(join(ROOT, 'src', 'proxy.ts'), 'utf8')).not.toMatch(/export const runtime/)
  })
})

describe('the matcher', () => {
  it.each(['/dashboard', '/ops/pipeline', '/api/orders', '/checkout/a.b.c', '/login', '/new-prescription/sign'])('%s runs through the proxy', url => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true)
  })

  it.each(['/_next/static/chunks/main.js', '/_next/image', '/favicon.ico', '/robots.txt', '/logo.svg', '/fonts/inter.woff2'])('%s does not', url => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(false)
  })
})

describe('headers', () => {
  it('an enforced CSP carries this request\'s nonce, which is forwarded to the page as x-nonce', async () => {
    const res = await proxy(req('/dashboard'))
    const csp = res.headers.get('Content-Security-Policy')!
    expect(res.headers.get('Content-Security-Policy-Report-Only')).toBeNull()
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1]
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/)
    expect(csp).toMatch(new RegExp(`script-src[^;]*'nonce-${nonce!.replace(/[+/]/g, '\\$&')}'`))
    expect(res.headers.get('x-middleware-request-x-nonce')).toBe(nonce)
    expect(res.headers.get('x-middleware-request-content-security-policy')).toBe(csp)
    expect(csp).toMatch(/upgrade-insecure-requests/)
  })

  it('every request gets a fresh nonce', async () => {
    const nonces = await Promise.all([1, 2, 3].map(async () => (await proxy(req('/dashboard'))).headers.get('x-middleware-request-x-nonce')))
    expect(new Set(nonces).size).toBe(3)
  })

  it.each(['/dashboard', '/ops/pipeline', '/new-prescription', '/settings/team', '/api/orders'])('no-store on the authenticated %s', async path => {
    if (path.startsWith('/ops')) getUserMock.mockResolvedValue(user({ app_role: 'ops_admin' }))
    const res = await proxy(req(path))
    expect(res.headers.get('Cache-Control')).toBe(NO_STORE)
    expect(res.headers.get('Pragma')).toBe('no-cache')
    expect(res.headers.get('Expires')).toBe('0')
    expect(res.headers.get('Permissions-Policy')).toBeTruthy()
  })

  it('HSTS, X-Frame-Options, nosniff and Referrer-Policy on every path (next.config)', async () => {
    const rules = await baseConfig.headers!()
    const all = rules.find(r => r.source === '/:path*')!
    const h = Object.fromEntries(all.headers.map(x => [x.key, x.value]))
    expect(h['Strict-Transport-Security']).toBe('max-age=63072000; includeSubDomains')
    expect(h['X-Frame-Options']).toBe('DENY')
    expect(h['X-Content-Type-Options']).toBe('nosniff')
    expect(h['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
  })
})

describe('redirects', () => {
  // Every redirect also carries the CSP and no-store.
  function expectRedirect(res: Response, pathname: string) {
    expect(res.status).toBe(307)
    expect(location(res).pathname).toBe(pathname)
    expect(res.headers.get('Cache-Control')).toBe(NO_STORE)
    expect(res.headers.get('Content-Security-Policy')).toMatch(/'nonce-/)
  }

  it('signed out: /login?redirectTo=<path and query>', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } })
    const res = await proxy(req('/dashboard?tab=orders'))
    expectRedirect(res, '/login')
    expect(location(res).searchParams.get('redirectTo')).toBe('/dashboard?tab=orders')
  })

  it('signed out on an API route: the same /login redirect (as before the rename)', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } })
    const res = await proxy(req('/api/orders'))
    expectRedirect(res, '/login')
    expect(location(res).searchParams.get('redirectTo')).toBe('/api/orders')
  })

  it('MFA enforced, AAL1 and no factor: /mfa/enroll?redirectTo', async () => {
    process.env['REQUIRE_MFA'] = 'true'
    getUserMock.mockResolvedValue(user({ app_role: 'provider', clinic_id: 'c-1' }))
    getClaimsMock.mockResolvedValue({ data: { claims: { aal: 'aal1', sub: 'u-1' } }, error: null })
    const res = await proxy(req('/dashboard'))
    expectRedirect(res, '/mfa/enroll')
    expect(location(res).searchParams.get('redirectTo')).toBe('/dashboard')
  })

  it('MFA enforced, AAL1 with a verified factor: /mfa/challenge?redirectTo', async () => {
    process.env['REQUIRE_MFA'] = 'true'
    getUserMock.mockResolvedValue(user({ app_role: 'ops_admin' }, [{ factor_type: 'totp', status: 'verified' }]))
    getClaimsMock.mockResolvedValue({ data: { claims: { aal: 'aal1', sub: 'u-1' } }, error: null })
    const res = await proxy(req('/ops/pipeline'))
    expectRedirect(res, '/mfa/challenge')
    expect(location(res).searchParams.get('redirectTo')).toBe('/ops/pipeline')
  })

  it.each([
    ['a clinic admin on /ops', { app_role: 'clinic_admin', clinic_id: 'c-1' }, '/ops/pipeline'],
    ['a medical assistant on the signing page', { app_role: 'medical_assistant', clinic_id: 'c-1' }, '/new-prescription/sign'],
    ['a medical assistant on /practice', { app_role: 'medical_assistant', clinic_id: 'c-1' }, '/practice'],
    ['a clinic user on the pharmacy portal', { app_role: 'provider', clinic_id: 'c-1' }, '/pharmacy/onboarding'],
    ['a pharmacy admin on a clinic page', { app_role: 'pharmacy_admin' }, '/dashboard'],
  ])('role gate: %s goes to /unauthorized', async (_name, meta, path) => {
    getUserMock.mockResolvedValue(user(meta))
    expectRedirect(await proxy(req(path)), '/unauthorized')
  })

  it('a deactivated member is signed out here, then /login?error=deactivated', async () => {
    getUserMock.mockResolvedValue(user({ app_role: 'medical_assistant', clinic_id: 'c-1', deactivated_at: '2026-10-18T10:00:00Z' }))
    const res = await proxy(req('/dashboard'))
    expectRedirect(res, '/login')
    expect(location(res).searchParams.get('error')).toBe('deactivated')
    expect(signOutMock).toHaveBeenCalledWith({ scope: 'local' })
  })

  it('an expired checkout link: /checkout/expired, without a session', async () => {
    verifyCheckoutTokenMock.mockResolvedValue(null)
    expectRedirect(await proxy(req('/checkout/bad.token.here')), '/checkout/expired')
    expect(getUserMock).not.toHaveBeenCalled()
  })
})
