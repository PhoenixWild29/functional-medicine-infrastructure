'use client'

// Error boundary for every page no closer boundary covers: sign-in, MFA,
// sign-up, onboarding invites, legal pages. Friendly copy only: the error itself is reported
// (useReportError), never shown. See src/components/errors/error-screen.tsx.

import { ErrorScreen } from '@/components/errors/error-screen'
import { useReportError } from '@/components/errors/use-report-error'

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useReportError(error, 'app')
  return (
    <ErrorScreen
      testId="error-screen-public"
      title="Something went wrong"
      message="This page could not be shown. Please try again, or start again from the sign-in page."
      actions={[{ label: 'Try again', onClick: reset }, { label: 'Go to sign in', href: '/login' }]}
      reference={error.digest}
    />
  )
}
