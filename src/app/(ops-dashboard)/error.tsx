'use client'

// Error boundary for the ops dashboard. Friendly copy only: the error itself is reported
// (useReportError), never shown. See src/components/errors/error-screen.tsx.

import { ErrorScreen } from '@/components/errors/error-screen'
import { useReportError } from '@/components/errors/use-report-error'

export default function OpsDashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useReportError(error, 'ops-dashboard')
  return (
    <ErrorScreen
      testId="error-screen-ops"
      title="Something went wrong"
      message="This page could not be shown. Try again, or go back to the ops dashboard."
      actions={[{ label: 'Try again', onClick: reset }, { label: 'Back to ops dashboard', href: '/ops' }]}
      reference={error.digest}
    />
  )
}
