// ============================================================
// /intake/[token]: the patient completes their details
// ============================================================
//
// Patient Intake PR 2. Public: middleware lets /intake through without a
// session (no-store). The token is checked here against its stored
// SHA-256. An open link renders the flow with the clinic's name and
// nothing about the patient, so a forwarded link shows no PHI. Expired,
// used and unknown links say so; a database error is not shown as
// "expired".

import type { Metadata } from 'next'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveIntakeLink } from '@/lib/intake/links'
import { IntakeFlow } from './_components/intake-flow'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Complete your details',
  robots: { index: false, follow: false },
}

const CLOSED: Record<'expired' | 'used' | 'invalid' | 'unavailable', { title: string; body: string }> = {
  expired: {
    title: 'This link has expired',
    body: 'For your security, links work for 72 hours. Please contact your clinic and ask them to send you a new one.',
  },
  used: {
    title: 'This link has already been used',
    body: 'Your details were already sent, or your clinic sent you a newer link. If you need to change something, please contact your clinic.',
  },
  invalid: {
    title: 'This link is not valid',
    body: 'Please check that you opened the whole link from your clinic, or ask them to send it again.',
  },
  unavailable: {
    title: 'This page could not be opened right now',
    body: 'Please try again in a few minutes. Your link still works.',
  },
}

export default async function IntakePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const link = await resolveIntakeLink(createServiceClient(), token)

  if (link.state === 'open') {
    return <IntakeFlow token={token} clinicName={link.clinicName} />
  }

  const copy = CLOSED[link.state]
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12 text-center">
      <h1 className="text-2xl font-semibold text-foreground">{copy.title}</h1>
      <p className="mt-3 text-base text-muted-foreground">{copy.body}</p>
    </main>
  )
}
