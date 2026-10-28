/**
 * @jest-environment node
 *
 * Token pages (patient checkout, plan, intake and sign-up links, and the
 * onboarding invites) carry their credential in the URL. Every response
 * on those paths, page or API, redirect or error:
 *
 *   - Referrer-Policy: no-referrer, so the token URL is never sent on as a
 *     Referer (same-origin requests included);
 *   - X-Robots-Tag: noindex, nofollow (API JSON included; the pages also
 *     carry the robots meta from the root layout);
 *   - Cache-Control: private, no-store.
 *
 * next.config sets the first two on the same paths (static and edge cases
 * the middleware never sees), and robots.txt disallows the token paths.
 */

import { NextRequest } from 'next/server'
import { proxy } from '../proxy'
import { baseConfig } from '../../next.config'
import robots from '../app/robots'
import { isTokenPath } from '@/lib/security/token-paths'

const verifyCheckoutTokenMock = jest.fn()
jest.mock('@/lib/auth/checkout-token', () => ({
  verifyCheckoutToken: (token: string) => verifyCheckoutTokenMock(token),
}))
jest.mock('@supabase/ssr', () => ({
  createServerClient: jest.fn(() => ({ auth: { getUser: async () => ({ data: { user: null } }) } })),
}))

process.env['NEXT_PUBLIC_SUPABASE_URL']      = 'https://abcdefgh.supabase.co'
process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] = 'anon'

const T43 = 'A'.repeat(43)
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJvcmRlcklkIjoibyJ9.c2ln'

const req = (path: string, method = 'GET') => new NextRequest(new URL(`http://localhost${path}`), { method })

const TOKEN_PATHS = [
  `/checkout/${JWT}`,
  `/checkout?token=${JWT}`,
  '/checkout/expired',
  '/checkout/success',
  `/plan/${T43}`,
  `/api/plan/${T43}`,
  `/intake/${T43}`,
  `/api/intake/${T43}`,
  `/join/${T43}`,
  `/api/join/${T43}`,
  `/onboard/clinic/${T43}`,
  `/onboard/join/${T43}`,
  `/onboard/pharmacy/${T43}`,
  `/api/onboard/pharmacy/${T43}`,
  '/api/onboarding/invite/accept',
  '/api/checkout/payment-intent',
  '/api/checkout/payment-group-intent',
]

beforeEach(() => {
  verifyCheckoutTokenMock.mockReset().mockResolvedValue({ orderId: 'o-1', clinicId: 'c-1', exp: 9e9 })
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('middleware: every token path', () => {
  it.each(TOKEN_PATHS)('%s: no-referrer, noindex, private no-store', async path => {
    const res = await proxy(req(path))
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer')
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
    const cc = res.headers.get('Cache-Control') ?? ''
    expect(cc).toMatch(/no-store/)
    expect(cc).toMatch(/private/)
  })

  it('an invalid checkout token: the redirect to the neutral page carries the same headers', async () => {
    verifyCheckoutTokenMock.mockResolvedValue(null)
    const res = await proxy(req(`/checkout/${JWT}`))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('http://localhost/checkout/expired')
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer')
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
    expect(res.headers.get('Cache-Control')).toMatch(/no-store/)
  })

  it('POSTs to the token APIs too', async () => {
    for (const path of [`/api/plan/${T43}`, `/api/intake/${T43}`, `/api/join/${T43}`, '/api/checkout/payment-intent']) {
      const res = await proxy(req(path, 'POST'))
      expect(res.headers.get('Referrer-Policy')).toBe('no-referrer')
      expect(res.headers.get('Cache-Control')).toMatch(/no-store/)
    }
  })
})

describe('isTokenPath', () => {
  it.each(TOKEN_PATHS.map(p => p.split('?')[0]!))('%s is a token path', path => {
    expect(isTokenPath(path)).toBe(true)
  })

  it.each(['/plans', '/plans/x', '/checkoutx', '/joined', '/intakes', '/onboarding', '/onboarding/x', '/dashboard', '/login', '/api/orders/x/checkout-link'])(
    '%s is not', path => {
      expect(isTokenPath(path)).toBe(false)
    },
  )
})

describe('next.config: token paths get no-referrer and noindex after the global rule', () => {
  it('rules for each token area, ordered after /:path* so they win', async () => {
    const rules = await baseConfig.headers!()
    const globalAt = rules.findIndex(r => r.source === '/:path*')
    expect(globalAt).toBe(0)
    const tokenRules = rules.slice(1)
    for (const source of ['/checkout', '/checkout/:path*', '/plan/:path*', '/intake', '/intake/:path*', '/join/:path*', '/onboard/:path*',
      '/api/checkout/:path*', '/api/plan/:path*', '/api/intake/:path*', '/api/join/:path*', '/api/onboard/:path*', '/api/onboarding/invite/:path*']) {
      const rule = tokenRules.find(r => r.source === source)
      expect({ source, found: Boolean(rule) }).toEqual({ source, found: true })
      const h = Object.fromEntries(rule!.headers.map(x => [x.key, x.value]))
      expect(h['Referrer-Policy']).toBe('no-referrer')
      expect(h['X-Robots-Tag']).toBe('noindex, nofollow')
    }
  })
})

describe('robots.txt', () => {
  it('disallows every token path and the API, for every agent', () => {
    const r = robots()
    const rules = Array.isArray(r.rules) ? r.rules : [r.rules]
    const all = rules.find(x => x.userAgent === '*')
    expect(all).toBeDefined()
    const disallow = ([] as string[]).concat(all!.disallow ?? [])
    for (const p of ['/checkout', '/plan/', '/intake', '/join/', '/onboard/', '/api/']) expect(disallow).toContain(p)
  })
})
