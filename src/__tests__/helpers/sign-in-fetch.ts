// ============================================================
// Test helper: the sign-in and MFA routes over a Supabase-shaped mock
// ============================================================
//
// Since security B12 the login page posts to /api/sign-in and the MFA
// challenge to /api/mfa/verify, instead of calling Supabase in the
// browser. Page tests keep mocking Supabase's own results
// (signInWithPassword, mfa.challengeAndVerify); this fetch answers the two
// routes from those mocks with the routes' status mapping (see
// src/app/api/sign-in/route.ts and src/app/api/mfa/verify/route.ts), and
// passes any other URL to `fallback`.

type SupabaseResult = { data?: { user?: { app_metadata?: Record<string, unknown> } | null; session?: unknown } | null; error?: { code?: string; message?: string } | null }

function json(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

export function signInFetch(mocks: {
  signInWithPassword?: (args: { email: string; password: string }) => Promise<SupabaseResult>
  challengeAndVerify?: (args: { factorId: string; code: string }) => Promise<SupabaseResult>
  fallback?: typeof fetch
}): jest.Mock {
  return jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, string> : {}
    if (url === '/api/sign-in' && mocks.signInWithPassword) {
      const { data, error } = await mocks.signInWithPassword({ email: body['email']!, password: body['password']! })
      if (error?.code === 'user_banned') return json(403, { error: 'Account deactivated', code: 'user_banned' })
      if (error || !data?.session || !data?.user) return json(401, { error: 'Invalid email or password. Please try again.' })
      return json(200, { appRole: data.user.app_metadata?.['app_role'] ?? null })
    }
    if (url === '/api/mfa/verify' && mocks.challengeAndVerify) {
      const { error } = await mocks.challengeAndVerify({ factorId: body['factorId']!, code: body['code']! })
      if (error) return json(400, { error: 'That code did not match. Check the time on your device and try the newest code.' })
      return json(200, { ok: true })
    }
    if (mocks.fallback) return mocks.fallback(input, init)
    throw new Error(`signInFetch: unexpected fetch ${url}`)
  })
}
