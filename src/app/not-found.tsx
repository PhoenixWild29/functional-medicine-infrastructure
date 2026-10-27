// Not found: every URL that matches no route, for every audience.
//
// The way out depends on who is looking: signed-in staff go back to their
// own home (clinic dashboard, ops dashboard, pharmacy portal); anyone else
// (a patient with a broken link, a signed-out visitor) gets the sign-in
// page and a line about asking the clinic for a new link. The role comes
// from app_metadata (lib/auth/claims) via getUser(), never getSession().
// Any failure reading the user falls back to the signed-out page.

import { ErrorScreen } from '@/components/errors/error-screen'
import { getUserRole } from '@/lib/auth/claims'
import { createServerClient } from '@/lib/supabase/server'

const HOME: Record<string, { label: string; href: string }> = {
  clinic_admin:      { label: 'Back to dashboard', href: '/dashboard' },
  provider:          { label: 'Back to dashboard', href: '/dashboard' },
  medical_assistant: { label: 'Back to dashboard', href: '/dashboard' },
  ops_admin:         { label: 'Back to ops dashboard', href: '/ops' },
  pharmacy_admin:    { label: 'Back to pharmacy portal', href: '/pharmacy' },
}

async function signedInHome(): Promise<{ label: string; href: string } | null> {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    const role = getUserRole(user)
    return role ? HOME[role] ?? null : null
  } catch {
    return null
  }
}

export default async function NotFound() {
  const home = await signedInHome()
  if (home) {
    return (
      <ErrorScreen
        testId="not-found-staff"
        title="Page not found"
        message="We could not find that page. It may have been moved, or the link may be incomplete."
        actions={[home]}
      />
    )
  }
  return (
    <ErrorScreen
      testId="not-found-public"
      title="Page not found"
      message="We could not find that page. If your clinic sent you a link, please ask them to send it again."
      actions={[{ label: 'Go to sign in', href: '/login' }]}
    />
  )
}
