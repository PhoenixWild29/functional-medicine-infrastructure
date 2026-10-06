/**
 * @jest-environment node
 *
 * Batch 3, PR 2: the SMS dedup gate fails closed on a read error.
 *
 * Before, a failed dedup count came back as `count: null`, read as 0 —
 * "never sent" — and the SMS went out again on a webhook replay or a
 * concurrent transition. Now the send is refused with
 * reason 'dedup_check_failed' and nothing is dispatched.
 *
 * Twilio is mocked; nothing is sent.
 */

import { scriptedDb, DB_DOWN } from '@/__tests__/helpers/scripted-db'

let db = scriptedDb(() => undefined)
const createMock = jest.fn()

jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.mock('@/lib/twilio/client', () => ({ createTwilioClient: () => ({ messages: { create: (p: unknown) => createMock(p) } }) }))
jest.mock('@/lib/env', () => ({ serverEnv: { twilioPhoneNumber: () => '+15005550006', appBaseUrl: () => 'https://app.test' } }))
jest.mock('@/lib/slack/client', () => ({ sendSlackMessage: async () => undefined }))

import { sendSms } from '../sender'

jest.spyOn(console, 'error').mockImplementation(() => {})
jest.spyOn(console, 'info').mockImplementation(() => {})

const PARAMS = { orderId: 'o-1', patientId: 'pt-1', toNumber: '+15125550123', templateName: 'payment_link', body: 'Pay here' } as Parameters<typeof sendSms>[0]

beforeEach(() => {
  delete process.env['TWILIO_ENABLED']
  createMock.mockReset().mockResolvedValue({ sid: 'SM1' })
})

it('a failed dedup read refuses the send instead of counting as "never sent"', async () => {
  db = scriptedDb(c => {
    if (c.table === 'patients') return { data: { sms_opt_in: true } }   // C1: sendSms reads opt-in itself
    if (c.table !== 'sms_log' || !c.head) return undefined
    return 'order_id' in c.filters ? DB_DOWN : { count: 0 } // rate limit fine, dedup read fails
  })
  await expect(sendSms(PARAMS)).resolves.toEqual({ outcome: 'failed', reason: 'dedup_check_failed' })
  expect(createMock).not.toHaveBeenCalled()
})

it('a dedup read of 0 still sends', async () => {
  db = scriptedDb(c => (c.table === 'patients' ? { data: { sms_opt_in: true } } : c.table === 'sms_log' && c.head ? { count: 0 } : undefined))
  await expect(sendSms(PARAMS)).resolves.toEqual({ outcome: 'sent', messageSid: 'SM1' })
})
