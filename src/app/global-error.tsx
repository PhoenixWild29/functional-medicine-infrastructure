'use client'

// Last-resort boundary: an error in the root layout itself. It replaces the
// whole document, so it brings its own <html>, <body> and stylesheet.
// Friendly copy only; the error is reported (useReportError), never shown.

import './globals.css'
import { ErrorScreen } from '@/components/errors/error-screen'
import { useReportError } from '@/components/errors/use-report-error'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useReportError(error, 'global')
  return (
    <html lang="en">
      {/* WCAG 2.1 A: a document title (e2e-axe-all-routes). */}
      <head>
        <title>Something went wrong | CompoundIQ</title>
      </head>
      <body className="font-sans">
        <ErrorScreen
          testId="error-screen-global"
          title="Something went wrong"
          message="CompoundIQ could not be loaded. Please try again. If it keeps happening, contact your clinic or CompoundIQ support."
          actions={[{ label: 'Try again', onClick: reset }, { label: 'Go to sign in', href: '/login' }]}
          reference={error.digest}
        />
      </body>
    </html>
  )
}
