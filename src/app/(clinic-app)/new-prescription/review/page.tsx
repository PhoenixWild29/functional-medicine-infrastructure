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
import { SessionBanner }  from '../_components/session-banner'
import { BatchReviewForm } from './_components/batch-review-form'

const WIZARD_STEPS = [
  { number: 1, label: 'Patient & Provider', href: '/new-prescription' },
  { number: 2, label: 'Add Prescriptions',  href: '/new-prescription/search' },
  { number: 3, label: 'Review & Send' },
]

export const metadata = {
  title: 'New Prescription — Review & Send',
}

export default function ReviewPage() {
  return (
    <>
      <HipaaTimeout />
      <main className="mx-auto max-w-2xl px-4 py-8">
        {/* Session banner — patient + provider pinned at top */}
        <SessionBanner />

        <div className="mb-6">
          <WizardProgress steps={WIZARD_STEPS} currentStep={3} />
          <h1 className="mt-4 text-2xl font-bold text-foreground">Review & Send</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review all prescriptions, sign once, and send the payment link.
          </p>
        </div>

        <BatchReviewForm />
      </main>
    </>
  )
}
