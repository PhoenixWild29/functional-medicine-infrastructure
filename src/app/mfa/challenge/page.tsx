// ============================================================
// /mfa/challenge: compliance C3, multi-factor sign-in
// ============================================================
//
// Reachable at AAL1 (middleware exempts /mfa/*), with a signed-in user:
// middleware sends anyone without a session to /login first. The
// destination is resolved here with the same safe rule as /login, so
// ?redirectTo= can never point off-site.
//
// getUser(), never getSession(): middleware owns token rotation.

import { createServerClient } from '@/lib/supabase/server'
import { SessionGuardNotice } from '@/components/session-guard-notice'
import { postLoginDestination } from '@/lib/auth/landing-route'
import { MfaChallenge } from '../_components/mfa-challenge'
import { getUserRole } from '@/lib/auth/claims'

export const metadata = { title: 'Two-step sign-in' }
export const dynamic = 'force-dynamic'

export default async function Page(
  props: { searchParams?: Promise<{ redirectTo?: string }> } = {},
) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return <SessionGuardNotice />

  const redirectTo = (await props.searchParams)?.redirectTo ?? null
  const appRole = getUserRole(user)
  return <MfaChallenge destination={postLoginDestination(appRole, redirectTo)} />
}
