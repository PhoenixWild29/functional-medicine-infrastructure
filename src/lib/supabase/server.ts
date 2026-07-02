import { createServerClient as _createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/types/database.types'

// Server Component client — uses RLS based on the user's JWT session.
// Use in Server Components and Server Actions.
// Never use the service role key here.
//
// Optional `extraHeaders` are forwarded on every Supabase request. This is
// how the F-3 provider opt-in clinic view toggle (migration
// 20260614000003) reaches the RLS policy: the dashboard SSR passes
// `{ 'x-provider-view-mode': 'clinic' }` when `?view=clinic` is on the
// URL and the session is a provider. The header surfaces to RLS via
// PostgREST's `request.headers` GUC.
export async function createServerClient(
  options?: { extraHeaders?: Record<string, string> },
) {
  const cookieStore = await cookies()
  return _createServerClient<Database>(
    process.env['NEXT_PUBLIC_SUPABASE_URL']!,
    process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        },
      },
      ...(options?.extraHeaders
        ? { global: { headers: options.extraHeaders } }
        : {}),
    }
  )
}

// Route Handler client — uses RLS based on the user's JWT session.
// Use in API route handlers that act on behalf of the authenticated user.
export async function createRouteHandlerClient() {
  const cookieStore = await cookies()
  return _createServerClient<Database>(
    process.env['NEXT_PUBLIC_SUPABASE_URL']!,
    process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        },
      },
    }
  )
}
