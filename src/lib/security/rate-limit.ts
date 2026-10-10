// ============================================================
// Fixed-window rate limiter (in memory, no external service)
// ============================================================
//
// N attempts per window per key (e.g. a client IP). Over the limit it
// refuses and says how many seconds are left in the window; a refused
// attempt does not extend it. Keys are independent, so one client's
// failed attempts never block another's.
//
// State lives in this server instance's memory: on Vercel each warm
// function instance keeps its own counts (Fluid compute reuses instances,
// so this still throttles a client hammering one endpoint, but it is not
// a global count across instances or a cold start). Expired keys are
// dropped as the map grows, so memory stays bounded.

export interface RateLimitResult {
  allowed:           boolean
  /** Seconds until the window resets (0 when allowed). */
  retryAfterSeconds: number
}

export interface RateLimiter {
  check(key: string): RateLimitResult
  reset(): void
  /** Keys currently tracked (for tests and diagnostics). */
  size(): number
}

const SWEEP_AT = 10_000

export function createRateLimiter(opts: { limit: number; windowMs: number; now?: () => number }): RateLimiter {
  const { limit, windowMs } = opts
  const now = opts.now ?? (() => Date.now())
  const windows = new Map<string, { start: number; count: number }>()

  function sweep(t: number) {
    for (const [key, w] of windows) if (t - w.start >= windowMs) windows.delete(key)
  }

  return {
    check(key) {
      const t = now()
      let w = windows.get(key)
      if (!w || t - w.start >= windowMs) {
        if (windows.size >= SWEEP_AT || (!w && windows.size > 0)) sweep(t)
        w = { start: t, count: 0 }
        windows.set(key, w)
      }
      if (w.count >= limit) {
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((w.start + windowMs - t) / 1000)) }
      }
      w.count += 1
      return { allowed: true, retryAfterSeconds: 0 }
    },
    reset() { windows.clear() },
    size() { return windows.size },
  }
}
