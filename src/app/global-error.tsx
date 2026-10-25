'use client'

// The root layout itself failed: this replaces the whole document, so it
// brings its own <html lang="en"> and <title> (WCAG 2.1 A: html-has-lang,
// document-title). Page errors are caught by src/app/error.tsx instead.

import { useEffect } from 'react'
import './globals.css'

export default function GlobalError({
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
    <html lang="en">
      <head>
        <title>Something went wrong | CompoundIQ</title>
      </head>
      <body className="font-sans">
        <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">CompoundIQ could not be loaded. Try again in a moment.</p>
          <button
            type="button"
            onClick={reset}
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  )
}
