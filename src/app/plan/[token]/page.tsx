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
}

const CLOSED: Record<'not_found' | 'expired' | 'locked' | 'signed' | 'closed' | 'unavailable', { title: string; body: string }> = {
  not_found: {
    title: 'This link is not valid',
    body: 'Please check that you opened the whole link from your clinic, or ask them to send it again.',
  },
  expired: {
    title: 'This link has expired',
    body: 'For your security, plan links work for 7 days. Please contact your clinic and ask them to send it again.',
  },
  locked: {
    title: 'This link is locked',
    body: 'Too many incorrect dates of birth were entered. Please contact your clinic.',
  },
  signed: {
    title: 'Your provider has approved your plan',
    body: 'Your clinic will send you a secure payment link. If you have questions, please contact your clinic.',
  },
  closed: {
    title: 'This plan is no longer open',
    body: 'Please contact your clinic if you have questions about your treatment.',
  },
  unavailable: {
    title: 'This page could not be opened right now',
    body: 'Please try again in a few minutes. Your link still works.',
  },
}

export default async function PlanPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const plan = await resolvePlan(createServiceClient(), token, new Date())

  if (plan.state === 'open') {
    return <PlanFlow token={token} logoUrl={plan.logoUrl} />
  }

  const copy = CLOSED[plan.state]
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-12 text-center">
      <h1 className="text-2xl font-semibold text-foreground">{copy.title}</h1>
      <p className="mt-3 text-base text-muted-foreground">{copy.body}</p>
    </main>
  )
}
