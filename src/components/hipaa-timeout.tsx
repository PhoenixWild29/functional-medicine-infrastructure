'use client'

// ============================================================
// HIPAA Session Timeout — WO-29
// ============================================================
//
// REQ-OAS-011: HIPAA 30-minute inactivity timeout.
//   - Tracks mouse, keyboard, and touch activity.
//   - At 28 minutes of inactivity: shows a 2-minute warning modal.
//   - At 30 minutes of inactivity: signs out and redirects to /login.
//
// Mount this component in any page that handles PHI (e.g., the
// new-prescription wizard). It renders null during normal activity
// and only surfaces UI when the warning or timeout fires.

import { useState, useEffect, useRef, useCallback } from 'react'
import { createBrowserClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

const WARNING_MS  = 28 * 60 * 1000  // 28 minutes — show warning
const TIMEOUT_MS  = 30 * 60 * 1000  // 30 minutes — force sign-out

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'] as const

export function HipaaTimeout() {
  const router  = useRouter()
  const supabase = createBrowserClient()

  const [showWarning, setShowWarning] = useState(false)
  const [countdown,   setCountdown]   = useState(120) // seconds remaining

  const warningTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const timeoutTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const countdownRef     = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastActivityRef  = useRef<number>(Date.now())
  // BLK-07: ref mirrors showWarning so onActivity closure reads current value
  // without needing to be recreated (useEffect has [] dep array by design).
  const showWarningRef   = useRef(false)

  // ── Sign out and redirect ─────────────────────────────────────
  const forceSignOut = useCallback(async () => {
    setShowWarning(false)
    await supabase.auth.signOut()
    router.push('/login?reason=session_timeout')
  }, [supabase, router])

  // ── Reset all timers ──────────────────────────────────────────
  const resetTimers = useCallback(() => {
    if (warningTimerRef.current)  clearTimeout(warningTimerRef.current)
    if (timeoutTimerRef.current)  clearTimeout(timeoutTimerRef.current)
    if (countdownRef.current)     clearInterval(countdownRef.current)

    setShowWarning(false)
    showWarningRef.current = false  // BLK-07: sync ref when resetting
    setCountdown(120)
    lastActivityRef.current = Date.now()

    warningTimerRef.current = setTimeout(() => {
      setShowWarning(true)
      showWarningRef.current = true   // BLK-07: keep ref in sync
      setCountdown(120)

      // Countdown ticker — updates every second
      countdownRef.current = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            if (countdownRef.current) clearInterval(countdownRef.current)
            return 0
          }
          return prev - 1
        })
      }, 1000)
    }, WARNING_MS)

    timeoutTimerRef.current = setTimeout(() => {
      void forceSignOut()
    }, TIMEOUT_MS)
  }, [forceSignOut])

  // ── Activity listener ─────────────────────────────────────────
  useEffect(() => {
    resetTimers()

    function onActivity() {
      // BLK-07: read from ref — the closure captures the initial value of
      // showWarning (false), but showWarningRef is updated when the warning fires.
      // Activity must NOT reset timers once the warning modal is showing.
      if (!showWarningRef.current) {
        resetTimers()
      }
    }

    ACTIVITY_EVENTS.forEach(evt =>
      window.addEventListener(evt, onActivity, { passive: true })
    )

    return () => {
      ACTIVITY_EVENTS.forEach(evt =>
        window.removeEventListener(evt, onActivity)
      )
      if (warningTimerRef.current)  clearTimeout(warningTimerRef.current)
      if (timeoutTimerRef.current)  clearTimeout(timeoutTimerRef.current)
      if (countdownRef.current)     clearInterval(countdownRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])  // intentionally run once on mount

  // ── Stay active handler ───────────────────────────────────────
  function handleStayActive() {
    resetTimers()
  }

  // Always render a hidden sentinel so E2E can verify the component is
  // mounted and its timers are active, without relying on a fake clock.
  // Real timer semantics are covered by the unit test at
  // src/components/__tests__/hipaa-timeout.test.tsx — E2E only asserts mount.
  if (!showWarning) {
    return <span data-testid="hipaa-timeout-root" hidden />
  }

  return (
    <div
      data-testid="hipaa-timeout-root"
      role="dialog"
      aria-modal="true"
      aria-labelledby="hipaa-timeout-title"
      aria-describedby="hipaa-timeout-desc"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
    >
      <div className="w-full max-w-sm rounded-lg bg-card border border-border p-6 shadow-xl space-y-4">
        <h2 id="hipaa-timeout-title" className="text-lg font-semibold text-foreground">
          Session Expiring Soon
        </h2>
        <p id="hipaa-timeout-desc" className="text-sm text-muted-foreground">
          For HIPAA compliance, your session will end due to inactivity in{' '}
          <strong className="text-foreground">{countdown} second{countdown !== 1 ? 's' : ''}</strong>.
          Any unsaved work may be lost.
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleStayActive}
            className="flex-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Stay Logged In
          </button>
          <button
            type="button"
            onClick={() => void forceSignOut()}
            className="flex-1 rounded-md border border-input px-4 py-2 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Sign Out
          </button>
        </div>
      </div>
    </div>
  )
}
