/**
 * @jest-environment node
 *
 * An order.rejected webhook carries the pharmacy's own text: a rejection
 * reason (free text, can name the patient or the drug) and a rejection
 * "code" that is just as unvalidated. Neither may reach the server log.
 * The log line carries the order id, the pharmacy and a fixed code only.
 * The text is still kept on the status history (RLS-protected).
 */

import { createHmac } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { scriptedDb, type Script } from '@/__tests__/helpers/scripted-db'

let db = scriptedDb(() => undefined)
const casTransitionMock = jest.fn()

jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.mock('@/lib/slack/client', () => ({
  sendSlackAlert: jest.fn().mockResolvedValue(undefined),
  buildAdapterFailureAlert: (p: unknown) => ({ text: JSON.stringify(p) }),
}))
jest.mock('@/lib/orders/cas-transition', () => ({ casTransition: (a: unknown) => casTransitionMock(a) }))

import { POST as pharmacyWebhook } from '../pharmacy/[pharmacySlug]/route'

const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
const infoSpy  = jest.spyOn(console, 'info').mockImplementation(() => {})
const warnSpy  = jest.spyOn(console, 'warn').mockImplementation(() => {})
const logSpy   = jest.spyOn(console, 'log').mockImplementation(() => {})

const SECRET = 'whsec-test'
const params = { params: Promise.resolve({ pharmacySlug: 'acme' }) }
const script: Script = c => {
  if (c.table === 'pharmacies') return { data: { pharmacy_id: 'ph-1', slug: 'acme', name: 'Acme' } }
  if (c.table === 'pharmacy_api_configs') return { data: { webhook_secret_vault_id: 'v-1' } }
  if (c.table === 'decrypted_secrets') return { data: { decrypted_secret: SECRET } }
  if (c.table === 'pharmacy_webhook_events' && c.op === 'insert') return { data: { id: 'pwe-1' } }
  if (c.table === 'adapter_submissions') return { data: { order_id: 'o-1' } }
  if (c.table === 'orders') return { data: { order_id: 'o-1', status: 'PHARMACY_ACKNOWLEDGED', clinic_id: 'c-1' } }
  return undefined
}

function signed(body: string) {
  const sig = createHmac('sha256', SECRET).update(body).digest('hex')
  return {
    text: async () => body,
    url: 'https://app.test/api/webhooks/pharmacy/acme',
    headers: { get: (h: string) => (h.toLowerCase() === 'x-webhook-signature' ? sig : null) },
  } as unknown as NextRequest
}

const REASON = 'Janet Quixley DOB 1980-04-12: Semaglutide allergy on file'
const CODE = 'pt Janet Q. allergic'

const everyLogLine = () =>
  [errorSpy, infoSpy, warnSpy, logSpy].flatMap(s => s.mock.calls.map(c => c.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')))

beforeEach(() => {
  db = scriptedDb(script)
  casTransitionMock.mockReset().mockResolvedValue({ success: true, wasAlreadyTransitioned: false })
  for (const s of [errorSpy, infoSpy, warnSpy, logSpy]) s.mockClear()
})

afterAll(() => { for (const s of [errorSpy, infoSpy, warnSpy, logSpy]) s.mockRestore() })

it('the log never carries the rejection reason or the pharmacy-supplied code', async () => {
  const body = JSON.stringify({
    eventId: 'e-rej-1', eventType: 'order.rejected', orderId: 'EXT-1',
    data: { rejectionReason: REASON, rejectionCode: CODE },
  })

  const res = await pharmacyWebhook(signed(body), params)

  expect(res.status).toBe(200)
  const lines = everyLogLine().join('\n')
  expect(lines).not.toContain('Janet')
  expect(lines).not.toContain('Semaglutide')
  expect(lines).not.toContain(CODE)
})

it('the log line has the order id, the pharmacy and a fixed code', async () => {
  const body = JSON.stringify({
    eventId: 'e-rej-2', eventType: 'order.rejected', orderId: 'EXT-1',
    data: { rejectionReason: REASON, rejectionCode: CODE },
  })

  await pharmacyWebhook(signed(body), params)

  const line = everyLogLine().find(l => l.includes('order.rejected |'))
  expect(line).toBe('[pharmacy-webhook] order.rejected | order=o-1 | pharmacy=acme | code=pharmacy_rejected')
})

it('the reason is still recorded on the status history', async () => {
  const body = JSON.stringify({
    eventId: 'e-rej-3', eventType: 'order.rejected', orderId: 'EXT-1',
    data: { rejectionReason: REASON, rejectionCode: CODE },
  })

  await pharmacyWebhook(signed(body), params)

  expect(casTransitionMock).toHaveBeenCalledWith(expect.objectContaining({
    newStatus: 'PHARMACY_REJECTED',
    metadata: expect.objectContaining({ rejection_reason: REASON }),
  }))
})
