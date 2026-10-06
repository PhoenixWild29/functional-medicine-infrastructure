/**
 * @jest-environment node
 *
 * The SMS failure alert to Slack used to carry the patient's phone number
 * (last 4 digits) and the delivery error text, which echoes the number
 * Twilio was given. Neither goes to Slack now: alert type, order ID, the
 * SMS template (a code) and the ops order link only.
 *
 * Twilio is mocked; nothing is sent.
 */

import { scriptedDb } from '@/__tests__/helpers/scripted-db'

let db = scriptedDb(() => undefined)
const createMock = jest.fn()
const sendSlackMessageMock = jest.fn()

jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.mock('@/lib/twilio/client', () => ({ createTwilioClient: () => ({ messages: { create: (p: unknown) => createMock(p) } }) }))
jest.mock('@/lib/env', () => ({
  serverEnv: {
    twilioPhoneNumber: () => '+15005550006',
    appBaseUrl: () => 'https://app.test',
    slackOpsAlertsChannelId: () => 'C-ops',
  },
}))
jest.mock('@/lib/slack/client', () => ({
  ...jest.requireActual('@/lib/slack/client'),
  sendSlackMessage: (channel: string, payload: unknown) => sendSlackMessageMock(channel, payload),
}))
jest.mock('@/lib/auth/checkout-token', () => ({ generateCheckoutToken: async () => 'tok' }))

import { sendSms } from '../sender'

jest.spyOn(console, 'error').mockImplementation(() => {})
jest.spyOn(console, 'info').mockImplementation(() => {})

const ORDER = 'd1000000-0000-4000-8000-000000000001'
const TO = '+15558675309'

beforeEach(() => {
  delete process.env['TWILIO_ENABLED']
  sendSlackMessageMock.mockReset().mockResolvedValue({ ts: '1' })
  // A 4xx is not retried, so the failure path runs at once.
  createMock.mockReset().mockRejectedValue(Object.assign(new Error(`The 'To' number ${TO} is not a valid phone number (Jane Doe)`), { status: 400 }))
  db = scriptedDb(c => {
    if (c.table === 'patients') return { data: { sms_opt_in: true } }
    if (c.table === 'sms_log' && c.head) return { count: 0 }
    return undefined
  })
})

it('a failed SMS alerts ops without the phone number or the error text', async () => {
  const result = await sendSms({ orderId: ORDER, patientId: 'pt-1', toNumber: TO, templateName: 'payment_link', body: 'Pay here' } as Parameters<typeof sendSms>[0])
  expect(result.outcome).toBe('failed')
  expect(sendSlackMessageMock).toHaveBeenCalledTimes(1)
  const text = JSON.stringify(sendSlackMessageMock.mock.calls[0]![1])
  for (const s of ['5309', '8675309', 'Jane', 'Doe', 'not a valid phone']) expect(text).not.toContain(s)
  expect(text).toContain(ORDER)
  expect(text).toContain('payment_link')
  expect(text).toContain(`https://app.test/ops/pipeline?order=${ORDER}`)
})
