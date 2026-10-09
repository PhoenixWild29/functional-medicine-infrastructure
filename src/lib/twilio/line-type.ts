// ============================================================
// Twilio Line Type check (Patient Intake PR 2)
// ============================================================
//
// A new patient's number must be able to receive the intake text: a
// landline or VoIP number is refused. Twilio Lookup v2, line type
// intelligence. Without Twilio (prod today) the check is skipped. A Lookup
// failure is not the patient's fault: the number is accepted, and the
// warning carries no number.

import { createTwilioClient } from './client'
import { isTwilioConfigured } from './config'

export type LineTypeResult =
  | { ok: true; checked: boolean; lineType: string | null }
  | { ok: false; checked: true; lineType: string }

const NOT_MOBILE = new Set(['landline', 'fixedVoip', 'nonFixedVoip'])

export async function checkMobileLineType(
  e164: string,
  env: Record<string, string | undefined> = process.env,
): Promise<LineTypeResult> {
  if (!isTwilioConfigured(env)) return { ok: true, checked: false, lineType: null }
  try {
    const result = await createTwilioClient().lookups.v2.phoneNumbers(e164).fetch({ fields: 'line_type_intelligence' })
    const type = (result.lineTypeIntelligence as { type?: unknown } | null | undefined)?.type
    const lineType = typeof type === 'string' ? type : null
    if (lineType && NOT_MOBILE.has(lineType)) return { ok: false, checked: true, lineType }
    return { ok: true, checked: true, lineType }
  } catch (err) {
    const code = (err as { code?: unknown })?.code
    console.warn('[line-type] Lookup failed; number accepted unchecked', typeof code === 'number' || typeof code === 'string' ? `| code=${code}` : '')
    return { ok: true, checked: false, lineType: null }
  }
}
