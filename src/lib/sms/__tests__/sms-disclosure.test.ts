/**
 * @jest-environment node
 *
 * C-2026-10-26-04 (review L2): an SMS through Twilio discloses PHI to a
 * vendor (the patient's phone and first name, the provider, a link). Each
 * of the three senders writes one pharmacy-style disclosure row first:
 * logPhiDisclosure, resource sms_disclosure, the system as the actor, the
 * patient (and order), route /sms/<template>. FAIL-CLOSED: when the row
 * cannot be written, Twilio is never called. Twilio is mocked.
 */

import { scriptedDb } from '@/__tests__/helpers/scripted-db'
import { logPhiDisclosure, SYSTEM_ACTOR_ID } from '@/lib/audit/phi-access'

let db = scriptedDb(() => undefined)
const createMock = jest.fn()
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.mock('@/lib/twilio/client', () => ({ createTwilioClient: () => ({ messages: { create: (p: unknown) => createMock(p) } }) }))
jest.mock('@/lib/env', () => ({ serverEnv: { twilioPhoneNumber: () => '+15005550006', appBaseUrl: () => 'https://app.test' } }))
jest.mock('@/lib/slack/client', () => ({ sendSlackMessage: async () => undefined }))

import { sendSms } from '../sender'
import { sendProposalLinkSms } from '@/lib/proposals/sms'
import { sendIntakeLinkSms } from '@/lib/intake/sms'

const disclosure = jest.mocked(logPhiDisclosure)
const ENV = { TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't', TWILIO_PHONE_NUMBER: '+15005550006' }
const CLINIC = 'c-1'

/** The patient opted in, in clinic c-1; every sms_log count is 0. */
const world = () => scriptedDb(c => {
  if (c.table === 'patients') return { data: { sms_opt_in: true, first_name: 'Jordan', phone_e164: '+15125550123', sms_consent_source: 'intake', clinic_id: CLINIC } }
  if (c.table === 'sms_log' && c.head) return { count: 0 }
  return undefined
})

let order: string[] = []
beforeEach(() => {
  Object.assign(process.env, ENV)
  delete process.env['TWILIO_ENABLED']
  db = world()
  order = []
  createMock.mockReset().mockImplementation(async () => { order.push('twilio'); return { sid: 'SM1' } })
  disclosure.mockReset().mockImplementation(async () => { order.push('disclosure'); return true })
  for (const level of ['info', 'warn', 'error'] as const) jest.spyOn(console, level).mockImplementation(() => {})
})
afterEach(() => {
  for (const k of Object.keys(ENV)) delete process.env[k]
  jest.restoreAllMocks()
})

const expectedEntry = (template: string, extra: Record<string, unknown>) => expect.objectContaining({
  actor: expect.objectContaining({ userId: SYSTEM_ACTOR_ID, role: 'system', clinicId: CLINIC }),
  resource: 'sms_disclosure', route: `/sms/${template}`, clinicId: CLINIC, ...extra,
})

describe('sendSms (payment link, confirmation, reminders, shipping)', () => {
  const PARAMS = { orderId: 'o-1', patientId: 'pt-1', toNumber: '+15125550123', templateName: 'payment_link', body: 'Pay here' } as Parameters<typeof sendSms>[0]

  it('writes the disclosure row before Twilio is called', async () => {
    await expect(sendSms(PARAMS)).resolves.toEqual(expect.objectContaining({ outcome: 'sent' }))
    expect(disclosure).toHaveBeenCalledWith(expectedEntry('payment_link', { patientId: 'pt-1', orderId: 'o-1' }))
    expect(order).toEqual(['disclosure', 'twilio'])
  })

  it('the row cannot be written: not sent, failed with disclosure_not_recorded', async () => {
    disclosure.mockResolvedValueOnce(false)
    await expect(sendSms(PARAMS)).resolves.toEqual({ outcome: 'failed', reason: 'disclosure_not_recorded' })
    expect(createMock).not.toHaveBeenCalled()
  })
})

describe('the plan link (proposals)', () => {
  const INPUT = { proposalId: 'prop-1', patientId: 'pt-1', providerLastName: 'Chen', url: 'https://app.test/plan/abc' }

  it('writes the disclosure row before Twilio is called', async () => {
    await expect(sendProposalLinkSms(db.client as never, INPUT)).resolves.toBe('sent')
    expect(disclosure).toHaveBeenCalledWith(expectedEntry('proposal_link', { patientId: 'pt-1' }))
    expect(order).toEqual(['disclosure', 'twilio'])
  })

  it('the row cannot be written: not sent, failed', async () => {
    disclosure.mockResolvedValueOnce(false)
    await expect(sendProposalLinkSms(db.client as never, INPUT)).resolves.toBe('failed')
    expect(createMock).not.toHaveBeenCalled()
  })
})

describe('the intake link', () => {
  const INPUT = { patientId: 'pt-1', linkId: 'link-1', toE164: '+15125550123', url: 'https://app.test/intake/abc' }

  it('writes the disclosure row before Twilio is called', async () => {
    await expect(sendIntakeLinkSms(db.client as never, INPUT)).resolves.toBe('sent')
    expect(disclosure).toHaveBeenCalledWith(expectedEntry('intake_link', { patientId: 'pt-1' }))
    expect(order).toEqual(['disclosure', 'twilio'])
  })

  it('the row cannot be written: not sent, and the link records failed', async () => {
    disclosure.mockResolvedValueOnce(false)
    await expect(sendIntakeLinkSms(db.client as never, INPUT)).resolves.toBe('failed')
    expect(createMock).not.toHaveBeenCalled()
    expect(db.to('patient_intake_links', 'update').map(c => c.payload)).toContainEqual({ sms_status: 'failed' })
  })
})
