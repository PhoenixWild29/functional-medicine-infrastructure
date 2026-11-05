// Browser sign-out that loads the Supabase browser client only when the
// user signs out (or the HIPAA timeout fires). The layout's sign-out
// controls render on every clinic and ops page; a static import of
// ./client put the whole browser client (auth, realtime, storage,
// postgrest; about 60 kB gzip) in every page's first load just for this.
//
// The tab's prescription session is cleared first, whatever the sign-out
// call returns, so the next login in this tab starts clean.

import { clearSignedInTabState } from '@/lib/client-state/clear'

export async function signOutInBrowser(): Promise<void> {
  clearSignedInTabState()
  const { createBrowserClient } = await import('./client')
  await createBrowserClient().auth.signOut()
}
