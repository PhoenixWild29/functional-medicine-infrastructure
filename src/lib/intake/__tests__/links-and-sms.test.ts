/**
 * @jest-environment node
 *
 * Patient Intake PR 2: intake links (single use, expiring, hashed) and the
 * one intake text.
 *
 * Links: a new link revokes the patient's open one first (one open link per
 * patient, which a unique index also enforces). Only the SHA-256 of the
 * token is written. Resolving a token reads by hash and tells open,
 * expired, used (or revoked) and invalid apart; claiming it is one
 * conditional UPDATE, so two submits cannot both use it.
 *
 * Text: sent only when Twilio is configured, to a patient who has not
 * replied STOP. Every outcome is recorded on the link (sms_status), and a
 * send or refusal goes in sms_log without an order. Nothing logged names
 * the patient or the number.
 */

import { scriptedDb, DB_DOWN, type ScriptedCall, type ScriptedAnswer } from '@/__tests__/helpers/scripted-db'

const createMessageMock = jest.fn()
jest.mock('@/lib/twilio/client', () => ({
  createTwilioClient: () => ({ messages: { create: (...a: unknown[]) => createMessageMock(...a) } }),
}))

import { createIntakeLink, resolveIntakeLink, claimIntakeLink, releaseIntakeLink } from '../links'
import { sendIntakeLinkSms } from '../sms'
import { hashIntakeToken } from '../token'

const CLINIC_ID  = 'aaaaaaaa-aaaa-4aaa-9aaa-aaaaaaaaaaaa'
const PATIENT_ID = 'b3000000-0000-4000-8000-000000000009'
const ENV = { ...process.env }

beforeEach(() => {
  process.env = { ...ENV, APP_BASE_URL: 'https://app.test' }
  createMessageMock.mockReset().mockResolvedValue({ sid: 'SM123' })
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => { process.env = ENV; jest.restoreAllMocks() })

describe('createIntakeLink', () => {
  it('revokes the open link, then stores only the hash, expiring in 72 hours', async () => {
    const db = scriptedDb(c => (c.op === 'insert' ? { data: { link_id: 'link-1' } } : undefined))
    const before = Date.now()
    const res = await createIntakeLink(db.client, { clinicId: CLINIC_ID, patientId: PATIENT_ID, createdBy: 'user-1' })
    if (!res.ok) throw new Error('expected ok')

    const [revoke, insert] = db.calls
    expect(revoke!.op).toBe('update')
    expect(revoke!.filters).toEqual(expect.objectContaining({ patient_id: PATIENT_ID, 'used_at:is': null, 'revoked_at:is': null }))
    expect(revoke!.payload).toEqual({ revoked_at: expect.any(String) })

    const row = insert!.payload as Record<string, string>
    expect(row['token_hash']).toBe(hashIntakeToken(res.token))
    expect(JSON.stringify(row)).not.toContain(res.token)
    expect(row).toEqual(expect.objectContaining({ clinic_id: CLINIC_ID, patient_id: PATIENT_ID, created_by: 'user-1' }))
    const ttl = Date.parse(row['expires_at']!) - before
    expect(ttl).toBeGreaterThanOrEqual(72 * 3600_000 - 1000)
    expect(ttl).toBeLessThanOrEqual(72 * 3600_000 + 5000)

    expect(res.url).toBe(`https://app.test/intake/${res.token}`)
    expect(res.linkId).toBe('link-1')
  })

  it('retries once if a concurrent resend opened a link in between (unique violation)', async () => {
    let inserts = 0
    const db = scriptedDb(c => {
      if (c.op !== 'insert') return undefined
      inserts++
      return inserts === 1 ? { error: { message: 'duplicate key', code: '23505' } } : { data: { link_id: 'link-2' } }
    })
    const res = await createIntakeLink(db.client, { clinicId: CLINIC_ID, patientId: PATIENT_ID, createdBy: 'user-1' })
    expect(res.ok).toBe(true)
    expect(db.to('patient_intake_links', 'update')).toHaveLength(2)
  })

  it('fails closed on a database error', async () => {
    const db = scriptedDb(c => (c.op === 'insert' ? DB_DOWN : undefined))
    expect(await createIntakeLink(db.client, { clinicId: CLINIC_ID, patientId: PATIENT_ID, createdBy: null })).toEqual({ ok: false, error: 'db' })
  })
})

describe('resolveIntakeLink', () => {
  const TOKEN = 'A'.repeat(43)
  const future = new Date(Date.now() + 3600_000).toISOString()
  const past   = new Date(Date.now() - 1000).toISOString()
  const row = (extra: Record<string, unknown>) => ({
    link_id: 'link-1', clinic_id: CLINIC_ID, patient_id: PATIENT_ID, expires_at: future, used_at: null, revoked_at: null,
    clinics: { name: 'Test Clinic' }, ...extra,
  })

  it('reads by hash and returns the link and clinic name when open', async () => {
    const db = scriptedDb(() => ({ data: row({}) }))
    const res = await resolveIntakeLink(db.client, TOKEN)
    expect(db.calls[0]!.filters['token_hash']).toBe(hashIntakeToken(TOKEN))
    expect(res).toEqual({ state: 'open', link: { linkId: 'link-1', clinicId: CLINIC_ID, patientId: PATIENT_ID, expiresAt: future }, clinicName: 'Test Clinic' })
  })

  it.each([
    ['expired', { expires_at: past }],
    ['used', { used_at: past }],
    ['used', { revoked_at: past }],
  ])('%s', async (state, extra) => {
    const db = scriptedDb(() => ({ data: row(extra) }))
    expect((await resolveIntakeLink(db.client, TOKEN)).state).toBe(state)
  })

  it('invalid: unknown hash, or not a token at all (no database call)', async () => {
    const db = scriptedDb(() => ({ data: null }))
    expect((await resolveIntakeLink(db.client, TOKEN)).state).toBe('invalid')
    const db2 = scriptedDb(() => ({ data: row({}) }))
    expect((await resolveIntakeLink(db2.client, 'short')).state).toBe('invalid')
    expect(db2.calls).toHaveLength(0)
  })

  it('unavailable on a read error (never treated as open)', async () => {
    const db = scriptedDb(() => DB_DOWN)
    expect((await resolveIntakeLink(db.client, TOKEN)).state).toBe('unavailable')
  })
})

describe('claimIntakeLink / releaseIntakeLink', () => {
  it('claims with one conditional update: unused, unrevoked, unexpired', async () => {
    const db = scriptedDb(() => ({ data: { link_id: 'link-1' } }))
    expect(await claimIntakeLink(db.client, 'link-1')).toBe(true)
    const c = db.calls[0]!
    expect(c.op).toBe('update')
    expect(c.filters).toEqual(expect.objectContaining({ link_id: 'link-1', 'used_at:is': null, 'revoked_at:is': null, 'expires_at:gt': expect.any(String) }))
  })

  it('a second claim gets nothing', async () => {
    const db = scriptedDb(() => ({ data: null }))
    expect(await claimIntakeLink(db.client, 'link-1')).toBe(false)
  })

  it('release puts a claimed link back (when saving the details failed)', async () => {
    const db = scriptedDb(() => undefined)
    await releaseIntakeLink(db.client, 'link-1')
    expect(db.calls[0]!.payload).toEqual({ used_at: null })
  })
})

describe('sendIntakeLinkSms', () => {
  const TWILIO = { TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't', TWILIO_PHONE_NUMBER: '+15125550100' }
  const args = { patientId: PATIENT_ID, linkId: 'link-1', toE164: '+15125550123', url: 'https://app.test/intake/x' }
  const patientRow = (extra: Record<string, unknown> = {}) => (c: ScriptedCall): ScriptedAnswer | undefined =>
    c.table === 'patients' ? { data: { sms_opt_in: false, sms_consent_source: null, ...extra } } : undefined

  it('not_configured without Twilio: no send, recorded on the link', async () => {
    const db = scriptedDb(patientRow())
    expect(await sendIntakeLinkSms(db.client, args)).toBe('not_configured')
    expect(createMessageMock).not.toHaveBeenCalled()
    expect(db.to('patient_intake_links', 'update')[0]!.payload).toEqual({ sms_status: 'not_configured' })
  })

  it('sends the no-PHI text when configured, and logs it in sms_log without an order', async () => {
    Object.assign(process.env, TWILIO)
    const db = scriptedDb(patientRow())
    expect(await sendIntakeLinkSms(db.client, args)).toBe('sent')
    expect(createMessageMock).toHaveBeenCalledWith(expect.objectContaining({
      to: '+15125550123', from: '+15125550100',
      body: 'Your provider has sent you a secure link to complete your details: https://app.test/intake/x Reply STOP to opt out.',
    }))
    expect(db.to('sms_log', 'insert')[0]!.payload).toEqual(expect.objectContaining({
      order_id: null, patient_id: PATIENT_ID, template_name: 'intake_link', status: 'sent', twilio_message_sid: 'SM123',
    }))
    expect(db.to('patient_intake_links', 'update')[0]!.payload).toEqual({ sms_status: 'sent' })
  })

  it('a patient who replied STOP is not texted (suppressed, on record)', async () => {
    Object.assign(process.env, TWILIO)
    const db = scriptedDb(patientRow({ sms_consent_source: 'sms_keyword_stop' }))
    expect(await sendIntakeLinkSms(db.client, args)).toBe('suppressed')
    expect(createMessageMock).not.toHaveBeenCalled()
    expect(db.to('sms_log', 'insert')[0]!.payload).toEqual(expect.objectContaining({ status: 'suppressed', twilio_message_sid: null }))
  })

  it('cannot read the patient: does not send (fails closed)', async () => {
    Object.assign(process.env, TWILIO)
    const db = scriptedDb(c => (c.table === 'patients' ? DB_DOWN : undefined))
    expect(await sendIntakeLinkSms(db.client, args)).toBe('failed')
    expect(createMessageMock).not.toHaveBeenCalled()
  })

  it('a Twilio error is failed, and the log names neither number nor patient', async () => {
    Object.assign(process.env, TWILIO)
    createMessageMock.mockRejectedValue(new Error('21211 invalid To +15125550123'))
    const err = jest.spyOn(console, 'error')
    const db = scriptedDb(patientRow())
    expect(await sendIntakeLinkSms(db.client, args)).toBe('failed')
    expect(JSON.stringify(err.mock.calls)).not.toMatch(/5550123/)
  })
})
