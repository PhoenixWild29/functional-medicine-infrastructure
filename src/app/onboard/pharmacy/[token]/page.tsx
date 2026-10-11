// ============================================================
// /onboard/pharmacy/<token>: a pharmacy's invite link (public)
// ============================================================
//
// No session needed (middleware lists /onboard/ as public). The token is
// looked up by its hash; nothing about an invite is shown unless the link
// is valid.

import type { Metadata } from 'next'
import { createServiceClient } from '@/lib/supabase/service'
import { inviteForToken } from '@/lib/pharmacy-onboarding/invites'
import { AcceptInviteForm } from './_components/accept-invite-form'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Set up your pharmacy | CompoundIQ',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

const NOTICES = {
  invalid: { title: 'This link is not valid', body: 'Check that you opened the full link from your invitation, or ask CompoundIQ to send a new one.' },
  error:   { title: 'This link could not be checked', body: 'Something went wrong on our side. Reload the page to try again.' },
  expired: { title: 'This invitation has expired', body: 'Invitations are valid for 7 days. Ask CompoundIQ to send you a new link.' },
  revoked: { title: 'This invitation was withdrawn', body: 'Ask CompoundIQ for a new invitation.' },
  accepted: { title: 'This invitation was already used', body: 'Your account exists. Sign in to continue setting up your pharmacy.' },
} as const

export default async function PharmacyInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const invite = await inviteForToken(createServiceClient(), token)
  const notice = invite === 'error' ? NOTICES.error
    : !invite ? NOTICES.invalid
    : invite.state !== 'pending' ? NOTICES[invite.state]
    : null

  return (
    <main id="main-content" className="flex min-h-screen items-start justify-center bg-background px-4 py-10 sm:items-center">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <p className="text-sm font-semibold text-muted-foreground">CompoundIQ</p>
        {notice ? (
          <section aria-labelledby="notice-title" className="mt-4 space-y-3">
            <h1 id="notice-title" className="text-xl font-semibold text-foreground">{notice.title}</h1>
            <p className="text-sm text-muted-foreground">{notice.body}</p>
            {invite !== 'error' && invite?.state === 'accepted' && (
              <a href="/login?redirectTo=%2Fpharmacy%2Fonboarding" className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                Sign in
              </a>
            )}
          </section>
        ) : invite && invite !== 'error' ? (
          <section aria-labelledby="accept-title" className="mt-4 space-y-4">
            <h1 id="accept-title" className="text-xl font-semibold text-foreground">Set up your pharmacy</h1>
            <AcceptInviteForm token={token} pharmacyName={invite.pharmacyName} adminEmail={invite.adminEmail} />
          </section>
        ) : null}
      </div>
    </main>
  )
}
