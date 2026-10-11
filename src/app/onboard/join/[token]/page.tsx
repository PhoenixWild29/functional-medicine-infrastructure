// /onboard/join/<token> — a provider's or medical assistant's invite (from the clinic admin)

import { lookupInviteForPage } from '@/lib/onboarding/invite-lookup'
import { AcceptInviteForm } from '../../_components/accept-invite-form'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Join your clinic | CompoundIQ', referrer: 'no-referrer' as const }

export default async function JoinInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const invite = await lookupInviteForPage(token, false)
  return <AcceptInviteForm token={token} kind={invite.kind} clinicName={invite.clinicName} email={invite.email} status={invite.status} />
}
