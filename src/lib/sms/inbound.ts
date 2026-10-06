// ============================================================
// Inbound SMS keywords: STOP / START / HELP (Compliance C1)
// ============================================================
//
// A patient's reply to one of our texts reaches POST /api/webhooks/twilio
// (signature already checked there). The carrier keywords change whether
// we may text them, for every patient row with that phone (phone_e164):
//
//   STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT
//        → sms_opt_in false, sms_consent_at now, source 'sms_keyword_stop'
//   START, YES, UNSTOP
//        → sms_opt_in true,  sms_consent_at now, source 'sms_keyword_start'
//   HELP → a short reply with no PHI (no drug, clinic or name)
//
// Anything else changes nothing. Twilio's own opt-out handling sends the
// carrier confirmation for STOP and START, so those get an empty reply.
//
// Logs name patients by id. The phone and the message are never logged.

import { createServiceClient } from '@/lib/supabase/service'
import { toE164 } from '@/lib/patients/phone'

export type InboundKeyword = 'opt_out' | 'opt_in' | 'help'

const OPT_OUT = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'])
const OPT_IN = new Set(['START', 'YES', 'UNSTOP'])
const HELP = new Set(['HELP'])

export const SMS_CONSENT_SOURCE = {
  keywordStop:  'sms_keyword_stop',
  keywordStart: 'sms_keyword_start',
} as const

/** The reply to HELP: who sends these texts and how to stop them. No PHI. */
export const SMS_HELP_TEXT =
  'CompoundIQ payment texts. Reply STOP to opt out, START to opt back in. Msg and data rates may apply. Questions about an order? Contact the office that sent it.'

/** The keyword a reply is, when the whole reply is one (case, spaces and end punctuation aside). */
export function inboundKeyword(body: string | null | undefined): InboundKeyword | null {
  const word = (body ?? '').trim().replace(/[.!?]+$/, '').trim().toUpperCase()
  if (OPT_OUT.has(word)) return 'opt_out'
  if (OPT_IN.has(word)) return 'opt_in'
  if (HELP.has(word)) return 'help'
  return null
}

function xmlEscape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** TwiML: an empty response, or one message. */
export function twiml(message?: string): string {
  return message
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${xmlEscape(message)}</Message></Response>`
    : '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
}

/**
 * Handle one inbound message; returns the TwiML to answer with. Never
 * throws: a failure is logged (without the phone) and answered empty, so
 * Twilio does not retry into a storm.
 */
export async function handleInboundSms(params: { from: string; body: string }): Promise<string> {
  const keyword = inboundKeyword(params.body)
  if (keyword === null) {
    console.info('[twilio-inbound] reply with no keyword; nothing changed')
    return twiml()
  }
  if (keyword === 'help') {
    console.info('[twilio-inbound] HELP answered')
    return twiml(SMS_HELP_TEXT)
  }

  const phone = toE164(params.from)
  const optIn = keyword === 'opt_in'
  const what = optIn ? 'opt-in' : 'opt-out'
  if (!phone) {
    console.warn(`[twilio-inbound] ${what} from a number that does not parse; nothing changed`)
    return twiml()
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('patients')
    .update({
      sms_opt_in:         optIn,
      sms_consent_at:     new Date().toISOString(),
      sms_consent_source: optIn ? SMS_CONSENT_SOURCE.keywordStart : SMS_CONSENT_SOURCE.keywordStop,
    })
    .eq('phone_e164', phone)
    .select('patient_id')

  if (error) {
    console.error(`[twilio-inbound] CRITICAL: ${what} could not be recorded: ${error.message}`)
    return twiml()
  }
  const ids = ((data ?? []) as Array<{ patient_id: string }>).map(p => p.patient_id)
  if (ids.length === 0) {
    console.info(`[twilio-inbound] ${what} from a number no patient has; nothing changed`)
  } else {
    console.info(`[twilio-inbound] ${what} recorded | patients=${ids.join(',')}`)
  }
  return twiml()
}
