'use client'

// Error boundary for the pharmacy portal. Friendly copy only: the error itself is reported
// (useReportError), never shown. See src/components/errors/error-screen.tsx.

import { ErrorScreen } from '@/components/errors/error-screen'
import { useReportError } from '@/components/errors/use-report-error'

export default function PharmacyPortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useReportError(error, 'pharmacy')
  return (
    <ErrorScreen
      testId="error-screen-pharmacy"
      title="Something went wrong"
      message="This page could not be shown. Try again, or go back to the pharmacy portal."
      actions={[{ label: 'Try again', onClick: reset }, { label: 'Back to pharmacy portal', href: '/pharmacy' }]}
      reference={error.digest}
    />
  )
}
