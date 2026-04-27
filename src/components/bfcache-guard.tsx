'use client'

// ============================================================
// BfcacheGuard — PR R7-Bucket-1
// ============================================================
//
// Closes a CRITICAL bfcache leak: pressing browser Back after
// sign-out restores the prior authenticated page (with PHI)
// from the browser's back-forward cache without re-running
// middleware. `Cache-Control: no-store` covers Safari + Firefox
// reliably; Chrome's bfcache is more aggressive and sometimes
// ignores no-store, so we listen for `pageshow` with
// `event.persisted === true` and force a reload, which re-runs
// middleware → redirects to /login when the cookie is gone.
//
// iOS Safari quirk acknowledged: Safari fires pageshow with
// persisted=true on tab restoration after backgrounding (e.g.,
// user switches to Slack and back), causing brief reloads. The
// reload is fast when the session is still valid, and bouncing
// to /login when expired is the correct outcome anyway. Engineering
// around this would require Page Lifecycle freeze/resume tracking
// with worse browser support — accepted trade-off for HIPAA opt-out.

import { useEffect } from 'react'

export function BfcacheGuard() {
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      // WO-91 polish: navigate directly to bare /login on bfcache restore
      // (was: window.location.reload() which reloaded the prior authenticated
      // URL, hit middleware, redirected to /login?redirectTo=<that-route>).
      // The redirect-via-middleware dance produced a stale ?redirectTo=
      // query string that pointed at the last-served authenticated route
      // rather than the back-target. Cleaner UX: skip the dance, land
      // directly on bare /login. Security guarantee unchanged: the
      // bfcache-restored page is replaced before any user interaction.
      if (e.persisted) window.location.replace('/login')
    }
    window.addEventListener('pageshow', onPageShow)
    return () => window.removeEventListener('pageshow', onPageShow)
  }, [])
  return null
}
