// ============================================================
// Rate limit for the pharmacy invite-accept route
// ============================================================
//
// POST /api/onboard/pharmacy/<token> creates an account from a token with
// no session, so attempts are limited per client IP: ACCEPT_LIMIT per
// ACCEPT_WINDOW_MS (a fixed window), then 429 with Retry-After.
//
// The client IP is the first x-forwarded-for value, which Vercel's edge
// sets to the address it saw; values a proxy appends after it do not move
// the bucket. A request with none shares one "unknown" bucket.
//
// The store is in memory, per function instance: on Vercel each warm
// instance counts separately and a cold start begins at zero, so this
// slows guessing rather than capping it globally (the token is 256 bits
// and single-use; this is the second line). RateLimiter is async so a
// shared store (another branch is adding one for the clinic accept
// route) can replace createMemoryRateLimiter without touching the route.
//
// Nothing here logs the token or the IP.

export const ACCEPT_LIMIT = 10
export const ACCEPT_WINDOW_MS = 15 * 60_000

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number }

export interface RateLimiter {
  /** Count one attempt for `key`; refused once the window's limit is used. */
  hit(key: string, nowMs?: number): Promise<RateLimitResult>
}

export function createMemoryRateLimiter(opts: { limit: number; windowMs: number; maxKeys?: number }): RateLimiter & { size(): number } {
  const maxKeys = opts.maxKeys ?? 10_000
  const windows = new Map<string, { count: number; resetAt: number }>()

  function prune(nowMs: number) {
    for (const [k, w] of windows) if (w.resetAt <= nowMs) windows.delete(k)
    // Still full: drop the oldest keys (Map keeps insertion order).
    for (const k of windows.keys()) {
      if (windows.size < maxKeys) break
      windows.delete(k)
    }
  }

  return {
    async hit(key, nowMs = Date.now()) {
      let w = windows.get(key)
      if (!w || w.resetAt <= nowMs) {
        if (!w && windows.size >= maxKeys) prune(nowMs)
        windows.delete(key)
        w = { count: 0, resetAt: nowMs + opts.windowMs }
        windows.set(key, w)
      }
      if (w.count >= opts.limit) {
        return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((w.resetAt - nowMs) / 1000)) }
      }
      w.count += 1
      return { ok: true }
    },
    size: () => windows.size,
  }
}

/** The first x-forwarded-for value, trimmed; "unknown" when there is none. */
export function clientIp(headers: { get(name: string): string | null }): string {
  const first = headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return first ? first : 'unknown'
}

/** The limiter the route uses. Swap this for a shared store. */
export const acceptRateLimiter: RateLimiter = createMemoryRateLimiter({ limit: ACCEPT_LIMIT, windowMs: ACCEPT_WINDOW_MS })
