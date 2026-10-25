// ============================================================
// Token pages: links whose credential is in the URL
// ============================================================
//
// Patient checkout (/checkout/<jwt>, or ?token=), the plan link
// (/plan/<token>), the intake link (/intake/<token>), a clinic's sign-up
// link (/join/<token>), and the onboarding invites (/onboard/...), with
// their APIs. Every response on these paths is sent with:
//
//   - Referrer-Policy: no-referrer: the token URL never leaves as a
//     Referer, to another site or to this one;
//   - X-Robots-Tag: noindex, nofollow: never indexed (the pages also carry
//     the robots meta from the root layout; this covers API JSON and
//     redirects too);
//   - Cache-Control: private, no-store (set by the middleware).
//
// next.config.ts sets the first two (after the global rule, so they win),
// the middleware sets all three on every response it builds, and
// src/app/robots.ts disallows the paths. Edge-safe (no Node imports).

export const TOKEN_HEADERS: ReadonlyArray<{ key: string; value: string }> = [
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Robots-Tag',    value: 'noindex, nofollow' },
]

/** Pages and APIs matched as a path or anything under it. */
const EXACT_OR_UNDER = ['/checkout', '/intake']
/** Matched only with the trailing slash: '/plans', '/joined' and '/onboarding' are other pages. */
const UNDER = ['/plan/', '/join/', '/onboard/', '/api/checkout/', '/api/plan/', '/api/intake/', '/api/join/', '/api/onboard/', '/api/onboarding/invite/']

export function isTokenPath(pathname: string): boolean {
  return EXACT_OR_UNDER.some(p => pathname === p || pathname.startsWith(`${p}/`)) || UNDER.some(p => pathname.startsWith(p))
}

/** next.config.ts header sources for the same paths. */
export const TOKEN_HEADER_SOURCES: ReadonlyArray<string> = [
  ...EXACT_OR_UNDER.flatMap(p => [p, `${p}/:path*`]),
  ...UNDER.map(p => `${p}:path*`),
]

/** robots.txt: the same paths, and the whole API. */
export const ROBOTS_DISALLOW: ReadonlyArray<string> = ['/checkout', '/intake', '/plan/', '/join/', '/onboard/', '/api/']
