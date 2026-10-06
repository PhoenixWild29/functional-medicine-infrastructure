/**
 * @jest-environment node
 *
 * Compliance C9: no PHI reaches Sentry.
 *
 *   - beforeSend strips patient fields by KEY (names, email, phone, DOB,
 *     address, allergies, sig, diagnosis) wherever they sit: extra,
 *     contexts, tags, breadcrumbs, stack-frame variables. Pattern matching
 *     alone cannot recognise a name, so the key decides.
 *   - Request bodies and cookies are never sent.
 *   - beforeBreadcrumb drops console arguments and fetch/xhr bodies, and
 *     strips query strings from URLs.
 *   - Every Sentry.init (client, server, edge) sets sendDefaultPii: false,
 *     uses both hooks, and has no session replay.
 */

import type { Breadcrumb, ErrorEvent } from '@sentry/nextjs'
import { phiBeforeSend, phiBeforeBreadcrumb } from '../phi-scrubber'

const PATIENT = {
  first_name:    'Janet',
  last_name:     'Quixley',
  date_of_birth: '1980-04-12',
  email:         'janet.q@example.com',
  phone:         '(512) 555-0142',
  address_line1: '4417 Larkspur Lane',
  city:          'Pflugerville',
  zip:           '78660',
  allergies:     ['Sulfonamide'],
  sig_text:      'Inject 0.25 mg weekly',
  patient_id:    'pt-123',
}
const PHI_VALUES = ['Janet', 'Quixley', '1980-04-12', 'janet.q@example.com', '555-0142', 'Larkspur', 'Pflugerville', '78660', 'Sulfonamide', 'Inject 0.25']

function expectNoPhi(value: unknown) {
  const text = JSON.stringify(value)
  for (const v of PHI_VALUES) expect(text).not.toContain(v)
}

function event(partial: Partial<ErrorEvent>): ErrorEvent {
  return { type: undefined, ...partial } as ErrorEvent
}

describe('phiBeforeSend', () => {
  it('strips patient fields from extra by key', () => {
    const out = phiBeforeSend(event({ extra: { patient: PATIENT, orderId: 'o-1' } }), {})
    expectNoPhi(out)
    expect(JSON.stringify(out)).toContain('o-1')
    expect(JSON.stringify(out)).toContain('pt-123') // ids survive
  })

  it('strips patient fields from contexts and tags', () => {
    const out = phiBeforeSend(event({
      contexts: { order: { ...PATIENT } } as never,
      tags: { patient_name: 'Janet Quixley', email: 'janet.q@example.com' },
    }), {})
    expectNoPhi(out)
  })

  it('strips patient fields from stack-frame variables and breadcrumbs', () => {
    const out = phiBeforeSend(event({
      exception: { values: [{ type: 'Error', value: 'boom', stacktrace: { frames: [{ vars: { patient: PATIENT, full_name: 'Janet Quixley' } }] } }] },
      breadcrumbs: [{ category: 'console', message: 'x', data: { arguments: [PATIENT] } }],
    }), {})
    expectNoPhi(out)
  })

  it('scrubs emails and phones from the event message and exception text', () => {
    const out = phiBeforeSend(event({
      message: 'send failed to janet.q@example.com / (512) 555-0142',
      exception: { values: [{ type: 'Error', value: 'sms to (512) 555-0142 failed' }] },
    }), {})
    expectNoPhi(out)
  })

  it('never sends request bodies or cookies', () => {
    const out = phiBeforeSend(event({
      request: { url: 'https://app.test/api/patients?email=janet.q@example.com', data: JSON.stringify(PATIENT), cookies: { sb: 'session' } },
    }), {})
    expect(out!.request!.data).toBeUndefined()
    expect(out!.request!.cookies).toBeUndefined()
    expectNoPhi(out)
  })

  it('keeps only id, clinic and role on the user', () => {
    const out = phiBeforeSend(event({
      user: { id: 'u-1', email: 'janet.q@example.com', username: 'Janet Quixley', ip_address: '1.2.3.4' },
    }), {})
    expect(out!.user).toEqual({ id: 'u-1' })
  })
})

describe('phiBeforeBreadcrumb', () => {
  it('drops console arguments and scrubs the message', () => {
    const out = phiBeforeBreadcrumb({
      category: 'console', level: 'info',
      message: 'sending to janet.q@example.com',
      data: { arguments: ['sending to', PATIENT], logger: 'console' },
    } as Breadcrumb)
    expect(out).not.toBeNull()
    expect(out!.data?.['arguments']).toBeUndefined()
    expectNoPhi(out)
  })

  it('drops fetch and xhr bodies and strips the query string', () => {
    for (const category of ['fetch', 'xhr']) {
      const out = phiBeforeBreadcrumb({
        category, type: 'http',
        data: {
          method: 'POST', status_code: 200,
          url: 'https://app.test/api/patients?name=Janet%20Quixley&dob=1980-04-12',
          request_body: JSON.stringify(PATIENT), response_body: JSON.stringify(PATIENT),
        },
      } as Breadcrumb)
      expect(out!.data?.['request_body']).toBeUndefined()
      expect(out!.data?.['response_body']).toBeUndefined()
      expect(out!.data?.['url']).toBe('https://app.test/api/patients')
      expectNoPhi(out)
    }
  })

  it('scrubs PHI keys in any other breadcrumb data', () => {
    const out = phiBeforeBreadcrumb({ category: 'custom', data: { ...PATIENT } } as Breadcrumb)
    expectNoPhi(out)
  })
})

describe('Sentry.init options (client, server, edge)', () => {
  const initMock = jest.fn()

  beforeEach(() => {
    initMock.mockReset()
    jest.resetModules()
    jest.doMock('@sentry/nextjs', () => ({ init: (opts: unknown) => initMock(opts) }))
  })

  it.each([
    ['client', '../../../../sentry.client.config'],
    ['server', '../../../../sentry.server.config'],
    ['edge',   '../../../../sentry.edge.config'],
  ])('%s: sendDefaultPii false, both PHI hooks, no session replay', (_name, path) => {
    let scrubber!: typeof import('../phi-scrubber')
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require(path)
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      scrubber = require('../phi-scrubber')
    })

    expect(initMock).toHaveBeenCalledTimes(1)
    const opts = initMock.mock.calls[0]![0] as Record<string, unknown>
    expect(opts['sendDefaultPii']).toBe(false)
    expect(opts['beforeSend']).toBe(scrubber.phiBeforeSend)
    expect(opts['beforeBreadcrumb']).toBe(scrubber.phiBeforeBreadcrumb)
    expect(opts['replaysSessionSampleRate'] ?? 0).toBe(0)
    expect(opts['replaysOnErrorSampleRate'] ?? 0).toBe(0)

    // No Replay integration, whatever the SDK's defaults are.
    const integrations = opts['integrations']
    expect(typeof integrations).toBe('function')
    const kept = (integrations as (d: Array<{ name: string }>) => Array<{ name: string }>)(
      [{ name: 'Replay' }, { name: 'ReplayCanvas' }, { name: 'Breadcrumbs' }],
    )
    expect(kept.map(i => i.name)).toEqual(['Breadcrumbs'])
  })
})
