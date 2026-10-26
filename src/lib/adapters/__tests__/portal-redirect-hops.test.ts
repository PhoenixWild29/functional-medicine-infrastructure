/**
 * @jest-environment node
 *
 * D's verification (2026-10-26), finding 1: a Playwright context route is
 * called only for the first URL of a redirect chain, so a portal that
 * answers with a 302 / 307 to an http URL used to take the browser there,
 * and a 307 re-sent a submitted form (PHI or credentials) in cleartext.
 *
 * enforceHttpsOnly now fetches every allowed request itself with
 * maxRedirects: 0. A redirect whose Location is not allowed is aborted; an
 * allowed one is handed back to the browser, whose next hop is a new
 * request and goes through the route again.
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

function scriptedRoute(url: string, response?: { status: number; location?: string }) {
  return {
    request: () => ({ url: () => url }),
    abort:   jest.fn(async () => undefined),
    continue: jest.fn(async () => undefined),
    fetch:   jest.fn(async () => ({
      status: () => response?.status ?? 200,
      headers: () => (response?.location ? { location: response.location } : {}),
    })),
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
    const ok = scriptedRoute('https://portal.pharm.test/submit', { status: 302, location: '/done' })
    await h(ok)
    expect(ok.fulfill).toHaveBeenCalled()
    const none = scriptedRoute('https://portal.pharm.test/submit', { status: 302 })
    await h(none)
    expect(none.abort).toHaveBeenCalled()
  })

  it('a redirect to https is handed back to the browser (its next hop is routed again)', async () => {
    const h = await handlerFor()
    const r = scriptedRoute('https://portal.pharm.test/submit', { status: 307, location: 'https://portal.pharm.test/done' })
    await h(r)
    expect(r.fulfill).toHaveBeenCalled()
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
      // An allowed redirect (to the same origin) is still followed.
      await form.goto(`${base}/hop`)
      expect(form.url()).toBe(`${base}/form`)

      await Promise.all([form.waitForLoadState('load').catch(() => undefined), form.click('#go')])
      await form.waitForTimeout(1_000)
      expect(form.url()).not.toContain(`:${badPort}`)

      expect(hits).toEqual([])
    } finally {
      await browser.close()
    }
  })
})
