#!/usr/bin/env node
// ============================================================
// Prod public smoke: read only, no sign-in, no writes
// ============================================================
//
//   node scripts/smoke/prod-public-smoke.mjs --base https://functional-medicine-infrastructure.vercel.app
//
// Run by the orchestrator against prod after every merge. Node 20+, the
// repo's @playwright/test (Chromium), no build. It only makes GET requests
// and opens public pages: it never signs in, never submits a form and
// never calls a write endpoint. Requests go one at a time; the script
// makes 14 top-level requests (6 GETs and 8 page loads; the page loads
// also fetch their own scripts and styles), and prints the browser's total.
//
// One line per check: PASS, FAIL or INFO with what it observed. Exit 1 on
// any FAIL, 2 on bad arguments.
//
// Some checks accept the state before and after a pending change and say
// which they saw (INFO), so the script passes both before and after it
// merges: the neutral link pages and Referrer-Policy (token-pages-hardening),
// the not-found page (error-boundaries), robots.txt (token-pages-hardening).

import { createRequire } from 'node:module'
import { randomBytes } from 'node:crypto'
import { chromium, request as pwRequest } from '@playwright/test'

const require = createRequire(import.meta.url)
const C = require('./smoke-checks.js')

const args = C.parseArgs(process.argv.slice(2))
if (args.help) { console.log(args.usage); process.exit(0) }
if (args.error) { console.error(`${args.error}\n${args.usage}`); process.exit(2) }
const BASE = args.base

let failed = 0
const out = (status, name, observed) => {
  if (status === 'FAIL') failed++
  console.log(C.line(status, name, observed))
}
const check = (name, r, observed = r.observed) => out(r.ok ? 'PASS' : 'FAIL', name, observed)

const token = () => randomBytes(32).toString('base64url')   // 43 characters, the shape of a real link token
let topLevel = 0

// ── HTTP checks: no redirects followed, nothing but GET ──
const api = await pwRequest.newContext({ baseURL: BASE, maxRedirects: 0, extraHTTPHeaders: { 'user-agent': 'compoundiq-prod-public-smoke' } })
const get = async path => { topLevel++; return api.get(path, { maxRedirects: 0, failOnStatusCode: false }) }

// 1. /api/health: 200 { ok: true, timestamp, version }
{
  const r = await get('/api/health')
  let body = null
  try { body = await r.json() } catch { /* not JSON */ }
  const shape = body && body.ok === true && typeof body.timestamp === 'string' && !Number.isNaN(Date.parse(body.timestamp)) && typeof body.version === 'string'
  out(r.status() === 200 && shape ? 'PASS' : 'FAIL', 'GET /api/health is 200 { ok: true, timestamp, version }', `${r.status()} ${JSON.stringify(body)}`)
}

// 2. Security headers on / (an anonymous visit is a redirect to /login; the headers are on every response)
const securityHeaders = (path, h) => {
  check(`${path} Content-Security-Policy has a script nonce`, C.checkCsp(h['content-security-policy']))
  check(`${path} Strict-Transport-Security max-age=63072000; includeSubDomains`, C.checkHsts(h['strict-transport-security']))
  check(`${path} X-Frame-Options DENY`, C.checkFrameOptions(h['x-frame-options']))
  check(`${path} Referrer-Policy strict-origin-when-cross-origin`, C.checkReferrer(h['referrer-policy'], ['strict-origin-when-cross-origin']))
}
{
  const r = await get('/')
  out('INFO', 'GET / status', `${r.status()} ${r.headers()['location'] ?? ''}`.trim())
  securityHeaders('/', r.headers())
}

// 3. /login: the same headers, and never cached
{
  const r = await get('/login')
  const h = r.headers()
  out(r.status() === 200 ? 'PASS' : 'FAIL', 'GET /login is 200', String(r.status()))
  securityHeaders('/login', h)
  check('/login Cache-Control private, no-store', C.checkNoStore(h['cache-control']))
}

// 4. Redirects
{
  const r = await get('/dashboard?x=1')
  const loc = r.headers()['location'] ?? ''
  const path = loc ? new URL(loc, BASE).pathname + new URL(loc, BASE).search : ''
  out(r.status() === 307 && path === '/login?redirectTo=%2Fdashboard%3Fx%3D1' ? 'PASS' : 'FAIL',
    'GET /dashboard?x=1 is 307 to /login?redirectTo=%2Fdashboard%3Fx%3D1', `${r.status()} ${loc || '(no location)'}`)
}
{
  const r = await get('/checkout/garbage')
  const loc = r.headers()['location'] ?? ''
  const path = loc ? new URL(loc, BASE).pathname : ''
  out(r.status() >= 300 && r.status() < 400 && path === '/checkout/expired' ? 'PASS' : 'FAIL',
    'GET /checkout/garbage redirects to /checkout/expired', `${r.status()} ${loc || '(no location)'}`)
}

// 5. robots.txt (token-pages-hardening adds it; before that it is a 404)
{
  const r = await get('/robots.txt')
  if (r.status() === 404) {
    out('INFO', 'robots.txt', '404: not served yet (before token-pages-hardening)')
  } else {
    const text = await r.text()
    check('robots.txt disallows the token paths', C.checkRobotsTxt(text, ['/checkout', '/intake', '/plan/', '/join/', '/onboard/', '/api/']))
  }
}
await api.dispose()

// ── Pages in Chromium: headings, neutral link pages, not-found, console errors ──
const browser = await chromium.launch()
const context = await browser.newContext({ userAgent: 'compoundiq-prod-public-smoke' })
let subrequests = 0
context.on('request', () => { subrequests++ })
const page = await context.newPage()
let consoleErrors = []
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()) })
page.on('pageerror', e => { consoleErrors.push(`pageerror: ${e.message}`) })

async function open(path) {
  consoleErrors = []
  topLevel++
  const res = await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 45_000 })
  const h1 = (await page.locator('h1').first().textContent({ timeout: 10_000 }).catch(() => null))?.trim() ?? null
  const body = await page.locator('body').innerText().catch(() => '')
  const meta = await page.locator('meta[name="robots"]').first().getAttribute('content').catch(() => null)
  return { res, status: res?.status() ?? 0, headers: res?.headers() ?? {}, h1, body, meta }
}
function noConsoleErrors(path) {
  out(consoleErrors.length === 0 ? 'PASS' : 'FAIL', `${path} no console errors`, consoleErrors.length === 0 ? 'none' : consoleErrors.map(e => e.slice(0, 200)).join(' | '))
}

// 6. Public pages and their headings
for (const [path, heading] of [
  ['/login', 'Sign in'],
  ['/get-started', 'Get started with CompoundIQ'],
  ['/legal/privacy', 'Privacy Policy'],
  ['/legal/patient-terms', 'Patient Terms of Use'],
]) {
  const p = await open(path)
  out(p.status === 200 && p.h1 === heading ? 'PASS' : 'FAIL', `${path} renders with h1 "${heading}"`, `${p.status} h1=${JSON.stringify(p.h1)}`)
  noConsoleErrors(path)
}

// 7. Neutral invalid-link pages: never a stack trace, noindex, no-referrer
for (const [prefix, accepted] of [
  ['/plan', ['This link is no longer active', 'This link is not valid']],
  ['/intake', ['This link is no longer active', 'This link is not valid']],
  ['/join', ['This link is no longer active']],
]) {
  const t = token()
  const p = await open(`${prefix}/${t}`)
  const label = `${prefix}/<random>`
  const which = accepted.indexOf(p.h1)
  out(which >= 0 ? 'PASS' : 'FAIL', `${label} shows the neutral page`, `${p.status} h1=${JSON.stringify(p.h1)}`)
  if (which > 0) out('INFO', `${label} copy`, 'the pre-token-pages-hardening wording')
  out(!C.hasStackTrace(p.body) && !p.body.includes(t) ? 'PASS' : 'FAIL', `${label} no stack trace and no token on the page`, C.hasStackTrace(p.body) ? 'stack trace found' : p.body.includes(t) ? 'token shown' : 'clean')
  const ni = C.checkNoindex(p.headers['x-robots-tag'], p.meta)
  check(`${label} noindex`, ni)
  const rp = C.checkReferrer(p.headers['referrer-policy'], ['no-referrer', 'strict-origin-when-cross-origin'])
  check(`${label} Referrer-Policy`, rp)
  if (rp.which === 'strict-origin-when-cross-origin') out('INFO', `${label} Referrer-Policy`, 'not no-referrer yet (before token-pages-hardening)')
  noConsoleErrors(label)
}

// 8. Not found. A clinic URL needs a session (an anonymous visit goes to
// /login), so the anonymous check uses a public path that does not exist:
// the root not-found page. Either the friendly page (error-boundaries) or
// the old one passes, and the line says which.
{
  const p = await open('/legal/no-such-page')
  const friendly = p.h1 === 'Page not found', old = p.h1 === '404'
  out(p.status === 404 && (friendly || old) && !C.hasStackTrace(p.body) ? 'PASS' : 'FAIL',
    '/legal/no-such-page is the not-found page', `${p.status} h1=${JSON.stringify(p.h1)} (${friendly ? 'friendly page' : old ? 'old page' : 'unexpected'})`)
  // A missing page logs its own 404 resource error in the console; only other errors count.
  consoleErrors = consoleErrors.filter(e => !/status of 404/.test(e))
  noConsoleErrors('/legal/no-such-page')
}

await browser.close()
out('INFO', 'requests', `${topLevel} top-level (GETs and page loads), ${subrequests} made by the browser in all`)
console.log(failed ? `${failed} FAILED` : 'ALL PASS')
process.exit(failed ? 1 : 0)
