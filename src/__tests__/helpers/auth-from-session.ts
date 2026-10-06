// ============================================================
// getUser() for route tests that were written against getSession()
// ============================================================
//
// A route must trust getUser() (the token verified with Supabase), never
// getSession() (whatever the cookie says). These harnesses mock a session;
// getUser() answers with that session's user, unless a test marks the token
// as forged or stale: then the cookie still holds a session, but getUser()
// finds no user, and the route must answer 401.

export const authCheck = { forged: false }

export async function userFromSession(session: unknown) {
  if (authCheck.forged) return { data: { user: null }, error: { message: 'invalid JWT: unable to verify' } }
  const r = (await session) as { data?: { session?: { user?: unknown } | null } } | undefined
  return { data: { user: r?.data?.session?.user ?? null }, error: null }
}

/** Run `fn` with a session whose token does not verify. */
export async function withForgedSession<T>(fn: () => Promise<T>): Promise<T> {
  authCheck.forged = true
  try {
    return await fn()
  } finally {
    authCheck.forged = false
  }
}
