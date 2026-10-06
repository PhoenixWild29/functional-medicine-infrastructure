/**
 * @jest-environment node
 *
 * Payment-confirmation text (C7 follow-up). The checkout and success pages
 * now promise "a text confirming your payment", so one is sent. Content is
 * the patient's first name and a neutral line only: no clinic name, no
 * drug, no amount, nothing that names a specialty, not "prescription" or
 * "pharmacy". Sent through sendSms (opt-in, rate limit, dedup), never
 * Twilio directly. Twilio and the database are mocked.
 */

const sendSmsMock = jest.fn()
let orderRow: unknown = null

jest.mock('@/lib/sms/sender', () => ({
  sendSms: (p: unknown) => sendSmsMock(p),
}))

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: orderRow, error: null }) }),
      }),
    }),
  }),
}))

import { buildPaymentConfirmationBody } from '../templates'
import { sendPaymentConfirmationSms } from '../triggers'

const EXPECTED = "Hi Jane, your payment is confirmed. We'll text you again when your order ships."

function order(patient: Record<string, unknown> = {}) {
  return {
    tracking_url: null,
    patients:   { patient_id: 'pt-1', first_name: 'Jane', phone: '+15125550123', sms_opt_in: true, ...patient },
    clinics:    { clinic_id: 'c-1', name: 'Sunrise Hormone & Weight Loss Clinic' },
    providers:  { last_name: 'Chen' },
    pharmacies: { supports_real_time_status: true },
  }
}

beforeEach(() => {
  sendSmsMock.mockReset().mockResolvedValue({ outcome: 'sent', messageSid: 'SM1' })
  orderRow = order()
})

describe('payment-confirmation text wording', () => {
  it('is the first name and a neutral line only', () => {
    expect(buildPaymentConfirmationBody({ patientFirstName: 'Jane' })).toBe(EXPECTED)
  })

  it('names no clinic, drug, amount, specialty, prescription or pharmacy', () => {
    const body = buildPaymentConfirmationBody({ patientFirstName: 'Jane' })
    expect(body).not.toMatch(/prescription|pharmacy|clinic|dr\.|\$|\d|weight|hormone|semaglutide|tirzepatide|mg/i)
  })
})

describe('sendPaymentConfirmationSms', () => {
  it('sends exactly one text through sendSms with the payment_confirmation template', async () => {
    await expect(sendPaymentConfirmationSms('o-1')).resolves.toEqual({ outcome: 'sent', messageSid: 'SM1' })
    expect(sendSmsMock).toHaveBeenCalledTimes(1)
    expect(sendSmsMock).toHaveBeenCalledWith({
      orderId:      'o-1',
      patientId:    'pt-1',
      toNumber:     '+15125550123',
      templateName: 'payment_confirmation',
      body:         EXPECTED,
    })
  })

  it('does not put the clinic name in the text', async () => {
    await sendPaymentConfirmationSms('o-1')
    const body = (sendSmsMock.mock.calls[0]![0] as { body: string }).body
    expect(body).not.toMatch(/Sunrise|Clinic|Chen/)
  })

  it('skips a patient who has not opted in to texts', async () => {
    orderRow = order({ sms_opt_in: false })
    await expect(sendPaymentConfirmationSms('o-1')).resolves.toEqual({ outcome: 'skipped', reason: 'sms_opt_out' })
    expect(sendSmsMock).not.toHaveBeenCalled()
  })

  it('skips a patient with no phone number', async () => {
    orderRow = order({ phone: null })
    await expect(sendPaymentConfirmationSms('o-1')).resolves.toEqual({ outcome: 'skipped', reason: 'no_phone_number' })
    expect(sendSmsMock).not.toHaveBeenCalled()
  })

  it('skips when the order cannot be found', async () => {
    orderRow = null
    await expect(sendPaymentConfirmationSms('o-1')).resolves.toEqual({ outcome: 'skipped', reason: 'order_not_found' })
    expect(sendSmsMock).not.toHaveBeenCalled()
  })
})
