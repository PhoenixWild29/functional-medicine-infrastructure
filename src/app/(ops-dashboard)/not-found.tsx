// Not found inside the ops dashboard (a page called notFound(), e.g. an
// unknown record). Unmatched URLs use src/app/not-found.tsx.

import { ErrorScreen } from '@/components/errors/error-screen'

export default function OpsDashboardNotFound() {
  return (
    <ErrorScreen
      testId="not-found-ops"
      title="Page not found"
      message="We could not find that page. It may have been moved, or the link may be incomplete."
      actions={[{ label: 'Back to ops dashboard', href: '/ops' }]}
    />
  )
}
