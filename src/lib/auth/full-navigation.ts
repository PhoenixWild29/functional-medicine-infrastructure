// ============================================================
// A full page navigation, for when the session's access level changed
// ============================================================
//
// After two-step sign-in raises the session to AAL2, the user continues
// with a full page load rather than a client-router navigation. Since Next
// 16.3 the client router reuses the redirect it already saw for a route:
// the destination redirected to /mfa/enroll or /mfa/challenge at AAL1, so
// router.replace(destination) never asks the server again and stays on
// the MFA page, and router.refresh() does not clear it. A full navigation
// always reaches the middleware with the new session, and drops any
// client state built at the lower access level.
//
// `path` must already be a safe, same-origin path (the MFA pages resolve
// it with postLoginDestination). In its own module so tests can replace it.

export function navigateFully(path: string): void {
  window.location.replace(path)
}
