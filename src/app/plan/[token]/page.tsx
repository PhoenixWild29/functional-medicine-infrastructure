// ============================================================
// /plan/[token]: the patient chooses their treatment plan
// ============================================================
//
// Patient protocol choice PR 3. Public: middleware lets /plan through
// without a session (no-store). The token is checked here against its
// stored SHA-256. An open link renders the flow with the clinic logo only:
// before the date of birth check the page says "Your provider has a plan
// ready" and nothing else, so a forwarded link shows no PHI. The metadata
// is generic: no clinic name (a name can reveal a specialty).

import type { Metadata } from 'next'
import { createServiceClient } from '@/lib/supabase/service'
import { resolvePlan } from '@/lib/proposals/plan'
import { PlanFlow } from './_components/plan-flow'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Your treatment plan',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

// An unknown, expired, locked, signed or closed link shows one neutral
// page, word for word the same, so the page never says whether a link
// existed or what became of it. A database error is the only other page:
// it says nothing about the link.
const NOT_ACTIVE = {
  title: 'This link is no longer active',
  body: 'Plan links stop working after 7 days, once your plan is settled, or after too many incorrect dates of birth. Please contact your clinic if you need a new link or have questions.',
}
const UNAVAILABLE = {
  title: 'This page could not be opened right now',
  body: 'Please try again in a few minutes.',
}

export default async function PlanPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const plan = await resolvePlan(createServiceClient(), token, new Date())

  if (plan.state === 'open') {
    return <PlanFlow token={token} logoUrl={plan.logoUrl} />
  }

  const copy = plan.state === 'unavailable' ? UNAVAILABLE : NOT_ACTIVE
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-12 text-center">
      <h1 className="text-2xl font-semibold text-foreground">{copy.title}</h1>
      <p className="mt-3 text-base text-muted-foreground">{copy.body}</p>
    </main>
  )
}
