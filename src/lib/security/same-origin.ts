// ============================================================
// Same-origin rule for writes (CSRF)
// ============================================================
//
// Browsers send Sec-Fetch-Site on every request. A write from this app's
// own pages says "same-origin"; a typed URL or bookmark says "none"; curl,
// cron and server-to-server calls send nothing. All of those pass.
// "same-site" (a sibling subdomain) and "cross-site" are refused. SameSite=
// Lax session cookies already stop cross-site form posts; this is the
// explicit check on top (security review, Oct 24).

import { NextResponse } from 'next/server'

type HeaderSource = { get(name: string): string | null }

/**
 * True when Sec-Fetch-Site is present and is neither same-origin nor none.
 * No headers at all (an internal caller) counts as non-browser: it passes.
 */
export function isCrossSiteWrite(headers: HeaderSource | null | undefined): boolean {
  const site = headers?.get?.('sec-fetch-site')?.trim().toLowerCase()
  return !!site && site !== 'same-origin' && site !== 'none'
}

/**
 * A 403 for a cross-site write, or null to go on. `error` keeps the
 * wording the route already used.
 */
export function refuseCrossSite(
  request: { headers?: HeaderSource | null },
  error = 'Cross-site requests are not permitted',
  headers?: Record<string, string>,
): NextResponse | null {
  return isCrossSiteWrite(request.headers) ? NextResponse.json({ error }, { status: 403, ...(headers ? { headers } : {}) }) : null
}
