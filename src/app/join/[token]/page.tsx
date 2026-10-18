// ============================================================
// /join/[token]: a new patient signs up from a clinic's link
// ============================================================
//
// Patient Intake PR 3. Public: middleware lets /join through without a
// session. The token (the clinic's standing sign-up link, or its QR code)
// is checked here against its stored SHA-256. An open link runs the
// self-intake flow in sign-up mode with the clinic's name, and nothing
// about any patient. A link that is turned off, revoked or unknown shows
// one plain message (an unknown token is not told apart); a database error
// is not shown as inactive. A link whose clinic is not approved yet (or is
// switched off) shows the same plain message: the clinic is checked here
// before the form renders (lib/onboarding/clinic-approval), and the 410 on
// submit stays as the backstop.

import type { Metadata } from 'next'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveSignupLink } from '@/lib/intake/signup-links'
import { IntakeFlow } from '@/app/intake/[token]/_components/intake-flow'
import { clinicApproval } from '@/lib/onboarding/clinic-approval'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Sign up as a new patient',
  robots: { index: false, follow: false },
}

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const supabase = createServiceClient()
  const link = await resolveSignupLink(supabase, token)
  const approval = link.state === 'open' ? (await clinicApproval(supabase, link.clinicId)).state : null

  if (link.state === 'open' && approval === 'approved') {
    return <IntakeFlow token={token} clinicName={link.clinicName} variant="signup" />
  }

  const copy = link.state === 'unavailable' || approval === 'unavailable'
    ? { title: 'This page could not be opened right now', body: 'Please try again in a few minutes.' }
    : { title: 'This link is no longer active', body: 'This link is no longer active. Contact your clinic.' }
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12 text-center">
      <h1 className="text-2xl font-semibold text-foreground">{copy.title}</h1>
      <p className="mt-3 text-base text-muted-foreground">{copy.body}</p>
    </main>
  )
}
