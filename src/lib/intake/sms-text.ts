// The one text a patient gets to start intake. No PHI and no clinic name:
// the approved wording (INTAKE_LINK_SMS in sms/templates.ts) with the link
// and how to stop.

import { renderIntakeLinkSms } from '@/lib/sms/templates'

export function intakeSmsText(url: string): string {
  return renderIntakeLinkSms({ intakeUrl: url })
}
