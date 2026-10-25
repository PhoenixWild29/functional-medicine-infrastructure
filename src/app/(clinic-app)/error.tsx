'use client'

// Error boundary for the clinic app (staff). Friendly copy only: the error itself is reported
// (useReportError), never shown. See src/components/errors/error-screen.tsx.

import { ErrorScreen } from '@/components/errors/error-screen'
import { useReportError } from '@/components/errors/use-report-error'

export default function ClinicAppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useReportError(error, 'clinic-app')
  return (
    <ErrorScreen
      testId="error-screen-clinic"
      title="Something went wrong"
      message="This page could not be shown. Try again, or go back to your dashboard."
      actions={[{ label: 'Try again', onClick: reset }, { label: 'Back to dashboard', href: '/dashboard' }]}
      reference={error.digest}
    />
  )
}
