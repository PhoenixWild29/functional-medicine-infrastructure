/**
 * @jest-environment node
 *
 * Token URLs never reach Sentry. A patient link's token is its credential:
 * /checkout/<jwt>, /plan/<token>, /intake/<token>, /join/<token>, the
 * onboarding invites, and their APIs. Wherever a URL can sit in an event
 * (request URL, the Referer header, breadcrumbs, messages, exception text,
 * the transaction name, span descriptions and data), the token segment
 * becomes [token] and a ?token= value is scrubbed. Transactions go through
 * the same scrubbing (beforeSendTransaction), not only errors.
 */

import type { Breadcrumb, ErrorEvent, TransactionEvent } from '@sentry/nextjs'
import { phiBeforeBreadcrumb, phiBeforeSend, phiBeforeSendTransaction } from '../phi-scrubber'

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJvcmRlcklkIjoibyJ9.c2lnbmF0dXJl'
const T43 = 'Zx9_aB3-kLmNoPqRsTuVwXyZ0123456789abcdefGHI'
const SECRET_BITS = [JWT, T43, 'c2lnbmF0dXJl']

const urls = [
  [`https://app.example/checkout/${JWT}`, 'https://app.example/checkout/[token]'],
  [`/plan/${T43}`, '/plan/[token]'],
  [`/api/plan/${T43}`, '/api/plan/[token]'],
  [`/intake/${T43}`, '/intake/[token]'],
  [`/api/intake/${T43}`, '/api/intake/[token]'],
  [`/join/${T43}`, '/join/[token]'],
  [`/api/join/${T43}`, '/api/join/[token]'],
  [`/onboard/clinic/${T43}`, '/onboard/clinic/[token]'],
  [`/onboard/join/${T43}`, '/onboard/join/[token]'],
  [`/onboard/pharmacy/${T43}`, '/onboard/pharmacy/[token]'],
  [`/api/onboard/pharmacy/${T43}`, '/api/onboard/pharmacy/[token]'],
] as const

const clean = (s: unknown) => {
  const text = JSON.stringify(s)
  for (const bit of SECRET_BITS) expect(text).not.toContain(bit)
}

describe('URLs in an error event', () => {
  it.each(urls)('%s -> %s (request url)', (raw, scrubbed) => {
    const out = phiBeforeSend({ request: { url: raw } } as ErrorEvent)!
    expect(out.request!.url).toBe(scrubbed)
  })

  it('the Referer header, the message, exception text and the transaction name', () => {
    const out = phiBeforeSend({
      message: `fetch failed for /api/plan/${T43}`,
      transaction: `/checkout/${JWT}`,
      request: { url: `/plan/${T43}`, headers: { referer: `https://app.example/intake/${T43}`, 'user-agent': 'x' } },
      exception: { values: [{ type: 'Error', value: `GET /join/${T43} 500` }] },
    } as ErrorEvent)!
    clean(out)
    expect(out.transaction).toBe('/checkout/[token]')
    expect((out.request!.headers as Record<string, string>)['referer']).toBe('https://app.example/intake/[token]')
  })

  it('a ?token= query value', () => {
    const out = phiBeforeSend({ request: { url: `https://app.example/checkout?token=${JWT}` } } as ErrorEvent)!
    clean(out)
  })

  it('leaves the fixed checkout pages and the API routes that carry no token alone', () => {
    for (const url of ['/checkout/expired', '/checkout/success', '/api/checkout/payment-intent', '/api/checkout/payment-group-intent', '/plan/[token]', '/api/onboarding/invite/accept']) {
      expect(phiBeforeSend({ request: { url } } as ErrorEvent)!.request!.url).toBe(url)
    }
  })
})

describe('breadcrumbs', () => {
  it('navigation from / to and fetch urls', () => {
    const nav = phiBeforeBreadcrumb({ category: 'navigation', data: { from: `/plan/${T43}`, to: `/checkout/${JWT}` } } as Breadcrumb)!
    expect(nav.data).toEqual({ from: '/plan/[token]', to: '/checkout/[token]' })
    const f = phiBeforeBreadcrumb({ category: 'fetch', data: { url: `/api/intake/${T43}`, method: 'POST', status_code: 410 } } as Breadcrumb)!
    expect(f.data!['url']).toBe('/api/intake/[token]')
  })
})

describe('transactions (beforeSendTransaction)', () => {
  it('the name, request, spans and breadcrumbs carry no token', () => {
    const tx = {
      type: 'transaction',
      transaction: `GET /plan/${T43}`,
      request: { url: `https://app.example/plan/${T43}`, headers: { Referer: `https://app.example/join/${T43}` }, cookies: { a: 'b' }, data: '{}' },
      breadcrumbs: [{ category: 'navigation', data: { to: `/intake/${T43}` } }],
      spans: [
        { span_id: '1', trace_id: 't', start_timestamp: 0, description: `POST /api/plan/${T43}`, data: { 'http.url': `https://app.example/api/plan/${T43}`, url: `/api/plan/${T43}` } },
      ],
      contexts: { trace: { data: { 'http.target': `/checkout/${JWT}` } } },
    } as unknown as TransactionEvent
    const out = phiBeforeSendTransaction(tx)!
    clean(out)
    expect(out.transaction).toBe('GET /plan/[token]')
    expect(out.spans![0]!.description).toBe('POST /api/plan/[token]')
    expect(out.request!.cookies).toBeUndefined()
    expect(out.request!.data).toBeUndefined()
  })
})
