// ============================================================
// Portal browser: no redirect hop to a blocked origin (HIPAA B17)
// ============================================================
//
// D's verification (2026-10-26), finding 1, as a browser test in the E2E
// job (which has Chromium installed). A Playwright context route is called
// only for the first URL of a redirect chain, so the Tier 2 portal browser
// used to follow a 302 / 307 to http, and a 307 re-sent a submitted form.
// enforceHttpsOnly (lib/adapters/transmission-guard) now fetches each
// allowed request itself with maxRedirects: 0 and refuses a Location that
// is not allowed.
//
// No app page is used: two local servers stand for the portal ("good") and
// an http origin ("bad"), and the route's rule blocks "bad" the way the
// production rule blocks http. The same probe runs in jest
// (src/lib/adapters/__tests__/portal-redirect-hops.test.ts) wherever
// Chromium is installed.

import { test, expect } from '@playwright/test'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { enforceHttpsOnly } from '../src/lib/adapters/transmission-guard'

test('a 302 navigation and a 307 form post to a blocked origin never reach it', async ({ browser }) => {
  const hits: string[] = []
  const port = (s: http.Server) => (s.address() as AddressInfo).port
  const bad = http.createServer((req, res) => {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => { hits.push(`${req.method} ${req.url} body=${body}`); res.end('<html>bad</html>') })
  })
  const good = http.createServer((req, res) => {
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

  const context = await browser.newContext()
  try {
    const badPort = String(port(bad))
    await enforceHttpsOnly(context, url => new URL(url).port !== badPort)
    const page = await context.newPage()
    const base = `http://127.0.0.1:${port(good)}`

    await page.goto(`${base}/start`).catch(() => undefined)
    expect(page.url()).not.toContain(`:${badPort}`)

    // An allowed redirect is still followed.
    await page.goto(`${base}/hop`)
    expect(page.url()).toBe(`${base}/form`)

    await Promise.all([page.waitForLoadState('load').catch(() => undefined), page.click('#go')])
    await page.waitForTimeout(1_000)
    expect(page.url()).not.toContain(`:${badPort}`)

    expect(hits).toEqual([])
  } finally {
    await context.close()
    good.close()
    bad.close()
  }
})
