/**
 * @jest-environment node
 *
 * B's review T5 and T7: the portal browser never talks plain http.
 * - enforceHttpsOnly routes every request of a browser context and aborts
 *   any that is not https (http to localhost only under tests).
 * - The flow executor refuses to type (fill / select) on a page whose URL
 *   is not https, whatever redirect got it there.
 * - Tier 2 installs the route before any flow runs.
 * - The portal status poll checks the status flow's URLs before it reads
 *   or types the portal credentials, and routes its browser the same way.
 *
 * No browser runs: playwright is mocked.
 */

import type { NextRequest } from 'next/server'
import { scriptedDb, type Script, type ScriptedCall } from '@/__tests__/helpers/scripted-db'

let db = scriptedDb(() => undefined)
const vaultMock = jest.fn()
const launchMock = jest.fn()

jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.mock('@/lib/adapters/vault', () => ({
  getVaultSecret: async (...a: unknown[]) => { vaultMock(...a); return 'secret' },
  buildAuthHeaders: async () => ({}),
}))
jest.mock('playwright', () => ({ chromium: { launch: (...a: unknown[]) => launchMock(...a) } }))
jest.mock('@/lib/orders/cas-transition', () => ({ casTransition: async () => ({ success: true, wasAlreadyTransitioned: false }) }))

import { enforceHttpsOnly } from '../transmission-guard'
import { executeFlow, type FlowStep } from '../portal-flow-executor'
import { GET as portalStatusPoll } from '@/app/api/cron/portal-status-poll/route'

jest.spyOn(console, 'error').mockImplementation(() => {})
jest.spyOn(console, 'warn').mockImplementation(() => {})
jest.spyOn(console, 'info').mockImplementation(() => {})

function fakePage(url: string) {
  return {
    url: jest.fn(() => url),
    goto: jest.fn(async () => null),
    fill: jest.fn(async () => undefined),
    selectOption: jest.fn(async () => []),
    click: jest.fn(async () => undefined),
    close: jest.fn(async () => undefined),
  }
}

describe('enforceHttpsOnly', () => {
  it('aborts every non-https request and lets https through', async () => {
    const route = jest.fn()
    await enforceHttpsOnly({ route } as never)
    expect(route).toHaveBeenCalledWith('**/*', expect.any(Function))
    const handler = route.mock.calls[0]![1] as (r: unknown) => Promise<void>
    const r = (url: string) => ({ request: () => ({ url: () => url }), abort: jest.fn(async () => undefined), continue: jest.fn(async () => undefined) })
    const http = r('http://portal.pharm.test/submit'), https = r('https://portal.pharm.test/submit'), ws = r('ws://portal.pharm.test')
    await handler(http); await handler(https); await handler(ws)
    expect(http.abort).toHaveBeenCalled()
    expect(http.continue).not.toHaveBeenCalled()
    expect(https.continue).toHaveBeenCalled()
    expect(ws.abort).toHaveBeenCalled()
  })
})

describe('the flow executor types nothing on an http page', () => {
  const steps: FlowStep[] = [{ action: 'fill', selector: '#user', value: '{username}' }]

  it('a page that ended up on http (a redirect) is refused before fill', async () => {
    const page = fakePage('http://portal.pharm.test/login')
    await expect(executeFlow(page as never, steps, { username: 'u', password: 'p' })).rejects.toThrow(/https/)
    expect(page.fill).not.toHaveBeenCalled()
  })

  it('select is refused the same way', async () => {
    const page = fakePage('http://portal.pharm.test/form')
    await expect(executeFlow(page as never, [{ action: 'select', selector: '#s', value: 'x' }], { username: 'u', password: 'p' })).rejects.toThrow(/https/)
    expect(page.selectOption).not.toHaveBeenCalled()
  })

  it('on an https page it types as before', async () => {
    const page = fakePage('https://portal.pharm.test/login')
    await executeFlow(page as never, steps, { username: 'u', password: 'p' })
    expect(page.fill).toHaveBeenCalledWith('#user', 'u', expect.anything())
  })
})

describe('the portal status poll (T7)', () => {
  const env = process.env as Record<string, string | undefined>
  beforeAll(() => { env['CRON_SECRET'] = 'cron-secret'; env['PLAYWRIGHT_HEADLESS'] = 'true' })
  beforeEach(() => { vaultMock.mockReset(); launchMock.mockReset() })

  const world = (flow: unknown): Script => (c: ScriptedCall) => {
    if (c.table === 'adapter_submissions' && c.op === 'select') return { data: [{ submission_id: 's-1', order_id: 'o-1', pharmacy_id: 'ph-1', portal_last_polled_at: null }] }
    if (c.table === 'pharmacy_portal_configs') return { data: { status_check_flow: flow, username_vault_id: 'u-1', password_vault_id: 'p-1', poll_interval_minutes: 30 } }
    return undefined
  }
  const run = async (flow: unknown) => {
    db = scriptedDb(world(flow))
    const res = await portalStatusPoll({ headers: { get: () => 'Bearer cron-secret' } } as unknown as NextRequest)
    return await res.json() as { skipped: number; errors: number }
  }

  it('an http URL in the status flow: credentials are not read and no browser starts', async () => {
    const body = await run([{ action: 'navigate', url: 'http://portal.pharm.test/login' }, { action: 'fill', selector: '#u', value: '{username}' }])
    expect(vaultMock).not.toHaveBeenCalled()
    expect(launchMock).not.toHaveBeenCalled()
    expect(body).toMatchObject({ skipped: 1, errors: 0 })
  })

  it('an https flow: the browser context is routed https-only before the flow runs', async () => {
    const route = jest.fn()
    const page = fakePage('https://portal.pharm.test/status')
    const context = { route, newPage: jest.fn(async () => page), close: jest.fn(async () => undefined) }
    launchMock.mockResolvedValue({ newContext: jest.fn(async () => context), close: jest.fn(async () => undefined) })
    await run([{ action: 'navigate', url: 'https://portal.pharm.test/login' }])
    expect(vaultMock).toHaveBeenCalled()
    expect(route).toHaveBeenCalledWith('**/*', expect.any(Function))
    expect(route.mock.invocationCallOrder[0]!).toBeLessThan(page.goto.mock.invocationCallOrder[0]!)
  })
})
