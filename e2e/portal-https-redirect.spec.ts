// ============================================================
// Portal browser: no redirect hop to a blocked origin (HIPAA B17)
// ============================================================
//
// D's verification (2026-10-26), finding 1, as a browser test in the E2E
// job (which has Chromium installed). A Playwright context route is called
// only for the first URL of a redirect chain, so the Tier 2 portal browser
// used to follow a 302 / 307 to http, and a 307 re-sent a submitted form.
// enforceHttpsOnly (lib/adapters/transmission-guard) follows the whole
// redirect chain itself, hop by hop with maxRedirects: 0, refusing any
// Location that is not allowed (B's review R1: a 3xx handed back to
// Chromium was followed past the route), and turns a 303 (or a 301 / 302
// after a POST) into a GET with no body (A's verification V1).
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

test('no redirect hop reaches a blocked origin, and a redirected GET carries no form body', async ({ browser }) => {
  const hits: string[] = []
  const goodHits: string[] = []
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
    // B's review R1: a redirect to the blocked origin after an allowed hop.
    if (req.url === '/chain') { res.writeHead(302, { Location: '/chain2' }); return res.end() }
    if (req.url === '/chain2') { res.writeHead(301, { Location: `${badUrl}/chain-end` }); return res.end() }
    if (req.url === '/form2') {
      res.setHeader('content-type', 'text/html')
      return res.end('<form method="post" action="/submit"><input name="phi" value="Jane Doe 1980-01-01"><button id="go2">go</button></form>')
    }
    if (req.url === '/submit') { res.writeHead(307, { Location: '/submit2' }); return res.end() }
    if (req.url === '/submit2') { res.writeHead(307, { Location: `${badUrl}/steal` }); return res.end() }
    // A's V1: POST -> 307 -> 303 -> a GET on the same origin, with no body.
    if (req.url === '/form3') {
      res.setHeader('content-type', 'text/html')
      return res.end('<form method="post" action="/post-ok"><input name="phi" value="Jane Doe 1980-01-01"><button id="go3">go</button></form>')
    }
    if (req.url === '/post-ok' || req.url === '/post-ok2' || req.url === '/done') {
      let body = ''
      req.on('data', c => { body += c })
      return req.on('end', () => {
        goodHits.push(`${req.method} ${req.url} body=${body}`)
        if (req.url === '/post-ok') { res.writeHead(307, { Location: '/post-ok2' }); return res.end() }
        if (req.url === '/post-ok2') { res.writeHead(303, { Location: '/done' }); return res.end() }
        res.setHeader('content-type', 'text/html')
        res.end('<p id="done">done</p>')
      })
    }
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

    // A fresh page: the aborted hop leaves the first on Chromium's error page.
    const form = await context.newPage()
    // An allowed redirect is still followed (by the route, so the page keeps
    // the first, checked URL and shows the final answer).
    await form.goto(`${base}/hop`)
    await expect(form.locator('#go')).toHaveCount(1)

    await Promise.all([form.waitForLoadState('load').catch(() => undefined), form.click('#go')])
    await form.waitForTimeout(1_000)
    expect(form.url()).not.toContain(`:${badPort}`)
    expect(hits).toEqual([])

    // B's review R1: 302 -> 301 -> blocked origin.
    const chain = await context.newPage()
    await chain.goto(`${base}/chain`).catch(() => undefined)
    await chain.waitForTimeout(500)
    expect(hits).toEqual([])

    // B's review R1: a form POST 307 -> 307 -> blocked origin, body and all.
    const form2 = await context.newPage()
    await form2.goto(`${base}/form2`)
    await Promise.all([form2.waitForLoadState('load').catch(() => undefined), form2.click('#go2')])
    await form2.waitForTimeout(1_000)
    expect(hits).toEqual([])

    // A's V1: POST -> 307 -> 303: the 307 keeps the body, the GET carries none.
    const form3 = await context.newPage()
    await form3.goto(`${base}/form3`)
    await Promise.all([form3.waitForLoadState('load').catch(() => undefined), form3.click('#go3')])
    await form3.locator('#done').waitFor()
    expect(goodHits).toEqual([
      'POST /post-ok body=phi=Jane+Doe+1980-01-01',
      'POST /post-ok2 body=phi=Jane+Doe+1980-01-01',
      'GET /done body=',
    ])
  } finally {
    await context.close()
    good.close()
    bad.close()
  }
})
