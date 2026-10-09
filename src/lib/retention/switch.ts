// ============================================================
// Retention switch: RETENTION_ENABLED (Compliance C10)
// ============================================================
//
// Nothing is deleted, nulled or anonymized by a retention job unless
// RETENTION_ENABLED is exactly "true". Unset means OFF, so a new
// environment, a preview, or production before the owner turns it on
// only counts: /api/cron/retention records dry runs in retention_runs,
// and screenshot-cleanup reports what it would delete.
//
// In retention PR 1 no retention policy is live, so even with the switch
// on, /api/cron/retention deletes nothing (a test pins that); only
// screenshot-cleanup, an existing 72-hour policy, acts on it.

import { serverEnv } from '@/lib/env'

export function retentionEnabled(): boolean {
  return serverEnv.retentionEnabled()
}
