// ============================================================
// Rate limiter shared across instances (in memory, then Postgres)
// ============================================================
//
// Security review L7. The same fixed-window limit as createRateLimiter,
// in two layers:
//
//   1. the in-memory limiter of this instance (cheap; refuses at once,
//      with no database call, a client hammering this instance);
//   2. the count shared by every instance (lib/security/db-rate-limit),
//      so N warm instances no longer allow N times the limit.
//
// If the shared count cannot be read, the request is allowed: the limiter
// being down never locks anyone out (db-rate-limit logs a warning).

import { createRateLimiter, type RateLimitResult } from '@/lib/security/rate-limit'
import { dbRateLimitHit } from '@/lib/security/db-rate-limit'

export interface SharedRateLimiter {
  check(key: string): Promise<RateLimitResult>
  /** Clears the in-memory layer (tests). */
  reset(): void
}

export function createSharedRateLimiter(opts: { bucket: string; limit: number; windowMs: number }): SharedRateLimiter {
  const { bucket, limit, windowMs } = opts
  if (!/^[a-z_]{1,40}$/.test(bucket)) throw new Error(`rate limit bucket must be a short lower-case code: ${bucket}`)
  if (windowMs < 1000 || windowMs % 1000 !== 0) throw new Error('rate limit window must be whole seconds')
  const local = createRateLimiter({ limit, windowMs })
  const windowSeconds = windowMs / 1000

  return {
    async check(key) {
      const first = local.check(key)
      if (!first.allowed) return first
      const shared = await dbRateLimitHit(bucket, key, windowSeconds)
      if (!shared || shared.count <= limit) return { allowed: true, retryAfterSeconds: 0 }
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((shared.windowStart + windowMs - Date.now()) / 1000)) }
    },
    reset() { local.reset() },
  }
}
