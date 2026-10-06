/**
 * @jest-environment node
 *
 * Compliance C1: sendSms itself refuses a patient who has opted out.
 *
 * Before, sendSms trusted its callers ("opt-in is checked by caller"): any
 * path that forgot the check, or read the row before a STOP landed, texted
 * an opted-out patient. Now sendSms reads patients.sms_opt_in for the
 * patient it is given, refuses when it is false (or cannot be read, or the
 * patient is not found), and records the refusal in sms_log as
 * 'suppressed' with the reason, never dispatching to Twilio.
 *
 * Payment texts carry no PHI: no medication, and no clinic name (a clinic
 * name can name a specialty, "Sunrise Weight Loss Clinic").
 *
 * Twilio is mocked; nothing is sent.
 */

import { scriptedDb, DB_DOWN, type Script } from '@/__tests__/helpers/scripted-db'

let db = scriptedDb(() => undefined)
const createMock = jest.fn()

jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.mock('@/lib/twilio/client', () => ({ createTwilioClient: () => ({ messages: { create: (p: unknown) => createMock(p) } }) }))
jest.mock('@/lib/env', () => ({ serverEnv: { twilioPhoneNumber: () => '+15005550006', appBaseUrl: () => 'https://app.test' } }))
jest.mock('@/lib/slack/client', () => ({ sendSlackMessage: async () => undefined }))
jest.mock('@/lib/auth/checkout-token', () => ({ generateCheckoutToken: async () => 'tok' }))

import { sendSms } from '../sender'
import { sendPaymentLinkSms, sendReminder24hSms, sendReminder48hSms } from '../triggers'

const logs: string[] = []
beforeEach(() => {
  logs.length = 0
  delete process.env['TWILIO_ENABLED']
  createMock.mockReset().mockResolvedValue({ sid: 'SM1' })
  for (const level of ['info', 'warn', 'error'] as const) {
    jest.spyOn(console, level).mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(' ')) })
  }
})
afterEach(() => jest.restoreAllMocks())

const PARAMS = { orderId: 'o-1', patientId: 'pt-1', toNumber: '+15125550123', templateName: 'payment_link', body: 'Pay here' } as Parameters<typeof sendSms>[0]

/** sms_log counts are 0; the patient answers as given. */
function world(patient: Script): Script {
  return c => {
    if (c.table === 'patients') return patient(c)
    if (c.table === 'sms_log' && c.head) return { count: 0 }
    return undefined
  }
}

describe('sendSms checks opt-in itself', () => {
  it('opted out: refused, never dispatched, and the refusal is recorded with the reason', async () => {
    db = scriptedDb(world(() => ({ data: { sms_opt_in: false } })))
    await expect(sendSms(PARAMS)).resolves.toEqual({ outcome: 'skipped', reason: 'sms_opt_out' })
    expect(createMock).not.toHaveBeenCalled()
    const read = db.to('patients', 'select')[0]!
    expect(read.filters).toEqual(expect.objectContaining({ patient_id: 'pt-1' }))
    const [logged] = db.to('sms_log', 'insert')
    expect(logged!.payload).toEqual(expect.objectContaining({
      order_id: 'o-1', patient_id: 'pt-1', template_name: 'payment_link', status: 'suppressed', error_code: 'sms_opt_out',
    }))
    expect((logged!.payload as Record<string, unknown>)['twilio_message_sid'] ?? null).toBeNull()
  })

  it('refused even when Twilio is switched off, so the record is the same everywhere', async () => {
    process.env['TWILIO_ENABLED'] = 'false'
    db = scriptedDb(world(() => ({ data: { sms_opt_in: false } })))
    await expect(sendSms(PARAMS)).resolves.toEqual({ outcome: 'skipped', reason: 'sms_opt_out' })
  })

  it('an opt-in that cannot be read is refused (fail closed), not sent', async () => {
    db = scriptedDb(world(() => DB_DOWN))
    await expect(sendSms(PARAMS)).resolves.toEqual({ outcome: 'failed', reason: 'opt_in_check_failed' })
    expect(createMock).not.toHaveBeenCalled()
  })

  it('a patient that is not found is refused', async () => {
    db = scriptedDb(world(() => ({ data: null })))
    await expect(sendSms(PARAMS)).resolves.toEqual({ outcome: 'skipped', reason: 'patient_not_found' })
    expect(createMock).not.toHaveBeenCalled()
  })

  it('opted in: sent as before', async () => {
    db = scriptedDb(world(() => ({ data: { sms_opt_in: true } })))
    await expect(sendSms(PARAMS)).resolves.toEqual({ outcome: 'sent', messageSid: 'SM1' })
    expect(createMock).toHaveBeenCalledTimes(1)
  })

  it('a refused send does not count toward the rate limit or the duplicate check', async () => {
    db = scriptedDb(world(() => ({ data: { sms_opt_in: true } })))
    await sendSms(PARAMS)
    for (const count of db.to('sms_log', 'select').filter(c => c.head)) {
      expect(count.filters).toEqual(expect.objectContaining({ 'status:neq': 'suppressed' }))
    }
  })

  it('the log names the order and patient, not the phone', async () => {
    db = scriptedDb(world(() => ({ data: { sms_opt_in: false } })))
    await sendSms(PARAMS)
    expect(logs.join('\n')).toMatch(/opted out/)
    expect(logs.join('\n')).not.toContain('5125550123')
  })
})

describe('payment texts carry no PHI', () => {
  const ORDER_CONTEXT = {
    tracking_url: null,
    patients: { patient_id: 'pt-1', first_name: 'Alex', phone: '+15125550123', sms_opt_in: true },
    clinics: { clinic_id: 'c-1', name: 'Sunrise Weight Loss Clinic' },
    providers: { last_name: 'Chen' },
    pharmacies: { supports_real_time_status: false },
    medication_snapshot: { medication_name: 'Semaglutide 5mg/mL Injectable' },
  }
  // Even if the stored template still names the clinic (the migration has
  // not run yet), the text sent does not.
  const OLD_TEMPLATE = 'Hi {{patientFirstName}}, Dr. {{providerLastName}} sent you a secure payment link for your prescription from {{clinicName}}: {{checkoutUrl}}'

  beforeEach(() => {
    db = scriptedDb(c => {
      if (c.table === 'orders') return { data: ORDER_CONTEXT }
      if (c.table === 'sms_templates') return { data: { body_template: OLD_TEMPLATE } }
      if (c.table === 'patients') return { data: { sms_opt_in: true } }
      if (c.table === 'sms_log' && c.head) return { count: 0 }
      return undefined
    })
  })

  it.each([
    ['payment link', () => sendPaymentLinkSms('o-1', 'https://app.test/checkout/tok')],
    ['24h reminder', () => sendReminder24hSms('o-1')],
    ['48h reminder', () => sendReminder48hSms('o-1')],
  ])('%s: first name, the link and how to stop; no clinic, no drug, no last name', async (_name, send) => {
    await send()
    expect(createMock).toHaveBeenCalledTimes(1)
    const body = (createMock.mock.calls[0]![0] as { body: string }).body
    expect(body).toContain('Alex')
    expect(body).toContain('https://app.test/checkout/tok')
    expect(body).toMatch(/Reply STOP to opt out/)
    expect(body).not.toMatch(/Sunrise|Weight Loss|clinic/i)
    expect(body).not.toMatch(/Semaglutide|prescription|medication/i)
    expect(body.length).toBeLessThanOrEqual(320)
  })
})
