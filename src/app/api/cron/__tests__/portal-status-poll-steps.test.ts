/**
 * @jest-environment node
 *
 * Decision 10, poll fix A: the portal status poll moves an order to the
 * status the portal shows through legal casTransition steps, one per step,
 * and never asks for PHARMACY_READY or an illegal jump. A step that was
 * already taken (CAS) stops the walk; unknown text or a backward status
 * changes nothing.
 */

import type { NextRequest } from 'next/server'
import { scriptedDb, type Script } from '@/__tests__/helpers/scripted-db'

let db = scriptedDb(() => undefined)
const casTransitionMock = jest.fn()
let portalText = 'Shipped'

jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.mock('@/lib/orders/cas-transition', () => ({ casTransition: (a: unknown) => casTransitionMock(a) }))
jest.mock('@/lib/adapters/vault', () => ({ getVaultSecret: async () => 'secret' }))
jest.mock('@/lib/adapters/portal-flow-executor', () => ({ executeFlow: async () => [{ action: 'getText', success: true, textContent: portalText }] }))
jest.mock('@/lib/playwright/config', () => ({ getBrowserLaunchOptions: () => ({}), getBrowserContextOptions: () => ({}) }))
jest.mock('playwright', () => ({
  chromium: { launch: async () => ({ newContext: async () => ({ newPage: async () => ({}), route: async () => undefined }), close: async () => undefined }) },
}))

import { GET as portalStatusPoll } from '../portal-status-poll/route'

jest.spyOn(console, 'error').mockImplementation(() => {})
jest.spyOn(console, 'info').mockImplementation(() => {})

const CANDIDATE = { submission_id: 's-1', order_id: 'o-1', pharmacy_id: 'ph-1', portal_last_polled_at: null }

function script(status: string): Script {
  return c => {
    if (c.table === 'adapter_submissions' && c.op === 'select') return { data: [CANDIDATE] }
    if (c.table === 'pharmacy_portal_configs') {
      return { data: { status_check_flow: [{ action: 'navigate', url: 'https://portal.example/status' }], username_vault_id: 'u', password_vault_id: 'p', poll_interval_minutes: 30 } }
    }
    if (c.table === 'orders' && c.op === 'select') return { data: { status } }
    return undefined
  }
}

async function poll(status: string, text: string) {
  portalText = text
  db = scriptedDb(script(status))
  process.env['CRON_SECRET'] = 'cron-secret'
  const res = await portalStatusPoll({ headers: { get: () => 'Bearer cron-secret' } } as unknown as NextRequest)
  return res.json() as Promise<Record<string, unknown>>
}
const steps = () => casTransitionMock.mock.calls.map(c => {
  const a = c[0] as { expectedStatus: string; newStatus: string; actorRole: string }
  return `${a.expectedStatus}>${a.newStatus}`
})

beforeEach(() => {
  casTransitionMock.mockReset().mockResolvedValue({ success: true, wasAlreadyTransitioned: false })
})

it('Shipped from PHARMACY_ACKNOWLEDGED walks the legal steps', async () => {
  const body = await poll('PHARMACY_ACKNOWLEDGED', 'Shipped')
  expect(steps()).toEqual(['PHARMACY_ACKNOWLEDGED>PHARMACY_PROCESSING', 'PHARMACY_PROCESSING>READY_TO_SHIP', 'READY_TO_SHIP>SHIPPED'])
  expect(body['status_updated']).toBe(1)
  for (const c of casTransitionMock.mock.calls) expect((c[0] as { actorRole: string }).actorRole).toBe('system')
})

it('Ready for pickup is READY_TO_SHIP, never PHARMACY_READY', async () => {
  await poll('PHARMACY_PROCESSING', 'Ready for pickup')
  expect(steps()).toEqual(['PHARMACY_PROCESSING>READY_TO_SHIP'])
  expect(JSON.stringify(casTransitionMock.mock.calls)).not.toContain('PHARMACY_READY')
})

it('Rejected is PHARMACY_REJECTED (ops then reroute or refund), not a jump to REROUTE_PENDING', async () => {
  await poll('PHARMACY_ACKNOWLEDGED', 'Rejected')
  expect(steps()).toEqual(['PHARMACY_ACKNOWLEDGED>PHARMACY_REJECTED'])
})

it('a backward or unknown status changes nothing', async () => {
  const back = await poll('READY_TO_SHIP', 'Processing')
  expect(steps()).toEqual([])
  expect(back['no_change']).toBe(1)
  const unknown = await poll('PHARMACY_ACKNOWLEDGED', 'On hold, call us')
  expect(steps()).toEqual([])
  expect(unknown['no_change']).toBe(1)
})

it('a step already taken (CAS) stops the walk', async () => {
  casTransitionMock.mockReset()
    .mockResolvedValueOnce({ success: true, wasAlreadyTransitioned: false })
    .mockResolvedValueOnce({ success: false, wasAlreadyTransitioned: true })
  const body = await poll('PHARMACY_ACKNOWLEDGED', 'Shipped')
  expect(steps()).toEqual(['PHARMACY_ACKNOWLEDGED>PHARMACY_PROCESSING', 'PHARMACY_PROCESSING>READY_TO_SHIP'])
  // One step was taken here before the other run moved it on.
  expect(body['status_updated']).toBe(1)
})
