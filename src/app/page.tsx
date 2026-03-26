import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'

// Root entry point — no visible UI, pure role-based redirect.
// Unauthenticated users land here after email verification or direct nav.
export default async function RootPage() {
  const supabase = await createServerClient()
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    redirect('/login')
  }

  const appRole = session.user.user_metadata['app_role'] as string | undefined

  if (appRole === 'ops_admin') {
    redirect('/ops/pipeline')
  }

  // clinic_admin, provider, medical_assistant — all land on clinic dashboard
  redirect('/dashboard')
}
