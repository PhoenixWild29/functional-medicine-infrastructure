// ============================================================
// The plan link text (patient protocol choice, PR 2)
// ============================================================
//
// The link never depends on texting (decision 10): the provider can always
// copy it or show a QR code. The text goes only when texting is set up
// (Twilio configured and TWILIO_ENABLED not 'false', lib/twilio/config)
// AND the patient opted in (patients.sms_opt_in). It is name-free
// (PROPOSAL_LINK_SMS, Compliance C1).
//
// Every send or refusal goes in sms_log without an order (a proposal is
// not an order). Logs carry ids and codes only, never the number.

import { createTwilioClient } from '@/lib/twilio/client'
import { isTwilioConfigured } from '@/lib/twilio/config'
import { renderProposalLinkSms } from '@/lib/sms/templates'
import { logPhiDisclosure, systemActor } from '@/lib/audit/phi-access'

type Db = { from: (table: string) => unknown }
type Q = {
  select: (c: string) => Q
  insert: (p: unknown) => Q
  eq: (c: string, v: unknown) => Q
  maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }>
  then: Promise<{ data: unknown; error: { message: string } | null }>['then']
}

export type TextingOutcome = 'sent' | 'texting_off' | 'not_opted_in' | 'no_phone' | 'failed'

export interface ProposalSmsInput {
  proposalId:       string
  patientId:        string
  providerLastName: string
  url:              string
}

export const PROPOSAL_SMS_TEMPLATE = 'proposal_link'

export function textingEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return isTwilioConfigured(env)
}

async function logSms(
  db: Db, input: ProposalSmsInput, toNumber: string, status: 'sent' | 'suppressed' | 'failed', sid: string | null, errorCode: string | null,
): Promise<void> {
  const { error } = await (db.from('sms_log') as Q).insert({
    order_id:           null,
    patient_id:         input.patientId,
    template_name:      PROPOSAL_SMS_TEMPLATE,
    twilio_message_sid: sid,
    to_number:          toNumber,
    status,
    error_code:         errorCode,
    sent_at:            status === 'sent' ? new Date().toISOString() : null,
  })
  if (error) console.error('[proposal-sms] sms_log insert failed:', error.message, '| proposal=', input.proposalId)
}

export async function sendProposalLinkSms(db: Db, input: ProposalSmsInput): Promise<TextingOutcome> {
  if (!textingEnabled()) return 'texting_off'

  // Opt-in is read here, not trusted from a caller. Unreadable: not sent.
  const { data, error } = await (db.from('patients') as Q)
    .select('first_name, phone_e164, sms_opt_in, clinic_id')
    .eq('patient_id', input.patientId)
    .maybeSingle()
  if (error || !data) {
    console.error('[proposal-sms] patient consent unreadable; not sent | proposal=', input.proposalId)
    return 'failed'
  }
  const p = data as { first_name: string | null; phone_e164: string | null; sms_opt_in: boolean | null; clinic_id?: string | null }
  if (!p.phone_e164) return 'no_phone'
  if (p.sms_opt_in !== true) {
    await logSms(db, input, p.phone_e164, 'suppressed', null, 'sms_opt_out')
    return 'not_opted_in'
  }

  // Review L2: the text discloses the phone, first name and provider to
  // Twilio. Fail-closed: no row, no text.
  const clinicId = p.clinic_id ?? null
  if (!(await logPhiDisclosure({ actor: systemActor(clinicId), resource: 'sms_disclosure', route: `/sms/${PROPOSAL_SMS_TEMPLATE}`, patientId: input.patientId, clinicId }))) {
    console.error('[proposal-sms] disclosure not recorded; not sent | proposal=', input.proposalId)
    return 'failed'
  }

  try {
    const message = await createTwilioClient().messages.create({
      to:   p.phone_e164,
      from: process.env['TWILIO_PHONE_NUMBER']!,
      body: renderProposalLinkSms({ patientFirstName: (p.first_name ?? '').trim() || 'there', providerLastName: input.providerLastName, planUrl: input.url }),
    })
    await logSms(db, input, p.phone_e164, 'sent', message.sid, null)
    return 'sent'
  } catch (err) {
    const code = (err as { code?: unknown })?.code
    const errorCode = typeof code === 'number' || typeof code === 'string' ? String(code) : 'send_failed'
    console.error('[proposal-sms] send failed | proposal=', input.proposalId, '| code=', errorCode)
    await logSms(db, input, p.phone_e164, 'failed', null, errorCode)
    return 'failed'
  }
}
