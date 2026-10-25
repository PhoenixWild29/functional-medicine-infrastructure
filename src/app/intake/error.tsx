'use client'

// Error boundary for patient pages (opened from a link the clinic sent).
// No reference, ids or clinical detail: the only way out is to try again
// or contact the clinic. Friendly copy only: the error itself is reported
// (useReportError), never shown. See src/components/errors/error-screen.tsx.

import { ErrorScreen } from '@/components/errors/error-screen'
import { useReportError } from '@/components/errors/use-report-error'

export default function IntakeError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useReportError(error, 'intake')
  return (
    <ErrorScreen
      testId="error-screen-patient"
      title="Something went wrong"
      message="This page could not be opened. Please try again. If it keeps happening, contact your clinic."
      actions={[{ label: 'Try again', onClick: reset }]}
    />
  )
}
