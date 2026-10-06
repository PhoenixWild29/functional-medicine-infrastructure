/**
 * @jest-environment node
 *
 * Compliance C9: security headers on every page and API response.
 *
 *   - An ENFORCED Content-Security-Policy (not Report-Only) on every
 *     middleware response: pages, API routes, redirects, the prefetch 204.
 *     Scripts run only from this origin or with the per-request nonce:
 *     never 'unsafe-inline', never 'unsafe-eval' outside development.
 *   - Each area allows only what it needs: Stripe.js and Stripe's frames
 *     on patient checkout, nowhere else; Supabase and Sentry ingest for
 *     connections; no other third-party host anywhere.
 *   - A restrictive Permissions-Policy: no camera, microphone or location
 *     anywhere yet; payment only on checkout (Stripe wallets).
 *   - HSTS (2 years, includeSubDomains), X-Frame-Options DENY,
 *     X-Content-Type-Options nosniff and Referrer-Policy
 *     strict-origin-when-cross-origin on every path (next.config headers,
 *     which also cover static assets the middleware never sees).
 */

import { NextRequest } from 'next/server'
import { middleware } from '../middleware'
import { baseConfig } from '../../next.config'

const verifyCheckoutTokenMock = jest.fn()
const getUserMock             = jest.fn()

jest.mock('@/lib/auth/checkout-token', () => ({
  verifyCheckoutToken: (token: string) => verifyCheckoutTokenMock(token),
}))

jest.mock('@supabase/ssr', () => ({
  createServerClient: jest.fn(() => ({ auth: { getUser: () => getUserMock() } })),
}))

const SUPABASE = 'https://abcdefgh.supabase.co'
const SENTRY_INGEST = 'https://o123.ingest.us.sentry.io'

process.env['NEXT_PUBLIC_SUPABASE_URL']      = SUPABASE
process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] = 'anon'
process.env['NEXT_PUBLIC_SENTRY_DSN']        = `https://publickey@o123.ingest.us.sentry.io/4500000`

const CLINIC = { data: { user: { id: 'u-1', user_metadata: { app_role: 'clinic_admin' } } } }
const OPS    = { data: { user: { id: 'u-2', user_metadata: { app_role: 'ops_admin' } } } }
const NONE   = { data: { user: null } }

function req(pathname: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(new URL(`http://localhost${pathname}`), { method: 'GET', headers })
}

/** Parses a CSP header into { directive: [sources] }. */
function parseCsp(csp: string | null): Record<string, string[]> {
  expect(csp).toBeTruthy()
  const out: Record<string, string[]> = {}
  for (const part of csp!.split(';')) {
    const [name, ...values] = part.trim().split(/\s+/)
    if (name) out[name] = values
  }
  return out
}

/** Every https origin a CSP allows, across all directives. */
function externalHosts(csp: Record<string, string[]>): string[] {
  return Object.values(csp).flat().filter(v => v.startsWith('https://') || v.startsWith('wss://'))
}

beforeEach(() => {
  jest.clearAllMocks()
  getUserMock.mockResolvedValue(CLINIC)
  verifyCheckoutTokenMock.mockResolvedValue({ orderId: 'o-1', clinicId: 'c-1', iat: 0, exp: 9999999999 })
})

// Every way middleware can answer.
const CASES: Array<[string, () => Promise<Response>]> = [
  ['signed-in clinic page',        async () => middleware(req('/dashboard'))],
  ['signed-in ops page',           async () => { getUserMock.mockResolvedValue(OPS); return middleware(req('/ops/pipeline')) }],
  ['new prescription page',        async () => middleware(req('/new-prescription'))],
  ['patient checkout',             async () => middleware(req('/checkout/some.jwt.token'))],
  ['expired checkout redirect',    async () => { verifyCheckoutTokenMock.mockResolvedValue(null); return middleware(req('/checkout/bad')) }],
  ['login page',                   async () => middleware(req('/login'))],
  ['auth callback',                async () => middleware(req('/auth/callback'))],
  ['unauthorized page',            async () => middleware(req('/unauthorized'))],
  ['signed-out redirect to login', async () => { getUserMock.mockResolvedValue(NONE); return middleware(req('/dashboard')) }],
  ['API route',                    async () => middleware(req('/api/orders'))],
  ['webhook API route',            async () => middleware(req('/api/webhooks/stripe'))],
  ['cron API route',               async () => middleware(req('/api/cron/sla-check'))],
  ['prefetch short-circuit',       async () => middleware(req('/dashboard', { 'next-router-prefetch': '1' }))],
]

describe.each(CASES)('%s', (_name, run) => {
  it('carries an enforced CSP (not report-only)', async () => {
    const res = await run()
    expect(res.headers.get('Content-Security-Policy')).toBeTruthy()
    expect(res.headers.get('Content-Security-Policy-Report-Only')).toBeNull()
  })

  it('never allows inline or eval script (outside development)', async () => {
    const csp = parseCsp((await run()).headers.get('Content-Security-Policy'))
    expect(csp['script-src']).toBeDefined()
    expect(csp['script-src']).not.toContain("'unsafe-inline'")
    expect(csp['script-src']).not.toContain("'unsafe-eval'")
    expect(csp['script-src']!.some(s => /^'nonce-[A-Za-z0-9+/=_-]{16,}'$/.test(s))).toBe(true)
  })

  it('cannot be framed, has no plugins, and pins base-uri and form-action', async () => {
    const csp = parseCsp((await run()).headers.get('Content-Security-Policy'))
    expect(csp['frame-ancestors']).toEqual(["'none'"])
    expect(csp['object-src']).toEqual(["'none'"])
    expect(csp['base-uri']).toEqual(["'self'"])
    expect(csp['form-action']).toEqual(["'self'"])
    expect(csp['default-src']).toEqual(["'self'"])
  })

  it('has a restrictive Permissions-Policy: no camera, microphone or location', async () => {
    const pp = (await run()).headers.get('Permissions-Policy')
    expect(pp).toBeTruthy()
    expect(pp).toContain('camera=()')
    expect(pp).toContain('microphone=()')
    expect(pp).toContain('geolocation=()')
  })
})

describe('per-area allowlists', () => {
  it('a signed-in page allows only Supabase and Sentry ingest as outside hosts', async () => {
    const csp = parseCsp((await middleware(req('/dashboard'))).headers.get('Content-Security-Policy'))

    expect(csp['connect-src']).toEqual(expect.arrayContaining(["'self'", SUPABASE, SENTRY_INGEST]))
    expect(new Set(externalHosts(csp))).toEqual(new Set([SUPABASE, SENTRY_INGEST]))
    expect(csp['frame-src']).toEqual(["'none'"])
  })

  it('an ops page allows no Stripe and no other third party', async () => {
    getUserMock.mockResolvedValue(OPS)
    const csp = parseCsp((await middleware(req('/ops/pipeline'))).headers.get('Content-Security-Policy'))

    expect(JSON.stringify(csp)).not.toContain('stripe')
    expect(new Set(externalHosts(csp))).toEqual(new Set([SUPABASE, SENTRY_INGEST]))
  })

  it('checkout allows Stripe.js, Stripe frames and the Stripe API, and nothing else extra', async () => {
    const csp = parseCsp((await middleware(req('/checkout/some.jwt.token'))).headers.get('Content-Security-Policy'))

    expect(csp['script-src']).toEqual(expect.arrayContaining(['https://js.stripe.com']))
    expect(csp['frame-src']).toEqual(expect.arrayContaining(['https://js.stripe.com', 'https://hooks.stripe.com']))
    expect(csp['connect-src']).toEqual(expect.arrayContaining(['https://api.stripe.com']))
    for (const host of externalHosts(csp)) {
      expect([SUPABASE, SENTRY_INGEST].includes(host) || /^https:\/\/([a-z0-9*-]+\.)*stripe\.(com|network)$/.test(host)).toBe(true)
    }
  })

  it('payment is allowed only on checkout (Stripe wallets)', async () => {
    const checkout = (await middleware(req('/checkout/some.jwt.token'))).headers.get('Permissions-Policy')!
    const dashboard = (await middleware(req('/dashboard'))).headers.get('Permissions-Policy')!

    expect(checkout).toMatch(/payment=\(self "https:\/\/js\.stripe\.com"\)/)
    expect(dashboard).toContain('payment=()')
  })
})

describe('the nonce', () => {
  it('is new on every request', async () => {
    const a = (await middleware(req('/dashboard'))).headers.get('Content-Security-Policy')
    const b = (await middleware(req('/dashboard'))).headers.get('Content-Security-Policy')
    expect(a).not.toEqual(b)
  })

  it('is forwarded to the page render (Next applies it to its own scripts)', async () => {
    const res = await middleware(req('/dashboard'))
    const csp = res.headers.get('Content-Security-Policy')!
    const nonce = /'nonce-([^']+)'/.exec(csp)![1]

    // NextResponse.next({ request: { headers } }) forwards request headers as x-middleware-request-*
    expect(res.headers.get('x-middleware-request-x-nonce')).toBe(nonce)
    expect(res.headers.get('x-middleware-request-content-security-policy')).toBe(csp)
  })

  it('is forwarded on checkout too, alongside the checkout claims', async () => {
    const res = await middleware(req('/checkout/some.jwt.token'))
    const nonce = /'nonce-([^']+)'/.exec(res.headers.get('Content-Security-Policy')!)![1]

    expect(res.headers.get('x-middleware-request-x-nonce')).toBe(nonce)
    expect(res.headers.get('x-middleware-request-x-checkout-order-id')).toBe('o-1')
  })
})

describe('next.config headers (every path, static assets included)', () => {
  async function headersFor(): Promise<Record<string, string>> {
    const rules = await baseConfig.headers!()
    const all = rules.find(r => r.source === '/:path*')
    expect(all).toBeDefined()
    return Object.fromEntries(all!.headers.map(h => [h.key, h.value]))
  }

  it('sets HSTS for two years with includeSubDomains', async () => {
    const h = await headersFor()
    expect(h['Strict-Transport-Security']).toMatch(/^max-age=63072000; includeSubDomains/)
  })

  it('sets X-Frame-Options DENY, nosniff and the referrer policy', async () => {
    const h = await headersFor()
    expect(h['X-Frame-Options']).toBe('DENY')
    expect(h['X-Content-Type-Options']).toBe('nosniff')
    expect(h['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
  })
})

// E2E serves the production build over plain http://localhost. WebKit
// applies upgrade-insecure-requests to localhost: every /_next script, CSS
// file and font was rewritten to https://localhost and failed with an SSL
// error, so no WebKit page hydrated and each test waited out its timeout
// (#195's E2E was cut off at 15 min). The directive is only for pages
// served over https (production, previews), where HSTS already applies.
describe('upgrade-insecure-requests', () => {
  it('is NOT sent for a page served over plain http (local and E2E builds)', async () => {
    for (const path of ['/login', '/dashboard', '/checkout/some.jwt.token']) {
      const res = await middleware(req(path))
      expect(res.headers.get('Content-Security-Policy')).not.toContain('upgrade-insecure-requests')
    }
  })

  it('is sent for a page served over https', async () => {
    const res = await middleware(new NextRequest(new URL('https://app.compoundiq.test/login'), { method: 'GET' }))
    expect(res.headers.get('Content-Security-Policy')).toContain('upgrade-insecure-requests')
  })
})

// Prod (eaab539): https pages carried no upgrade-insecure-requests. Behind
// Vercel's proxy the URL the middleware sees is http; the browser's scheme
// is in x-forwarded-proto. Decide from its FIRST value, falling back to the
// URL's protocol when the header is absent.
describe('upgrade-insecure-requests behind a proxy', () => {
  const proxied = (path: string, proto: string) =>
    new NextRequest(new URL(`http://app.compoundiq.test${path}`), { method: 'GET', headers: { 'x-forwarded-proto': proto } })

  it('is sent when the URL is http but x-forwarded-proto is https (Vercel)', async () => {
    for (const path of ['/login', '/checkout/expired']) {
      const res = await middleware(proxied(path, 'https'))
      expect(res.headers.get('Content-Security-Policy')).toContain('upgrade-insecure-requests')
    }
  })

  it('reads the first value of a comma-separated x-forwarded-proto', async () => {
    expect((await middleware(proxied('/login', 'https, http'))).headers.get('Content-Security-Policy')).toContain('upgrade-insecure-requests')
    expect((await middleware(proxied('/login', 'http, https'))).headers.get('Content-Security-Policy')).not.toContain('upgrade-insecure-requests')
  })

  it('is not sent when x-forwarded-proto says http (local / E2E production build)', async () => {
    const res = await middleware(new NextRequest(new URL('http://localhost/login'), { method: 'GET', headers: { 'x-forwarded-proto': 'http' } }))
    expect(res.headers.get('Content-Security-Policy')).not.toContain('upgrade-insecure-requests')
  })
})
