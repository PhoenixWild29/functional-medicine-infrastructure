// ============================================================
// redirectToLogin — PR R7-Bucket-1
// ============================================================
//
// Tiny wrapper around `window.location.replace('/login')` so the
// four sign-out call sites are testable in jsdom (which makes
// `window.location.replace` non-configurable and blocks every
// obvious mocking pattern). Mock this module in tests instead.
//
// Hard navigation (not router.push) is intentional: it flushes the
// prior PHI-bearing page from the JS heap and removes it from
// browser history, which — combined with the BfcacheGuard pageshow
// listener and middleware no-store headers — closes the bfcache
// PHI restoration vector caught in the round-7 walkthrough.
//
// `replace` (not `assign`) so Back-after-sign-out doesn't return to
// the authenticated page — Back from /login skips straight to the
// page before sign-in.
//
// Future: collapse the four sign-out call sites into a single
// Server Action (cowork's deferred recommendation) — when that
// lands this wrapper goes away.

export function redirectToLogin(reason?: string): void {
  const url = reason ? `/login?reason=${reason}` : '/login'
  window.location.replace(url)
}
