// Not found inside the pharmacy portal (a page called notFound(), e.g. an
// unknown record). Unmatched URLs use src/app/not-found.tsx.

import { ErrorScreen } from '@/components/errors/error-screen'

export default function PharmacyPortalNotFound() {
  return (
    <ErrorScreen
      testId="not-found-pharmacy"
      title="Page not found"
      message="We could not find that page. It may have been moved, or the link may be incomplete."
      actions={[{ label: 'Back to pharmacy portal', href: '/pharmacy' }]}
    />
  )
}
