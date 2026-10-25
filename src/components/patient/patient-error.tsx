'use client'

// ============================================================
// The error page a patient sees (checkout, plan, intake, join)
// ============================================================
//
// Patients open these links on phones. Before this, the patient routes
// had no error boundary of their own and showed Next's bare default page.
// One column, 16px text, a 48px "Try again" button. Nothing about the
// error is shown to the patient; it is logged for the console only.

import { useEffect } from 'react'

export function PatientError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-12 text-center">
      <h1 className="text-2xl font-semibold text-foreground">Something went wrong</h1>
      <p className="mt-3 text-base text-muted-foreground">Please refresh the page or contact your clinic.</p>
      <button
        type="button"
        onClick={reset}
        className="mt-6 min-h-[48px] w-full rounded-lg bg-primary px-4 py-3 text-base font-semibold text-primary-foreground hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        Try again
      </button>
    </main>
  )
}
