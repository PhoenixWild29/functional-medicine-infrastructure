// ============================================================
// Per-tab app state that must not outlive a sign-in
// ============================================================
//
// The prescription builder keeps the session (patient, provider, lines)
// in sessionStorage so a reload does not lose work. sessionStorage belongs
// to the browser tab, not to the login: on Nov 5, 2026 a line priced by
// one clinic (a self sign-up) was still in the tab after its user signed
// out and a Sunrise medical assistant signed in, and it appeared on her
// Review page. Clear it whenever a login ends (sign-out, idle logoff) and
// whenever the sign-in page opens (a session that expired on the server
// never ran the sign-out code).

export const RX_SESSION_STORAGE_KEY = 'compoundiq-rx-session'

export function clearSignedInTabState(): void {
  try {
    sessionStorage.removeItem(RX_SESSION_STORAGE_KEY)
  } catch {
    // No storage (private mode, server): nothing to clear.
  }
}
