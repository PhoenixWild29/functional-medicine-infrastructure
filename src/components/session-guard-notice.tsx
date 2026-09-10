// ============================================================
// SessionGuardNotice — shared inline auth fallback
// ============================================================
//
// 2026-09 prod silent-logout / console-hang sweep.
//
// Every page under (clinic-app) and (ops-dashboard) renders inside the
// Suspense boundary created by that route group's loading.tsx. By the time
// a page body has awaited its Supabase call, the shell has already been
// flushed, so a redirect() raised from there can no longer be turned into
// an HTTP redirect — the boundary is never resolved and the user sits on
// the spinner forever. See the full write-up in
// src/app/(ops-dashboard)/ops/__tests__/ops-page-no-inline-auth.test.ts.
//
// The real auth gates run in the two places that CAN redirect safely:
// src/middleware.ts, and the route-group layout (which sits OUTSIDE the
// boundary its sibling loading.tsx creates). A page body reaching this
// component means the session evaporated between the layout and the page,
// so it renders a terminal state instead of hanging.

import Link from 'next/link'

interface SessionGuardNoticeProps {
  title?: string
  message?: string
}

export function SessionGuardNotice({
  title = 'Session expired',
  message = 'Your session is no longer valid. Please sign in again.',
}: SessionGuardNoticeProps = {}) {
  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-xl font-semibold text-foreground">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      <Link
        href="/login"
        className="mt-6 inline-block rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
      >
        Sign in
      </Link>
    </main>
  )
}
