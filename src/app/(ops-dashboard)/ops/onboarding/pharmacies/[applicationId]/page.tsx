// ============================================================
// /ops/onboarding/pharmacies/<applicationId>: review one pharmacy
// ============================================================

import Link from 'next/link'
import { PharmacyApplicationReview } from '../../_components/pharmacy/pharmacy-application-review'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Review pharmacy | Ops Dashboard',
}

export default async function OpsPharmacyApplicationPage({ params }: { params: Promise<{ applicationId: string }> }) {
  const { applicationId } = await params
  return (
    <main className="mx-auto max-w-5xl space-y-4 px-4 py-8">
      <Link href="/ops/onboarding/pharmacies" className="inline-flex min-h-[44px] items-center text-sm font-medium text-primary underline underline-offset-4">
        Back to pharmacy onboarding
      </Link>
      <PharmacyApplicationReview applicationId={applicationId} />
    </main>
  )
}
