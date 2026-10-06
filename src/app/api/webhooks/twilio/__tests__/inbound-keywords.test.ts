/**
 * @jest-environment node
 *
 * Compliance C1: a patient's STOP reply turns their texts off.
 *
 * Before, POST /api/webhooks/twilio handled delivery status callbacks
 * only; a reply was dropped as "missing MessageStatus" and sms_opt_in
 * stayed true. Now an inbound message (Body, no MessageStatus) is read
 * for the carrier keywords:
 *
 *   STOP / STOPALL / UNSUBSCRIBE / CANCEL / END / QUIT
 *        → sms_opt_in false, with when and how (sms_consent_at / _source)
 *   START / YES / UNSTOP → opted back in, recorded the same way
 *   HELP → a short reply with no PHI
 *
 * Every patient with that phone (phone_e164) is updated. The signature
 * is checked first; logs name patients by id, never by phone.
 * Twilio is not called: the reply is TwiML in the response.
 */

import { NextRequest } from 'next/server'
import { scriptedDb, DB_DOWN } from '@/__tests__/helpers/scripted-db'

let db = scriptedDb(() => undefined)
const validateMock = jest.fn()

jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.mock('@/lib/twilio/client', () => ({ validateTwilioWebhook: (...a: unknown[]) => validateMock(...a) }))
jest.mock('@/lib/slack/client', () => ({ sendSlackAlert: async () => undefined }))

import { POST } from '../route'

const FROM = '+15125550123'
const logs: string[] = []
const record = (...a: unknown[]) => { logs.push(a.map(String).join(' ')) }

beforeEach(() => {
  logs.length = 0
  validateMock.mockReset().mockReturnValue(true)
  jest.spyOn(console, 'info').mockImplementation(record)
  jest.spyOn(console, 'warn').mockImplementation(record)
  jest.spyOn(console, 'error').mockImplementation(record)
  db = scriptedDb(c => (c.table === 'patients' && c.op === 'update'
    ? { data: [{ patient_id: 'pt-1' }, { patient_id: 'pt-2' }] }
    : undefined))
})
afterEach(() => jest.restoreAllMocks())

function inbound(body: string, extra: Record<string, string> = {}) {
  const form = new URLSearchParams({ MessageSid: 'SM123', SmsSid: 'SM123', AccountSid: 'AC1', From: FROM, To: '+15005550006', Body: body, NumMedia: '0', ...extra })
  return new NextRequest('https://app.test/api/webhooks/twilio', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': 'sig' },
    body: form.toString(),
  })
}

const patientUpdates = () => db.to('patients', 'update')

describe('opt-out keywords', () => {
  it.each(['STOP', 'stop', ' Stop ', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'Stop.'])('%s sets sms_opt_in false with when and how', async kw => {
    const res = await POST(inbound(kw))
    expect(res.status).toBe(200)
    const [u] = patientUpdates()
    expect(u).toBeDefined()
    expect(u!.filters).toEqual(expect.objectContaining({ phone_e164: FROM }))
    expect(u!.payload).toEqual(expect.objectContaining({ sms_opt_in: false, sms_consent_source: 'sms_keyword_stop' }))
    expect(Date.parse((u!.payload as Record<string, string>)['sms_consent_at']!)).not.toBeNaN()
    // Twilio sends the carrier's own STOP confirmation; we add nothing.
    expect(res.headers.get('content-type')).toMatch(/text\/xml/)
    expect(await res.text()).not.toContain('<Message>')
  })
})

describe('opt-in keywords', () => {
  it.each(['START', 'YES', 'UNSTOP', 'start'])('%s opts back in, recorded', async kw => {
    await POST(inbound(kw))
    const [u] = patientUpdates()
    expect(u!.filters).toEqual(expect.objectContaining({ phone_e164: FROM }))
    expect(u!.payload).toEqual(expect.objectContaining({ sms_opt_in: true, sms_consent_source: 'sms_keyword_start' }))
  })
})

describe('HELP', () => {
  it('replies with a short help text, changes nothing, and names no drug, clinic or patient', async () => {
    const res = await POST(inbound('help'))
    expect(patientUpdates()).toHaveLength(0)
    const xml = await res.text()
    expect(xml).toMatch(/^<\?xml[^>]*\?><Response><Message>[^<]+<\/Message><\/Response>$/)
    const text = /<Message>([^<]+)<\/Message>/.exec(xml)![1]!
    expect(text.length).toBeLessThanOrEqual(160)
    expect(text).toMatch(/STOP/)
    expect(text).toMatch(/START/)
    expect(text).not.toMatch(/semaglutide|testosterone|weight|hormone|prescription|clinic name|Alex/i)
  })
})

describe('any other reply', () => {
  it('changes nothing and is answered with an empty response', async () => {
    const res = await POST(inbound('Is my order shipped?'))
    expect(res.status).toBe(200)
    expect(patientUpdates()).toHaveLength(0)
    expect(await res.text()).not.toContain('<Message>')
  })
})

describe('guards and logs', () => {
  it('a bad signature is refused before anything is read or changed', async () => {
    validateMock.mockReturnValue(false)
    const res = await POST(inbound('STOP'))
    expect(res.status).toBe(403)
    expect(db.calls).toHaveLength(0)
  })

  it('logs name the patients by id, never the phone or the message', async () => {
    await POST(inbound('STOP'))
    const all = logs.join('\n')
    expect(all).toContain('pt-1')
    expect(all).not.toContain('5125550123')
    expect(all).not.toMatch(/\bSTOP\b.*\+1/)
  })

  it('a number no patient has is logged without the number', async () => {
    db = scriptedDb(c => (c.table === 'patients' && c.op === 'update' ? { data: [] } : undefined))
    const res = await POST(inbound('STOP'))
    expect(res.status).toBe(200)
    expect(logs.join('\n')).not.toContain('5125550123')
  })

  it('a failed update is logged loudly (no phone) and still answered 200', async () => {
    db = scriptedDb(c => (c.table === 'patients' && c.op === 'update' ? DB_DOWN : undefined))
    const res = await POST(inbound('STOP'))
    expect(res.status).toBe(200)
    expect(logs.join('\n')).toMatch(/opt-out could not be recorded/)
    expect(logs.join('\n')).not.toContain('5125550123')
  })

  it('a delivery status callback still updates sms_log, not patients', async () => {
    db = scriptedDb(c => (c.table === 'sms_log' ? { data: { sms_id: 's1', order_id: 'o1', patient_id: 'pt-1', template_name: 'payment_link' } } : undefined))
    const form = new URLSearchParams({ MessageSid: 'SM9', MessageStatus: 'delivered', SmsStatus: 'delivered', To: FROM })
    const res = await POST(new NextRequest('https://app.test/api/webhooks/twilio', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': 'sig' },
      body: form.toString(),
    }))
    expect(res.status).toBe(200)
    expect(db.to('sms_log', 'update')).toHaveLength(1)
    expect(patientUpdates()).toHaveLength(0)
  })
})
