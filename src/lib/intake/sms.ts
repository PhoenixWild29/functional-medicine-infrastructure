// ============================================================
// The intake text (Patient Intake PR 2)
// ============================================================
//
// Sent only when Twilio is configured (prod has none: staff copy or email
// the link instead), and never to a patient who replied STOP. A new
// patient has no SMS consent yet: this one transactional text, which the
// clinic asked for and which carries no PHI, is the only one sent before
// they record a choice on the intake page.
//
// Every outcome is recorded on the link (sms_status); a send or a refusal
// also goes in sms_log, without an order. Logs carry ids and codes only,
// never the number or the clinic name.

import { createTwilioClient } from '@/lib/twilio/client'
import { isTwilioConfigured } from '@/lib/twilio/config'
import { SMS_CONSENT_SOURCE } from '@/lib/sms/inbound'
import { intakeSmsText } from './sms-text'

type Db = { from: (table: string) => unknown }
type Q = {
  select: (c: string) => Q
  update: (p: unknown) => Q
  insert: (p: unknown) => Q
  eq: (c: string, v: unknown) => Q
  maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }>
  then: Promise<{ data: unknown; error: { message: string } | null }>['then']
}

export type IntakeSmsStatus = 'sent' | 'not_configured' | 'suppressed' | 'failed'

export interface IntakeSmsInput {
  patientId:  string
  linkId:     string
  toE164:     string
  clinicName: string
  url:        string
}

const TEMPLATE = 'intake_link'

async function recordOnLink(db: Db, linkId: string, status: IntakeSmsStatus): Promise<void> {
  const { error } = await (db.from('patient_intake_links') as Q).update({ sms_status: status }).eq('link_id', linkId)
  if (error) console.error('[intake-sms] link status not recorded:', error.message, '| link=', linkId)
}

async function logSms(db: Db, input: IntakeSmsInput, status: 'sent' | 'suppressed' | 'failed', sid: string | null, errorCode: string | null): Promise<void> {
  const { error } = await (db.from('sms_log') as Q).insert({
    order_id:           null,
    patient_id:         input.patientId,
    template_name:      TEMPLATE,
    twilio_message_sid: sid,
    to_number:          input.toE164,
    status,
    error_code:         errorCode,
    sent_at:            status === 'sent' ? new Date().toISOString() : null,
  })
  if (error) console.error('[intake-sms] sms_log insert failed:', error.message, '| link=', input.linkId)
}

export async function sendIntakeLinkSms(db: Db, input: IntakeSmsInput): Promise<IntakeSmsStatus> {
  if (!isTwilioConfigured()) {
    await recordOnLink(db, input.linkId, 'not_configured')
    return 'not_configured'
  }

  // A patient who replied STOP is never texted. Unreadable: do not send.
  const { data, error } = await (db.from('patients') as Q)
    .select('sms_opt_in, sms_consent_source')
    .eq('patient_id', input.patientId)
    .maybeSingle()
  if (error || !data) {
    console.error('[intake-sms] patient consent unreadable; not sent | link=', input.linkId)
    await recordOnLink(db, input.linkId, 'failed')
    return 'failed'
  }
  const consent = data as { sms_opt_in: boolean | null; sms_consent_source: string | null }
  if (consent.sms_consent_source === SMS_CONSENT_SOURCE.keywordStop && consent.sms_opt_in !== true) {
    await logSms(db, input, 'suppressed', null, 'opted_out')
    await recordOnLink(db, input.linkId, 'suppressed')
    return 'suppressed'
  }

  try {
    const message = await createTwilioClient().messages.create({
      to:   input.toE164,
      from: process.env['TWILIO_PHONE_NUMBER']!,
      body: intakeSmsText(input.clinicName, input.url),
    })
    await logSms(db, input, 'sent', message.sid, null)
    await recordOnLink(db, input.linkId, 'sent')
    return 'sent'
  } catch (err) {
    const code = (err as { code?: unknown })?.code
    const errorCode = typeof code === 'number' || typeof code === 'string' ? String(code) : 'send_failed'
    console.error('[intake-sms] send failed | link=', input.linkId, '| code=', errorCode)
    await logSms(db, input, 'failed', null, errorCode)
    await recordOnLink(db, input.linkId, 'failed')
    return 'failed'
  }
}
