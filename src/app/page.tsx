import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'

// Root entry point — no visible UI, pure role-based redirect.
// Unauthenticated users land here after email verification or direct nav.
//
// Reads with getUser(), never getSession(). '/' is covered by the
// middleware refresh block, so the token pair is current and persisted by
// the time this runs and this read cannot trigger a rotation that a Server
// Component would be unable to write back.
//
// redirect() is safe HERE specifically: there is no loading.tsx above this
// segment, so nothing has been flushed and Next still turns the throw into
// a real HTTP redirect. That is NOT true inside (clinic-app)/(ops-dashboard),
// where loading.tsx puts every page body inside a Suspense boundary — those
// page bodies must not redirect for auth. See
// src/app/__tests__/no-inline-page-auth.test.ts.
export default async function RootPage() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const appRole = user.user_metadata['app_role'] as string | undefined

  if (appRole === 'ops_admin') {
    redirect('/ops/pipeline')
  }

  // clinic_admin, provider, medical_assistant — all land on clinic dashboard
  redirect('/dashboard')
}
