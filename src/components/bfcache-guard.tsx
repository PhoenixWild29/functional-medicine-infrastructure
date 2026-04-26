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
      if (e.persisted) window.location.reload()
    }
    window.addEventListener('pageshow', onPageShow)
    return () => window.removeEventListener('pageshow', onPageShow)
  }, [])
  return null
}
