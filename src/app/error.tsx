'use client'

// Any page error outside the clinic, ops and checkout groups (which have
// their own boundaries) lands here, inside the root layout, so the page
// keeps lang="en" and the CompoundIQ title. Without it Next served its
// bare error document (no lang, no title: WCAG 2.1 A).

import { useEffect } from 'react'

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">The page could not be loaded. Try again in a moment.</p>
      <button
        type="button"
        onClick={reset}
        className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
      >
        Try again
      </button>
    </main>
  )
}
