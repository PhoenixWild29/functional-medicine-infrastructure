// Not found inside the clinic app (a page called notFound(), e.g. an
// unknown record). Unmatched URLs use src/app/not-found.tsx.

import { ErrorScreen } from '@/components/errors/error-screen'

export default function ClinicAppNotFound() {
  return (
    <ErrorScreen
      testId="not-found-clinic"
      title="Page not found"
      message="We could not find that page. It may have been moved, or the link may be incomplete."
      actions={[{ label: 'Back to dashboard', href: '/dashboard' }]}
    />
  )
}
