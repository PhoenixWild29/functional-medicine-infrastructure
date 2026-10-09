/**
 * @jest-environment node
 *
 * Patient Intake PR 2: the Twilio Line Type check on a new patient's
 * mobile number. A landline or VoIP number cannot receive the intake text,
 * so it is refused. Twilio is not configured on prod: then the check is
 * skipped (never fails the request, never calls Twilio). A Lookup error is
 * not the patient's fault: the number is accepted and the error logged
 * without the number.
 */

const fetchMock = jest.fn()
const phoneNumbersMock = jest.fn(() => ({ fetch: fetchMock }))
jest.mock('@/lib/twilio/client', () => ({
  createTwilioClient: () => ({ lookups: { v2: { phoneNumbers: phoneNumbersMock } } }),
}))

import { checkMobileLineType } from '../line-type'

const CONFIGURED = { TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't', TWILIO_PHONE_NUMBER: '+15125550100' }

beforeEach(() => {
  fetchMock.mockReset()
  phoneNumbersMock.mockClear()
})

it('skips the check, and calls nothing, when Twilio is not configured', async () => {
  expect(await checkMobileLineType('+15125550123', {})).toEqual({ ok: true, checked: false, lineType: null })
  expect(phoneNumbersMock).not.toHaveBeenCalled()
})

it('accepts a mobile number', async () => {
  fetchMock.mockResolvedValue({ lineTypeIntelligence: { type: 'mobile' } })
  expect(await checkMobileLineType('+15125550123', CONFIGURED)).toEqual({ ok: true, checked: true, lineType: 'mobile' })
  expect(phoneNumbersMock).toHaveBeenCalledWith('+15125550123')
  expect(fetchMock).toHaveBeenCalledWith({ fields: 'line_type_intelligence' })
})

it.each(['landline', 'fixedVoip', 'nonFixedVoip'])('refuses a %s number', async type => {
  fetchMock.mockResolvedValue({ lineTypeIntelligence: { type } })
  expect(await checkMobileLineType('+15125550123', CONFIGURED)).toEqual({ ok: false, checked: true, lineType: type })
})

it('accepts the number, and logs no number, when the Lookup call fails', async () => {
  fetchMock.mockRejectedValue(new Error('Lookup down for +15125550123'))
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
  expect(await checkMobileLineType('+15125550123', CONFIGURED)).toEqual({ ok: true, checked: false, lineType: null })
  expect(JSON.stringify(warn.mock.calls)).not.toContain('5550123')
  warn.mockRestore()
})
