// ============================================================
// A full page navigation, for when the session's state changed
// ============================================================
//
// After the session changes in the page (sign-in, sign-up, an accepted
// invite, two-step sign-in raising it to AAL2), the user continues with a
// full page load rather than a client-router navigation. Since Next 16.3
// the client router reuses the redirect it already saw for a route: a
// destination that was redirected earlier in this tab (to /login while
// signed out, or to /mfa/enroll or /mfa/challenge at AAL1) is not asked
// for again, so router.push/replace(destination) stays where it is, and
// router.refresh() does not clear it. A full navigation always reaches the
// middleware with the new session, and drops any client state built
// before it.
//
// `path` must already be a safe, same-origin path (postLoginDestination,
// or sameOriginPath for a destination the server sent back). In its own
// module so tests can replace it.

export function navigateFully(path: string): void {
  window.location.replace(path)
}

/**
 * A destination the server sent back, followed only when it is an in-app
 * path; otherwise `fallback`. Rejects absolute, protocol-relative (//x)
 * and backslash (/\x) forms, like postLoginDestination, but keeps '/'
 * (the root redirects by role on a full load).
 */
export function sameOriginPath(path: unknown, fallback = '/'): string {
  if (typeof path !== 'string' || !path.startsWith('/')) return fallback
  if (path.startsWith('//') || path.startsWith('/\\')) return fallback
  return path
}
