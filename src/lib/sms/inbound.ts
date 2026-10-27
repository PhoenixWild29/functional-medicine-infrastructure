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
//
// PHI access log (L8, B14/B15): the consent change is a write to each
// patient, so it is logged BEFORE the update: one update / patient row
// per patient with that phone, by the system, with that patient's clinic
// (one insert, logPhiAccessBatch). Unlike other writes, a log that cannot
// be written does NOT refuse it: a STOP must always be honoured (TCPA),
// so the update runs and the failure is left to the helper's alert. A
// patient the pre-read missed (it failed, or the row appeared meanwhile)
// is logged after the update, best effort. An update that fails after
// logging gets a not_completed_patient row per patient.

import { createServiceClient } from '@/lib/supabase/service'
import { toE164 } from '@/lib/patients/phone'
import { logPhiAccessBatch, logPhiWriteNotCompleted, systemActor, type PhiAccessTarget } from '@/lib/audit/phi-access'

const ROUTE = '/api/webhooks/twilio'
// Built per call, not at module load (every SMS module imports this one).
const entry = () => ({ actor: systemActor(null), action: 'update', resource: 'patient', route: ROUTE } as const)

type PatientRef = { patient_id: string; clinic_id: string | null }
const targetsOf = (rows: PatientRef[]): PhiAccessTarget[] => rows.map(r => ({ patientId: r.patient_id, clinicId: r.clinic_id ?? null }))

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

  // L8: who this changes, logged before the change (never refusing it).
  const { data: before, error: readError } = await supabase
    .from('patients')
    .select('patient_id, clinic_id')
    .eq('phone_e164', phone)
  const logged = new Set<string>()
  if (readError) {
    console.error(`[twilio-inbound] patients for the ${what} could not be read first; logging after | code=${(readError as { code?: string }).code ?? 'unknown'}`)
  } else {
    const rows = (before ?? []) as PatientRef[]
    if (rows.length > 0) {
      // A false is alerted by the helper; the opt-out goes ahead regardless.
      if (!(await logPhiAccessBatch(entry(), targetsOf(rows)))) {
        console.error(`[twilio-inbound] ${what} not recorded in the access log; applied anyway | patients=${rows.map(r => r.patient_id).join(',')}`)
      }
      for (const r of rows) logged.add(r.patient_id)
    }
  }

  const { data, error } = await supabase
    .from('patients')
    .update({
      sms_opt_in:         optIn,
      sms_consent_at:     new Date().toISOString(),
      sms_consent_source: optIn ? SMS_CONSENT_SOURCE.keywordStart : SMS_CONSENT_SOURCE.keywordStop,
    })
    .eq('phone_e164', phone)
    .select('patient_id, clinic_id')

  if (error) {
    // The code only: a Postgres message can quote the phone.
    console.error(`[twilio-inbound] CRITICAL: ${what} could not be recorded | code=${(error as { code?: string }).code ?? 'unknown'}`)
    for (const r of (before ?? []) as PatientRef[]) {
      if (logged.has(r.patient_id)) await logPhiWriteNotCompleted({ ...entry(), patientId: r.patient_id, clinicId: r.clinic_id ?? null })
    }
    return twiml()
  }
  const updated = (data ?? []) as PatientRef[]
  const missed = updated.filter(r => !logged.has(r.patient_id))
  if (missed.length > 0) await logPhiAccessBatch(entry(), targetsOf(missed))
  const ids = updated.map(p => p.patient_id)
  if (ids.length === 0) {
    console.info(`[twilio-inbound] ${what} from a number no patient has; nothing changed`)
  } else {
    console.info(`[twilio-inbound] ${what} recorded | patients=${ids.join(',')}`)
  }
  return twiml()
}
