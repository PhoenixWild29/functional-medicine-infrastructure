// ============================================================
// One hit on a shared rate-limit count (Postgres)
// ============================================================
//
// Security review L7: the in-memory limiter counts per Vercel instance.
// This counts in Postgres through rate_limit_hit() (migration
// 20261024000007), shared by every instance. The key (an IP, a user id,
// a link token hash) is stored only as an HMAC under the audit secret,
// and the hash covers the bucket too, so the same IP in two buckets is two
// unrelated rows.
//
// Returns the window's count (this hit included) and its start, or null
// when the count cannot be had: no audit secret, an RPC error, an odd
// answer or a throw. The caller fails open on null. Logs carry the bucket
// and an error code only, never the key or the error text.

import { auditHash } from '@/lib/audit/keyed-hash'
import { createServiceClient } from '@/lib/supabase/service'

export interface SharedHit {
  count:       number
  /** The window's start, ms since the epoch. */
  windowStart: number
}

let warnedNoSecret = false

export async function dbRateLimitHit(bucket: string, key: string, windowSeconds: number): Promise<SharedHit | null> {
  try {
    const keyHash = await auditHash(`${bucket}:${key}`)
    if (!keyHash) {
      if (!warnedNoSecret) {
        warnedNoSecret = true
        console.warn('[rate-limit] shared count off: no audit hash secret; in-memory limit only')
      }
      return null
    }
    const { data, error } = await createServiceClient().rpc('rate_limit_hit', {
      p_bucket: bucket, p_key_hash: keyHash, p_window_seconds: windowSeconds,
    })
    if (error) {
      console.warn(`[rate-limit] shared count unavailable bucket=${bucket} code=${error.code ?? 'unknown'}; failing open`)
      return null
    }
    const row = Array.isArray(data) ? data[0] : null
    const windowStart = row ? Date.parse(String(row.window_started)) : NaN
    if (!row || typeof row.hits !== 'number' || Number.isNaN(windowStart)) {
      console.warn(`[rate-limit] shared count unreadable bucket=${bucket}; failing open`)
      return null
    }
    return { count: row.hits, windowStart }
  } catch {
    console.warn(`[rate-limit] shared count threw bucket=${bucket}; failing open`)
    return null
  }
}
