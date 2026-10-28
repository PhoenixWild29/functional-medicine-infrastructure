// ============================================================
// Pending review: the banner on every clinic page
// ============================================================
//
// A clinic ops has not approved yet can look around (Dashboard, New
// Prescription, Practice, Settings). Every write that matters is refused
// on the server (lib/onboarding/approval-guard) with these same words.
// Rendered by (clinic-app)/layout.tsx; links to the remaining setup steps
// (/onboarding: the admin's wizard, a progress page for everyone else).
// Once the clinic has submitted for review it says so, and links to what
// was submitted (the same /onboarding, read-only after submission).

import Link from 'next/link'
import { PENDING_REVIEW_MESSAGE } from '@/lib/onboarding/pending-review-copy'

export const SUBMITTED_MESSAGE = "Submitted. We're reviewing your clinic; ordering opens once you're approved."

export function PendingReviewBanner({ submitted = false }: { submitted?: boolean }) {
  return (
    <section
      aria-label="Account under review"
      className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
    >
      <p className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-1">
        <span>{submitted ? SUBMITTED_MESSAGE : PENDING_REVIEW_MESSAGE}</span>
        <Link
          href="/onboarding"
          className="font-semibold underline underline-offset-2 hover:text-amber-800 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        >
          {submitted ? 'View what you submitted' : 'See your remaining setup steps'}
        </Link>
      </p>
    </section>
  )
}
