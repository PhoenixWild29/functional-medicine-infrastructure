/**
 * @jest-environment node
 *
 * scripts/smoke/smoke-checks.js: the pure parts of the prod public smoke
 * (scripts/smoke/prod-public-smoke.mjs): argument parsing and the header,
 * robots and page-text rules. The network parts run only against a real
 * deployment.
 */

import { join } from 'node:path'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const C = require(join(process.cwd(), 'scripts', 'smoke', 'smoke-checks.js')) as {
  parseArgs: (a: string[]) => { base?: string; error?: string; help?: boolean; usage?: string }
  checkCsp: (v?: string | null) => { ok: boolean; observed: string }
  checkHsts: (v?: string | null) => { ok: boolean }
  checkFrameOptions: (v?: string | null) => { ok: boolean }
  checkReferrer: (v: string | null | undefined, accepted: string[]) => { ok: boolean; which: string | null }
  checkNoStore: (v?: string | null) => { ok: boolean }
  checkNoindex: (h?: string | null, m?: string | null) => { ok: boolean; header: boolean; meta: boolean }
  checkRobotsTxt: (t: string, paths: string[]) => { ok: boolean; missing: string[] }
  hasStackTrace: (t: string) => boolean
  line: (s: string, n: string, o?: string) => string
}

const PROD = 'https://functional-medicine-infrastructure.vercel.app'

describe('parseArgs', () => {
  it('--base <url> and --base=<url>; the origin, without a trailing slash', () => {
    expect(C.parseArgs(['--base', PROD])).toEqual({ base: PROD })
    expect(C.parseArgs([`--base=${PROD}/`])).toEqual({ base: PROD })
  })

  it('refuses a missing base, a non-URL, another scheme, a path or query, and unknown flags', () => {
    expect(C.parseArgs([]).error).toBe('Missing --base')
    expect(C.parseArgs(['--base']).error).toBe('Missing --base')
    expect(C.parseArgs(['--base', 'not a url']).error).toMatch(/Not a URL/)
    expect(C.parseArgs(['--base', 'ftp://x.test']).error).toMatch(/Not an http/)
    expect(C.parseArgs(['--base', `${PROD}/login`]).error).toMatch(/origin only/)
    expect(C.parseArgs(['--base', `${PROD}?a=1`]).error).toMatch(/origin only/)
    expect(C.parseArgs(['--base', PROD, '--write']).error).toBe('Unknown argument: --write')
  })

  it('--help prints the usage', () => {
    expect(C.parseArgs(['--help'])).toEqual(expect.objectContaining({ help: true, usage: expect.stringContaining('--base') }))
  })
})

describe('header checks', () => {
  it('CSP: a nonce in script-src, never unsafe-inline there', () => {
    expect(C.checkCsp("default-src 'self'; script-src 'self' 'nonce-QUJDREVGR0hJSktMTU5PUA==' https://js.stripe.com; style-src 'self' 'unsafe-inline'").ok).toBe(true)
    expect(C.checkCsp("default-src 'self'; script-src 'self'").ok).toBe(false)
    expect(C.checkCsp("script-src 'self' 'nonce-QUJDREVGR0hJSktMTU5PUA==' 'unsafe-inline'").ok).toBe(false)
    expect(C.checkCsp(null).ok).toBe(false)
  })

  it('HSTS: max-age=63072000 exactly, with includeSubDomains', () => {
    expect(C.checkHsts('max-age=63072000; includeSubDomains').ok).toBe(true)
    expect(C.checkHsts('max-age=63072000; includeSubDomains; preload').ok).toBe(true)
    expect(C.checkHsts('max-age=31536000; includeSubDomains').ok).toBe(false)
    expect(C.checkHsts('max-age=630720000; includeSubDomains').ok).toBe(false)
    expect(C.checkHsts('max-age=63072000').ok).toBe(false)
    expect(C.checkHsts(undefined).ok).toBe(false)
  })

  it('X-Frame-Options DENY (any case)', () => {
    expect(C.checkFrameOptions('DENY').ok).toBe(true)
    expect(C.checkFrameOptions('deny').ok).toBe(true)
    expect(C.checkFrameOptions('SAMEORIGIN').ok).toBe(false)
    expect(C.checkFrameOptions(null).ok).toBe(false)
  })

  it('Referrer-Policy: one of the accepted values, and which', () => {
    expect(C.checkReferrer('no-referrer', ['no-referrer', 'strict-origin-when-cross-origin'])).toEqual(expect.objectContaining({ ok: true, which: 'no-referrer' }))
    expect(C.checkReferrer('strict-origin-when-cross-origin', ['no-referrer', 'strict-origin-when-cross-origin']).which).toBe('strict-origin-when-cross-origin')
    expect(C.checkReferrer('unsafe-url', ['no-referrer']).ok).toBe(false)
    expect(C.checkReferrer(undefined, ['no-referrer']).ok).toBe(false)
  })

  it('Cache-Control: private and no-store both', () => {
    expect(C.checkNoStore('private, no-cache, no-store, max-age=0, must-revalidate').ok).toBe(true)
    expect(C.checkNoStore('no-store, no-cache, must-revalidate, private').ok).toBe(true)
    expect(C.checkNoStore('no-store').ok).toBe(false)
    expect(C.checkNoStore('public, max-age=3600').ok).toBe(false)
  })

  it('noindex from the header or the meta tag', () => {
    expect(C.checkNoindex('noindex, nofollow', null)).toEqual(expect.objectContaining({ ok: true, header: true, meta: false }))
    expect(C.checkNoindex(null, 'noindex, nofollow')).toEqual(expect.objectContaining({ ok: true, header: false, meta: true }))
    expect(C.checkNoindex('index', 'index, follow').ok).toBe(false)
  })
})

describe('robots.txt and page text', () => {
  const ROBOTS = 'User-Agent: *\nDisallow: /checkout\nDisallow: /intake\nDisallow: /plan/\nDisallow: /join/\nDisallow: /onboard/\nDisallow: /api/\n'

  it('every token path disallowed for User-agent: *', () => {
    expect(C.checkRobotsTxt(ROBOTS, ['/checkout', '/plan/', '/api/']).ok).toBe(true)
    const r = C.checkRobotsTxt('User-agent: *\nDisallow: /api/\n', ['/plan/', '/api/'])
    expect(r).toEqual(expect.objectContaining({ ok: false, missing: ['/plan/'] }))
    // A disallow for another agent does not count.
    expect(C.checkRobotsTxt('User-agent: Googlebot\nDisallow: /plan/\n', ['/plan/']).ok).toBe(false)
  })

  it('stack traces and framework error pages are recognised; plain copy is not', () => {
    expect(C.hasStackTrace('TypeError: x is undefined\n    at Foo (/app/.next/server/chunk.js:1:2)')).toBe(true)
    expect(C.hasStackTrace('Unhandled Runtime Error')).toBe(true)
    expect(C.hasStackTrace('Application error: a client-side exception has occurred')).toBe(true)
    expect(C.hasStackTrace('This link is no longer active\nPlease contact your clinic.')).toBe(false)
  })

  it('one line per check', () => {
    expect(C.line('PASS', 'GET /api/health', '200')).toBe('PASS GET /api/health: 200')
    expect(C.line('INFO', 'requests')).toBe('INFO requests')
  })
})
