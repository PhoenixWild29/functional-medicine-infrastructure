// ============================================================
// A queued fax the transmission guard refused (HIPAA B6 / B7)
// ============================================================
//
// For the paths that hold an order in FAX_QUEUED when the fax adapter
// refuses it: ops force_fax / retry_fax (submitQueuedFax), the fax-retry
// cron and the sla-check cascade. The order moves to FAX_FAILED (FAX_QUEUED
// has no legal way to SUBMISSION_FAILED) with the refusal code as the
// reason, so it is not retried again and ops see why; the alert carries
// the code only.

import { casTransition } from '@/lib/orders/cas-transition'
import { sendSlackAlert, buildAdapterFailureAlert } from '@/lib/slack/client'
import type { TransmissionRefusalCode } from '@/lib/adapters/transmission-guard'

export async function refuseQueuedFax(params: {
  orderId:      string
  pharmacySlug: string
  code:         TransmissionRefusalCode
  actor:        string
}): Promise<void> {
  const { orderId, pharmacySlug, code, actor } = params
  console.error(`[transmission-guard] queued fax refused | order=${orderId} | code=${code}`)
  await casTransition({
    orderId,
    expectedStatus: 'FAX_QUEUED',
    newStatus:      'FAX_FAILED',
    actor,
    actorRole:      'system',
    metadata:       { reason: code },
  }).catch(casErr =>
    console.error(`[transmission-guard] CAS FAX_FAILED (refused) error | order=${orderId}:`, casErr instanceof Error ? casErr.message : casErr)
  )
  await sendSlackAlert(
    buildAdapterFailureAlert({ orderId, pharmacySlug, integrationTier: 'TIER_4_FAX', errorCode: code })
  ).catch(slackErr =>
    console.error('[transmission-guard] Slack refused-fax alert failed:', slackErr)
  )
}
