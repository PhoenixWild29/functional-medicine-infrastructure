// ============================================================
// Pending review: the banner on every clinic page
// ============================================================
//
// A clinic ops has not approved yet can look around (Dashboard, New
// Prescription, Practice, Settings). Every write that matters is refused
// on the server (lib/onboarding/approval-guard) with these same words.
// Rendered by (clinic-app)/layout.tsx; links to the remaining setup steps
// (/onboarding: the admin's wizard, a progress page for everyone else).

import Link from 'next/link'
import { PENDING_REVIEW_MESSAGE } from '@/lib/onboarding/pending-review-copy'

export function PendingReviewBanner() {
  return (
    <section
      aria-label="Account under review"
      className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
    >
      <p className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-1">
        <span>{PENDING_REVIEW_MESSAGE}</span>
        <Link
          href="/onboarding"
          className="font-semibold underline underline-offset-2 hover:text-amber-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          See your remaining setup steps
        </Link>
      </p>
    </section>
  )
}
