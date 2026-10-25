// ============================================================
// /intake/[token]: the patient completes their details
// ============================================================
//
// Patient Intake PR 2. Public: middleware lets /intake through without a
// session (no-store). The token is checked here against its stored
// SHA-256. An open link renders the flow with the clinic's name and
// nothing about the patient, so a forwarded link shows no PHI. Expired,
// used and unknown links show one neutral page, word for word the same,
// so the page never says whether a link existed; a database error is the
// only other page.

import type { Metadata } from 'next'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveIntakeLink } from '@/lib/intake/links'
import { IntakeFlow } from './_components/intake-flow'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Complete your details',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

const NOT_ACTIVE = {
  title: 'This link is no longer active',
  body: 'Links stop working after 72 hours or once your details are sent. If you need a new link or need to change something, please contact your clinic.',
}
const UNAVAILABLE = {
  title: 'This page could not be opened right now',
  body: 'Please try again in a few minutes.',
}

export default async function IntakePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const link = await resolveIntakeLink(createServiceClient(), token)

  if (link.state === 'open') {
    return <IntakeFlow token={token} clinicName={link.clinicName} />
  }

  const copy = link.state === 'unavailable' ? UNAVAILABLE : NOT_ACTIVE
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12 text-center">
      <h1 className="text-2xl font-semibold text-foreground">{copy.title}</h1>
      <p className="mt-3 text-base text-muted-foreground">{copy.body}</p>
    </main>
  )
}
