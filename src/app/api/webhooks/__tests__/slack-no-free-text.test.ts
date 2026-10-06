/**
 * @jest-environment node
 *
 * Owner decision: a pharmacy's rejection reason (and code) is free text
 * the pharmacy typed and can contain patient details; it must not go to
 * Slack. The rejection alert sends only: alert type, order ID, pharmacy,
 * status and the ops order link.
 */

import { createHmac } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { scriptedDb } from '@/__tests__/helpers/scripted-db'

let db = scriptedDb(() => undefined)
const sendSlackAlertMock = jest.fn()

jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.mock('@/lib/slack/client', () => ({
  ...jest.requireActual('@/lib/slack/client'),
  sendSlackAlert: (p: unknown) => sendSlackAlertMock(p),
}))
jest.mock('@/lib/orders/cas-transition', () => ({
  casTransition: async () => ({ success: true, wasAlreadyTransitioned: false }),
}))

import { POST as pharmacyWebhook } from '../pharmacy/[pharmacySlug]/route'

jest.spyOn(console, 'error').mockImplementation(() => {})
jest.spyOn(console, 'info').mockImplementation(() => {})
jest.spyOn(console, 'warn').mockImplementation(() => {})
process.env['APP_BASE_URL'] = 'https://app.test'

const SECRET = 'whsec-test'
const ORDER = 'd1000000-0000-4000-8000-000000000001'
const PHI = ['Jane', 'Doe', '1980-01-02', '555-867-5309', '42 Elm', 'Semaglutide', 'allergic', 'sulfa']

function signed(body: string) {
  return {
    text: async () => body,
    url: 'https://app.test/api/webhooks/pharmacy/portal-plus',
    headers: { get: (h: string) => (h.toLowerCase() === 'x-webhook-signature' ? createHmac('sha256', SECRET).update(body).digest('hex') : null) },
  } as unknown as NextRequest
}

beforeEach(() => {
  sendSlackAlertMock.mockReset().mockResolvedValue(undefined)
  db = scriptedDb(c => {
    if (c.table === 'pharmacies') return { data: { pharmacy_id: 'ph-1', slug: 'portal-plus', name: 'Portal Plus Pharmacy' } }
    if (c.table === 'pharmacy_api_configs') return { data: { webhook_secret_vault_id: 'v-1' } }
    if (c.table === 'decrypted_secrets') return { data: { decrypted_secret: SECRET } }
    if (c.table === 'pharmacy_webhook_events' && c.op === 'insert') return { data: { id: 'pwe-1' } }
    if (c.table === 'adapter_submissions') return { data: { order_id: ORDER } }
    if (c.table === 'orders') return { data: { order_id: ORDER, status: 'PHARMACY_ACKNOWLEDGED', clinic_id: 'c-1' } }
    return undefined
  })
})

it('order.rejected: the Slack alert carries no rejection reason or code, only the allow-listed fields', async () => {
  const body = JSON.stringify({
    eventId: 'e-1', eventType: 'order.rejected', orderId: 'EXT-1',
    data: {
      rejectionReason: 'Patient Jane Doe DOB 1980-01-02, 42 Elm Street, 555-867-5309, allergic to sulfa; Semaglutide 5mg not available',
      rejectionCode: 'Jane_Doe_allergic',
    },
  })
  const res = await pharmacyWebhook(signed(body), { params: Promise.resolve({ pharmacySlug: 'portal-plus' }) })
  expect(res.status).toBe(200)
  expect(sendSlackAlertMock).toHaveBeenCalledTimes(1)
  const text = JSON.stringify(sendSlackAlertMock.mock.calls[0]![0])
  for (const s of PHI) expect(text).not.toContain(s)
  expect(text).toContain(ORDER)
  expect(text).toContain('portal-plus')
  expect(text).toContain('PHARMACY_REJECTED')
  expect(text).toContain(`https://app.test/ops/pipeline?order=${ORDER}`)
})
