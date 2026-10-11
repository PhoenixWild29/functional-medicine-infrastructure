// ============================================================
// Landing route — where a signed-in user goes by default
// ============================================================
//
// One source of truth for the post-login redirect (/login) and the root
// "/" redirect. The clinic admin lands on the Practice dashboard; providers
// and medical assistants on /dashboard; ops on the pipeline. The sidebar
// "Dashboard" link is untouched and still opens /dashboard for everyone.

export function defaultLandingRoute(appRole: string | undefined): string {
  if (appRole === 'ops_admin')    return '/ops/pipeline'
  if (appRole === 'clinic_admin') return '/practice'
  if (appRole === 'pharmacy_admin') return '/pharmacy/onboarding'
  return '/dashboard'
}

// An in-app path only. Rejects absolute URLs, protocol-relative URLs
// (//evil.com) and the backslash form (/\evil.com) that some browsers
// normalise to protocol-relative. A bare "/" is not a destination: it is
// the root redirect, so the role default applies.
function safeReturnTo(target: string | null | undefined): string | null {
  if (!target || !target.startsWith('/')) return null
  if (target.startsWith('//') || target.startsWith('/\\')) return null
  if (target === '/') return null
  return target
}

/** A safe ?redirectTo / ?next target wins; otherwise the role default. */
export function postLoginDestination(
  appRole: string | undefined,
  returnTo: string | null | undefined,
): string {
  return safeReturnTo(returnTo) ?? defaultLandingRoute(appRole)
}
