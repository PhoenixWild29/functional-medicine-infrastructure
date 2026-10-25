/**
 * @jest-environment node
 *
 * The plan link text (patient protocol choice, PR 2). Compliance C1, as
 * the payment texts (sms/__tests__/opt-in-gate.test.ts): the patient's
 * first name, the provider's last name, the link and how to stop. No
 * medication, no clinic name, not even "prescription".
 *
 * Sent only when texting is set up (Twilio configured, TWILIO_ENABLED not
 * false) and the patient opted in. Otherwise nothing is sent and the
 * provider copies the link or shows the QR code. Twilio is mocked.
 */

import { scriptedDb, DB_DOWN } from '@/__tests__/helpers/scripted-db'
import { PROPOSAL_LINK_SMS, renderProposalLinkSms } from '@/lib/sms/templates'
import { sendProposalLinkSms, textingEnabled } from '../sms'

const createMock = jest.fn()
jest.mock('@/lib/twilio/client', () => ({ createTwilioClient: () => ({ messages: { create: (p: unknown) => createMock(p) } }) }))

const ENV = { TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't', TWILIO_PHONE_NUMBER: '+15005550006' }
const INPUT = { proposalId: 'prop-1', patientId: 'pt-1', providerLastName: 'Chen', url: 'https://app.test/plan/abc' }

beforeEach(() => {
  Object.assign(process.env, ENV)
  delete process.env['TWILIO_ENABLED']
  createMock.mockReset().mockResolvedValue({ sid: 'SM1' })
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  for (const k of Object.keys(ENV)) delete process.env[k]
  jest.restoreAllMocks()
})

describe('the template', () => {
  it('names only the patient, the provider, the link and how to stop', () => {
    expect([...PROPOSAL_LINK_SMS.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1])).toEqual(['patientFirstName', 'providerLastName', 'planUrl'])
    expect(PROPOSAL_LINK_SMS).toContain('Reply STOP to opt out.')
    expect(PROPOSAL_LINK_SMS).not.toMatch(/prescription|medication|clinic|pharmacy/i)
    expect(renderProposalLinkSms({ patientFirstName: 'Jordan', providerLastName: 'Chen', planUrl: 'https://app.test/plan/x' }))
      .toBe('Hi Jordan, Dr. Chen has a treatment plan ready for you to review: https://app.test/plan/x Reply STOP to opt out.')
  })
})

describe('texting enabled', () => {
  it('needs Twilio configured and TWILIO_ENABLED not false', () => {
    expect(textingEnabled({ ...ENV })).toBe(true)
    expect(textingEnabled({ ...ENV, TWILIO_ENABLED: 'false' })).toBe(false)
    expect(textingEnabled({})).toBe(false)
  })
})

describe('the opt-in gate', () => {
  const patient = (row: Record<string, unknown> | null) => scriptedDb(c => (c.table === 'patients' ? { data: row } : undefined))

  it('opted in: sent once and logged without an order', async () => {
    const db = patient({ first_name: 'Jordan', phone_e164: '+15125550123', sms_opt_in: true })
    expect(await sendProposalLinkSms(db.client, INPUT)).toBe('sent')
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ to: '+15125550123', body: expect.stringContaining('Hi Jordan, Dr. Chen') }))
    expect(db.to('sms_log', 'insert')[0]!.payload).toEqual(expect.objectContaining({ order_id: null, patient_id: 'pt-1', template_name: 'proposal_link', status: 'sent' }))
  })

  it('not opted in (or replied STOP): never dispatched; the refusal is logged', async () => {
    const db = patient({ first_name: 'Jordan', phone_e164: '+15125550123', sms_opt_in: false })
    expect(await sendProposalLinkSms(db.client, INPUT)).toBe('not_opted_in')
    expect(createMock).not.toHaveBeenCalled()
    expect(db.to('sms_log', 'insert')[0]!.payload).toEqual(expect.objectContaining({ status: 'suppressed', error_code: 'sms_opt_out' }))
  })

  it('consent that cannot be read: not sent', async () => {
    const db = scriptedDb(c => (c.table === 'patients' ? DB_DOWN : undefined))
    expect(await sendProposalLinkSms(db.client, INPUT)).toBe('failed')
    expect(createMock).not.toHaveBeenCalled()
  })

  it('no mobile number: nothing to send', async () => {
    const db = patient({ first_name: 'Jordan', phone_e164: null, sms_opt_in: true })
    expect(await sendProposalLinkSms(db.client, INPUT)).toBe('no_phone')
    expect(createMock).not.toHaveBeenCalled()
  })

  it('texting off: nothing read, nothing sent', async () => {
    process.env['TWILIO_ENABLED'] = 'false'
    const db = patient({ first_name: 'Jordan', phone_e164: '+15125550123', sms_opt_in: true })
    expect(await sendProposalLinkSms(db.client, INPUT)).toBe('texting_off')
    expect(db.calls).toHaveLength(0)
    expect(createMock).not.toHaveBeenCalled()
  })
})
