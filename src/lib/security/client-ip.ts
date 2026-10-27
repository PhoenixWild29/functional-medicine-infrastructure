// ============================================================
// The client IP (rate limits, keyed audit hashes)
// ============================================================
//
// Security review, Oct 24 (L8). Order of trust:
//   1. x-vercel-forwarded-for: set by Vercel's edge to the address it saw;
//      a client cannot set it (Vercel overwrites it), and it survives a
//      proxy placed in front of Vercel.
//   2. x-real-ip: also set by Vercel's edge.
//   3. The first x-forwarded-for hop: what a client or proxy says. Used
//      only when neither of the above is present (local dev, tests).
// Each is trimmed; an empty value falls through to the next. Null when
// there is none. The one place an IP header is read.

type HeaderSource = { get(name: string): string | null }

function firstHop(value: string | null | undefined): string | null {
  const first = value?.split(',')[0]?.trim()
  return first ? first : null
}

export function clientIp(headers: HeaderSource | null | undefined): string | null {
  if (!headers) return null
  return firstHop(headers.get('x-vercel-forwarded-for'))
    ?? firstHop(headers.get('x-real-ip'))
    ?? firstHop(headers.get('x-forwarded-for'))
}
