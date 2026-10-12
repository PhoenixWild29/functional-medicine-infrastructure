// ============================================================
// /pharmacy/agreements/review/<key>: review and accept the current version
// ============================================================
//
// key is 'baa' or 'pharmacy_terms'. Shows the current text (LegalMarkdown)
// and the same accept form as the wizard; the acceptance is
// recorded by POST /api/pharmacy/onboarding/agreement with that key. An
// approved pharmacy can accept a new version here: nothing else changes.

import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getUserPharmacyId } from '@/lib/auth/claims'
import { isPharmacyAgreementKey, pharmacyAgreement } from '@/lib/pharmacy-onboarding/agreement'
import { latestAcceptance } from '@/lib/pharmacy-onboarding/agreements-history'
import { agreementView } from '@/lib/pharmacy-onboarding/application'
import { ReviewAndAccept } from './review-and-accept'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Review agreement | CompoundIQ' }

export default async function ReviewAgreementPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params
  if (!isPharmacyAgreementKey(key)) notFound()
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const pharmacyId = getUserPharmacyId(user)
  if (!pharmacyId) notFound()
  const current = await latestAcceptance(createServiceClient(), pharmacyId, key, pharmacyAgreement(key).version)
  const view = agreementView(key, current.ok ? current.row : null)

  return (
    <main id="main-content" className="mx-auto max-w-4xl px-4 py-6 sm:py-8">
      <Link href="/pharmacy/agreements" className="inline-flex min-h-[44px] items-center text-sm font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Back to agreements</Link>
      <h1 className="mt-2 break-words text-2xl font-bold text-foreground">{view.title}, version {view.version}</h1>
      <div className="mt-6">
        {current.ok ? (
          <ReviewAndAccept agreementKey={key} view={view} />
        ) : (
          <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-red-700 dark:text-red-300">Your agreements could not be read. Reload to try again.</div>
        )}
      </div>
    </main>
  )
}
