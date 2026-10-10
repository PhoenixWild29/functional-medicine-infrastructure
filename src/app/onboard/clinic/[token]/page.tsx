// /onboard/clinic/<token> — the clinic admin's invite (from ops)

import { lookupInviteForPage } from '@/lib/onboarding/invite-lookup'
import { AcceptInviteForm } from '../../_components/accept-invite-form'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Set up your clinic | CompoundIQ', referrer: 'no-referrer' as const }

export default async function ClinicInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const invite = await lookupInviteForPage(token, true)
  return <AcceptInviteForm token={token} kind={invite.kind} clinicName={invite.clinicName} email={invite.email} status={invite.status} />
}
