// ============================================================
// /pharmacy/agreements/<acceptanceId>: the exact text that was accepted
// ============================================================
//
// Read-only. The acceptance must be this pharmacy's (its claim, not the
// URL). The text is the version recorded with the acceptance, found by its
// recorded SHA-256 (an older version's text included), never simply the
// current one.

import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getUserPharmacyId } from '@/lib/auth/claims'
import { acceptedAgreementText } from '@/lib/pharmacy-onboarding/agreements-history'
import { LegalMarkdown } from '@/components/onboarding/legal-markdown'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Accepted agreement | CompoundIQ' }

export default async function AcceptedAgreementPage({ params }: { params: Promise<{ acceptanceId: string }> }) {
  const { acceptanceId } = await params
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const pharmacyId = getUserPharmacyId(user)
  if (!pharmacyId) notFound()
  const r = await acceptedAgreementText(createServiceClient(), pharmacyId, acceptanceId)
  if (!r.ok && r.status === 404) notFound()

  return (
    <main id="main-content" className="mx-auto max-w-4xl px-4 py-6 sm:py-8">
      <Link href="/pharmacy/agreements" className="inline-flex min-h-[44px] items-center text-sm font-medium text-primary underline underline-offset-4 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">Back to agreements</Link>
      {r.ok ? (
        <>
          <h1 className="mt-2 wrap-break-word text-2xl font-bold text-foreground">{r.acceptance.title}, version {r.acceptance.version}</h1>
          <p className="mt-1 wrap-break-word text-sm text-muted-foreground">
            Accepted by {r.acceptance.signerName} ({r.acceptance.signerTitle}) on <time dateTime={r.acceptance.acceptedAt}>{new Date(r.acceptance.acceptedAt).toLocaleString('en-US')}</time>.
          </p>
          {r.acceptance.text ? (
            <section aria-label={`${r.acceptance.title} text`} className="mt-6 space-y-3 wrap-break-word rounded-md border border-border bg-muted/30 p-4 text-sm leading-relaxed text-foreground">
              <LegalMarkdown text={r.acceptance.text} headingLevel={3} />
            </section>
          ) : (
            <p role="status" className="mt-6 text-sm text-foreground">The text of this version is not on file here. Contact CompoundIQ for a copy.</p>
          )}
        </>
      ) : (
        <div role="alert" className="mt-4 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-red-700 dark:text-red-300">{r.error}</div>
      )}
    </main>
  )
}
