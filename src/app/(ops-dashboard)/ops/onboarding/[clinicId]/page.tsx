// ============================================================
// Clinic onboarding review — /ops/onboarding/[clinicId]
// ============================================================
//
// Everything ops reads before approving one clinic (lib/onboarding/
// review). Approve and send back stay on /ops/onboarding.
//
// Auth: ops_admin only, enforced OUTSIDE this component (src/proxy.ts
// and (ops-dashboard)/layout.tsx), as on every ops page; GET
// /api/ops/onboarding/clinics/[clinicId] checks ops_admin again. No
// Supabase auth client here.

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'
import { loadClinicReview, type ClinicReview } from '@/lib/onboarding/review'
import { ClinicReviewDetails } from './_components/clinic-review-details'
import { DeleteSignupPanel } from './_components/delete-signup-panel'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Clinic review | Ops Dashboard',
}

const STATUS_LABEL: Record<string, string> = {
  invited:           'Invited',
  in_progress:       'In progress',
  submitted:         'Submitted for review',
  changes_requested: 'Sent back',
  approved:          'Approved',
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const date = (iso: string) => new Date(iso).toLocaleDateString('en-US', { dateStyle: 'medium', timeZone: 'UTC' })

export default async function ClinicReviewPage({ params }: { params: Promise<{ clinicId: string }> }) {
  const { clinicId } = await params
  if (!UUID_RE.test(clinicId)) notFound()

  let review: ClinicReview | null = null
  let failed = false
  try {
    review = await loadClinicReview(createServiceClient(), clinicId)
  } catch (err) {
    failed = true
    console.error(`[ops/onboarding] review could not be loaded | clinic=${clinicId}:`, err instanceof Error ? err.message : err)
  }
  if (!failed && !review) notFound()

  const c = review?.clinic
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 space-y-6">
      <Link href="/ops/onboarding" className="text-sm text-blue-700 underline underline-offset-2 hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-200 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
        <span aria-hidden="true">← </span>Back to clinic onboarding
      </Link>
      {review && c ? (
        <>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Review: {c.name}</h1>
            <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">
              {STATUS_LABEL[c.onboardingStatus] ?? c.onboardingStatus}
              {c.submittedAt ? ` · submitted ${date(c.submittedAt)}` : ''}
              {c.reviewedAt && c.reviewedBy ? ` · last reviewed ${date(c.reviewedAt)} by ${c.reviewedBy}` : ''}
            </p>
            {c.onboardingStatus === 'changes_requested' && c.reviewNote && (
              <p className="mt-2 text-sm text-foreground">Last note to the clinic: {c.reviewNote}</p>
            )}
          </div>
          <ClinicReviewDetails review={review} />
          {/* Security review M2/M3: a squatted sign-up can be removed until approved. */}
          {c.signupSource === 'self_serve' && c.onboardingStatus !== 'approved' && (
            <DeleteSignupPanel clinicId={c.clinicId} clinicName={c.name} />
          )}
        </>
      ) : (
        <>
          <h1 className="text-2xl font-bold text-foreground">Clinic review</h1>
          <div role="alert" className="rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-3 text-sm text-red-700 dark:text-red-300">
            The clinic review could not be loaded. Refresh to try again.
          </div>
        </>
      )}
    </div>
  )
}
