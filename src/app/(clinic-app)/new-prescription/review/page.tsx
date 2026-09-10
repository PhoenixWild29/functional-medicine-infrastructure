// ============================================================
// New Prescription — Step 3: Batch Review & Send — WO-29 + WO-80
// /new-prescription/review
// ============================================================
//
// WO-80 redesign: This page now reads ALL prescriptions from the
// PrescriptionSession context instead of URL parameters. The
// provider signs once and all orders are submitted as a batch.
//
// The old URL-parameter-based flow (pharmacyId, itemId, retailCents,
// sigText) is no longer used — all data comes from the session context.

import { WizardProgress } from '@/components/wizard-progress'
import { HipaaTimeout }   from '@/components/hipaa-timeout'
import { createServerClient } from '@/lib/supabase/server'
import { SessionBanner }  from '../_components/session-banner'
import { ProtocolLoadNotices } from './_components/protocol-load-notices'
import { BatchReviewForm } from './_components/batch-review-form'

const WIZARD_STEPS = [
  { number: 1, label: 'Patient & Provider', href: '/new-prescription' },
  { number: 2, label: 'Add Prescriptions',  href: '/new-prescription/search' },
  { number: 3, label: 'Review & Send' },
]

export const metadata = {
  title: 'New Prescription — Review & Send',
}

export default async function ReviewPage() {
  // ── Cosmetic sign-gating (UX only) ───────────────────────
  // Only the assigned provider can sign & send — the server enforces
  // this in /api/orders/[orderId]/sign-and-send, which returns 403 for
  // any non-provider signer (that 403 is the real, unchanged gate).
  // Read app_role server-side and pass a boolean so a medical_assistant /
  // clinic_admin never sees a Sign & Send button that would only 403 on
  // submit. Non-providers get the existing "Save as Draft — Provider
  // Signs Later" action instead.
  //
  // 2026-09 sweep: getUser(), never getSession(). src/middleware.ts has
  // already refreshed the token pair for this request and forwarded the
  // rotated cookies onto it, so this read validates a current token and
  // cannot start a rotation a Server Component is unable to persist.
  //
  // No redirect() here either. This page body streams inside the Suspense
  // boundary created by (clinic-app)/loading.tsx, so a redirect raised
  // after the shell has flushed would leave the boundary unresolved and
  // the route spinning forever. Auth is already enforced by middleware
  // and (clinic-app)/layout.tsx before this runs — and the fallback here
  // fails CLOSED: no verified user means isProvider is false, so the
  // Sign & Send action is not offered.
  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()

  const appRole = typeof user?.user_metadata['app_role'] === 'string'
    ? (user.user_metadata['app_role'] as string)
    : undefined
  const isProvider = appRole === 'provider'

  return (
    <>
      <HipaaTimeout />
      <main className="mx-auto max-w-2xl px-4 py-8">
        {/* Session banner — patient + provider pinned at top */}
        <SessionBanner />

        <div className="mb-6">
          <WizardProgress steps={WIZARD_STEPS} currentStep={3} />
          <h1 className="mt-4 text-2xl font-bold text-foreground">Review &amp; Send</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review all prescriptions, sign once, and send the payment link.
          </p>
        </div>

        {/* Non-blocking partial-load report carried over from a protocol
            quick-load (e.g. items skipped by the state-licensure guard). */}
        <ProtocolLoadNotices />

        <BatchReviewForm isProvider={isProvider} />
      </main>
    </>
  )
}
