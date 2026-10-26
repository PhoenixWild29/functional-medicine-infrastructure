/**
 * @jest-environment node
 *
 * D's verification (2026-10-26), finding 1: a Playwright context route is
 * called only for the first URL of a redirect chain, so a portal that
 * answers with a 302 / 307 to an http URL used to take the browser there,
 * and a 307 re-sent a submitted form (PHI or credentials) in cleartext.
 *
 * enforceHttpsOnly fetches every allowed request itself with
 * maxRedirects: 0. B's review R1 (2026-10-26): a 3xx handed back to
 * Chromium is followed past the route (302 -> 301 -> http reached the
 * blocked origin; 307 -> 307 -> http re-sent a form body), so the handler
 * now follows the whole chain itself, hop by hop, each Location checked,
 * at most MAX_PORTAL_REDIRECTS hops, and only the final non-3xx answer is
 * given to the browser.
 *
 * Part 1 drives the route handler with a scripted route (always runs).
 * Part 2 is D's Chromium probe as a real test: two local servers, "good"
 * and "bad", with the route's rule blocking "bad" the way http is blocked
 * in production. It runs when Playwright's Chromium is installed (local,
 * and the E2E job, which also runs e2e/portal-https-redirect.spec.ts); in a
 * job without browsers it is skipped and says so.
 */

import http from 'node:http'
import { existsSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { enforceHttpsOnly } from '../transmission-guard'

jest.spyOn(console, 'error').mockImplementation(() => {})

type Handler = (route: unknown) => Promise<void>

type Answer = { status: number; location?: string }
/** What the handler passes to route.fetch for a hop. */
type FetchOptions = { url?: string; method?: string; postData?: Buffer; headers?: Record<string, string>; maxRedirects?: number }

/** A route whose fetch answers each hop in turn (the last answer repeats). */
function scriptedRoute(url: string, response?: Answer | Answer[], request: { method?: string; body?: string; headers?: Record<string, string> } = {}) {
  const answers = Array.isArray(response) ? response : [response ?? { status: 200 }]
  let i = 0
  return {
    request: () => ({
      url: () => url,
      method: () => request.method ?? 'GET',
      postDataBuffer: () => (request.body !== undefined ? Buffer.from(request.body) : null),
      headers: () => request.headers ?? {},
    }),
    abort:   jest.fn(async () => undefined),
    continue: jest.fn(async () => undefined),
    fetch:   jest.fn<Promise<{ status: () => number; headers: () => Record<string, string> }>, [FetchOptions?]>(async () => {
      const a = answers[Math.min(i++, answers.length - 1)]!
      return { status: () => a.status, headers: () => (a.location ? { location: a.location } : {}) }
    }),
    fulfill: jest.fn(async () => undefined),
  }
}

async function handlerFor(isAllowed?: (url: string) => boolean): Promise<Handler> {
  const route = jest.fn()
  await enforceHttpsOnly({ route } as never, isAllowed)
  return route.mock.calls[0]![1] as Handler
}

describe('the route handler (scripted)', () => {
  it('a request that is not allowed is aborted and never fetched', async () => {
    const h = await handlerFor()
    const r = scriptedRoute('http://portal.pharm.test/login')
    await h(r)
    expect(r.abort).toHaveBeenCalled()
    expect(r.fetch).not.toHaveBeenCalled()
    expect(r.fulfill).not.toHaveBeenCalled()
  })

  it('an allowed request is fetched without following redirects, and its answer fulfilled', async () => {
    const h = await handlerFor()
    const r = scriptedRoute('https://portal.pharm.test/login')
    await h(r)
    expect(r.fetch).toHaveBeenCalledWith(expect.objectContaining({ maxRedirects: 0 }))
    expect(r.fulfill).toHaveBeenCalled()
    expect(r.abort).not.toHaveBeenCalled()
  })

  it.each([301, 302, 303, 307, 308])('a %i to http is aborted: the browser never takes the hop', async status => {
    const h = await handlerFor()
    const r = scriptedRoute('https://portal.pharm.test/submit', { status, location: 'http://portal.pharm.test/landed' })
    await h(r)
    expect(r.abort).toHaveBeenCalled()
    expect(r.fulfill).not.toHaveBeenCalled()
  })

  it('a relative Location is resolved against the request; a redirect with no Location is aborted', async () => {
    const h = await handlerFor()
    const ok = scriptedRoute('https://portal.pharm.test/submit', [{ status: 302, location: '/done' }, { status: 200 }])
    await h(ok)
    expect(ok.fetch.mock.calls[1]![0]).toEqual(expect.objectContaining({ url: 'https://portal.pharm.test/done' }))
    expect(ok.fulfill).toHaveBeenCalled()
    const none = scriptedRoute('https://portal.pharm.test/submit', { status: 302 })
    await h(none)
    expect(none.abort).toHaveBeenCalled()
  })

  it('R1: an allowed redirect is followed here, never handed to the browser; only the final answer is fulfilled', async () => {
    const h = await handlerFor()
    const r = scriptedRoute('https://portal.pharm.test/submit', [{ status: 307, location: 'https://portal.pharm.test/done' }, { status: 200 }])
    await h(r)
    expect(r.fetch).toHaveBeenCalledTimes(2)
    expect(r.fetch.mock.calls[1]![0]).toEqual(expect.objectContaining({ url: 'https://portal.pharm.test/done', maxRedirects: 0 }))
    expect(r.fulfill).toHaveBeenCalledTimes(1)
    const fulfilled = (r.fulfill.mock.calls as unknown as Array<[{ response: { status: () => number } }]>)[0]![0]
    expect(fulfilled.response.status()).toBe(200)
  })

  it('R1: an http Location after an allowed hop is refused (302 -> 301 -> http)', async () => {
    const h = await handlerFor()
    const r = scriptedRoute('https://portal.pharm.test/chain', [
      { status: 302, location: 'https://portal.pharm.test/chain2' },
      { status: 301, location: 'http://portal.pharm.test/chain-end' },
    ])
    await h(r)
    expect(r.fetch).toHaveBeenCalledTimes(2)
    expect(r.abort).toHaveBeenCalled()
    expect(r.fulfill).not.toHaveBeenCalled()
  })

  it('R1: 307 and 308 keep the method and the body on every hop', async () => {
    for (const status of [307, 308]) {
      const h = await handlerFor()
      const r = scriptedRoute('https://portal.pharm.test/submit', [{ status, location: '/submit2' }, { status: 200 }], { method: 'POST', body: 'phi=x', headers: { 'content-type': 'application/x-www-form-urlencoded' } })
      await h(r)
      expect(r.fetch.mock.calls[1]![0]).toEqual(expect.objectContaining({ url: 'https://portal.pharm.test/submit2', method: 'POST' }))
      expect(String(r.fetch.mock.calls[1]![0]!.postData)).toBe('phi=x')
    }
  })

  it('R1: 301 and 302 after a POST, and 303, continue as GET with no body', async () => {
    for (const status of [301, 302, 303]) {
      const h = await handlerFor()
      const r = scriptedRoute('https://portal.pharm.test/submit', [{ status, location: '/done' }, { status: 200 }], { method: 'POST', body: 'phi=x', headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': '5' } })
      await h(r)
      const next = r.fetch.mock.calls[1]![0]!
      expect(next.method).toBe('GET')
      expect(next.postData).toBeUndefined()
      expect(next.headers!['content-type']).toBeUndefined()
      expect(next.headers!['content-length']).toBeUndefined()
    }
  })

  it('R1: a hop to another origin carries no cookie or authorization header', async () => {
    const h = await handlerFor()
    const r = scriptedRoute('https://portal.pharm.test/a', [{ status: 302, location: 'https://sso.pharm-idp.test/b' }, { status: 200 }], { headers: { cookie: 'sid=1', authorization: 'Basic x', accept: 'text/html' } })
    await h(r)
    const next = r.fetch.mock.calls[1]![0]!
    expect(next.headers!['cookie']).toBeUndefined()
    expect(next.headers!['authorization']).toBeUndefined()
    expect(next.headers!['accept']).toBe('text/html')
  })

  it('R1: more than the hop cap is refused', async () => {
    const h = await handlerFor()
    const r = scriptedRoute('https://portal.pharm.test/loop', { status: 302, location: 'https://portal.pharm.test/loop' })
    await h(r)
    expect(r.abort).toHaveBeenCalled()
    expect(r.fulfill).not.toHaveBeenCalled()
    expect(r.fetch.mock.calls.length).toBeLessThanOrEqual(6)
  })

  it('a fetch that fails is aborted, not continued', async () => {
    const h = await handlerFor()
    const r = scriptedRoute('https://portal.pharm.test/x')
    r.fetch.mockRejectedValueOnce(new Error('ECONNRESET'))
    await h(r)
    expect(r.abort).toHaveBeenCalled()
    expect(r.continue).not.toHaveBeenCalled()
  })
})

// ── D's probe, in Chromium ───────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { chromium } = require('playwright') as typeof import('playwright')
const chromiumInstalled = (() => {
  try { return existsSync(chromium.executablePath()) } catch { return false }
})()
if (!chromiumInstalled) console.warn('[portal-redirect-hops] Playwright Chromium is not installed here: the Chromium part is skipped (it runs in the E2E job).')

const describeChromium = chromiumInstalled ? describe : describe.skip

describeChromium('in Chromium: no redirect hop reaches a blocked origin', () => {
  jest.setTimeout(60_000)
  const hits: string[] = []
  let good: http.Server
  let bad: http.Server
  const port = (s: http.Server) => (s.address() as AddressInfo).port

  beforeAll(async () => {
    bad = http.createServer((req, res) => {
      let body = ''
      req.on('data', c => { body += c })
      req.on('end', () => { hits.push(`${req.method} ${req.url} body=${body}`); res.end('<html>bad</html>') })
    })
    good = http.createServer((req, res) => {
      const badUrl = `http://127.0.0.1:${port(bad)}`
      if (req.url === '/start') { res.writeHead(302, { Location: `${badUrl}/landed` }); return res.end() }
      if (req.url === '/form') {
        res.setHeader('content-type', 'text/html')
        return res.end('<form method="post" action="/post"><input name="phi" value="Jane Doe 1980-01-01"><button id="go">go</button></form>')
      }
      if (req.url === '/post') { res.writeHead(307, { Location: `${badUrl}/posted` }); return res.end() }
      if (req.url === '/hop') { res.writeHead(302, { Location: '/form' }); return res.end() }
      // B's review R1: a redirect to the blocked origin after an allowed hop.
      if (req.url === '/chain') { res.writeHead(302, { Location: '/chain2' }); return res.end() }
      if (req.url === '/chain2') { res.writeHead(301, { Location: `${badUrl}/chain-end` }); return res.end() }
      if (req.url === '/form2') {
        res.setHeader('content-type', 'text/html')
        return res.end('<form method="post" action="/submit"><input name="phi" value="Jane Doe 1980-01-01"><button id="go2">go</button></form>')
      }
      if (req.url === '/submit') { res.writeHead(307, { Location: '/submit2' }); return res.end() }
      if (req.url === '/submit2') { res.writeHead(307, { Location: `${badUrl}/steal` }); return res.end() }
      // A login that sets its session on the redirect: the cookie must reach the next hop.
      if (req.url === '/login') { res.writeHead(302, { Location: '/home', 'Set-Cookie': 'sid=abc; Path=/' }); return res.end() }
      if (req.url === '/home') {
        res.setHeader('content-type', 'text/html')
        return res.end(/sid=abc/.test(req.headers.cookie ?? '') ? '<p id="home">home ok</p>' : '<p id="home">no session</p>')
      }
      res.end('ok')
    })
    await new Promise<void>(r => bad.listen(0, '127.0.0.1', r))
    await new Promise<void>(r => good.listen(0, '127.0.0.1', r))
  })
  afterAll(() => { good.close(); bad.close() })

  it('a 302 navigation and a 307 form post to the blocked origin never reach it; an allowed redirect still works', async () => {
    const browser = await chromium.launch()
    try {
      const context = await browser.newContext()
      const badPort = String(port(bad))
      // The production rule blocks non-https; here "bad" stands for it.
      await enforceHttpsOnly(context, url => new URL(url).port !== badPort)
      const page = await context.newPage()
      const base = `http://127.0.0.1:${port(good)}`

      await page.goto(`${base}/start`).catch(() => undefined)
      expect(page.url()).not.toContain(`:${badPort}`)

      // A fresh page: the aborted hop leaves the first on Chromium's error page.
      const form = await context.newPage()
      // An allowed redirect (to the same origin) is still followed. The
      // handler follows it, so the page keeps the first (checked) URL and
      // shows the final answer.
      await form.goto(`${base}/hop`)
      expect(await form.locator('#go').count()).toBe(1)

      await Promise.all([form.waitForLoadState('load').catch(() => undefined), form.click('#go')])
      await form.waitForTimeout(1_000)
      expect(form.url()).not.toContain(`:${badPort}`)

      expect(hits).toEqual([])
    } finally {
      await browser.close()
    }
  })

  // B's review R1, both chains, in Chromium.
  it('R1: 302 -> 301 -> blocked origin: the blocked origin receives nothing', async () => {
    const browser = await chromium.launch()
    try {
      const context = await browser.newContext()
      const badPort = String(port(bad))
      await enforceHttpsOnly(context, url => new URL(url).port !== badPort)
      const page = await context.newPage()
      hits.length = 0
      await page.goto(`http://127.0.0.1:${port(good)}/chain`).catch(() => undefined)
      await page.waitForTimeout(500)
      expect(hits).toEqual([])
    } finally {
      await browser.close()
    }
  })

  it('R1: a form POST 307 -> 307 -> blocked origin: the blocked origin receives nothing, body included', async () => {
    const browser = await chromium.launch()
    try {
      const context = await browser.newContext()
      const badPort = String(port(bad))
      await enforceHttpsOnly(context, url => new URL(url).port !== badPort)
      const page = await context.newPage()
      hits.length = 0
      await page.goto(`http://127.0.0.1:${port(good)}/form2`)
      await Promise.all([page.waitForLoadState('load').catch(() => undefined), page.click('#go2')])
      await page.waitForTimeout(1_000)
      expect(hits).toEqual([])
    } finally {
      await browser.close()
    }
  })

  it('a session cookie set on an allowed redirect reaches the next hop (portal logins keep working)', async () => {
    const browser = await chromium.launch()
    try {
      const context = await browser.newContext()
      const badPort = String(port(bad))
      await enforceHttpsOnly(context, url => new URL(url).port !== badPort)
      const page = await context.newPage()
      await page.goto(`http://127.0.0.1:${port(good)}/login`)
      expect(await page.locator('#home').textContent()).toBe('home ok')
    } finally {
      await browser.close()
    }
  })
})
