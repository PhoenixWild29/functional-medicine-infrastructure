// Browser sign-out that loads the Supabase browser client only when the
// user signs out (or the HIPAA timeout fires). The layout's sign-out
// controls render on every clinic and ops page; a static import of
// ./client put the whole browser client (auth, realtime, storage,
// postgrest; about 60 kB gzip) in every page's first load just for this.

export async function signOutInBrowser(): Promise<void> {
  const { createBrowserClient } = await import('./client')
  await createBrowserClient().auth.signOut()
}
