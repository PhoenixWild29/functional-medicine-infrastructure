// ============================================================
// Auth Callback Route — WO-52
// /auth/callback
// ============================================================
//
// Handles the OAuth / magic-link / email-verification callback
// from Supabase. Exchanges the one-time `code` for a session
// cookie, then redirects the user to the appropriate destination.
//
// Query params:
//   code        — PKCE auth code from Supabase
//   next        — (optional) destination after sign-in
//   redirectTo  — (optional) alias for `next`

import { NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? searchParams.get('redirectTo')

  if (code) {
    // BLK-01 fix: route handlers must use createRouteHandlerClient (not createServerClient)
    // so that the session cookie Set-Cookie header is correctly written to the response.
    const supabase = await createRouteHandlerClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      // If a specific destination was requested and it's a relative path, honour it.
      // NB-1 (cowork): exclude protocol-relative URLs (//evil.com) — same guard as login page.
      if (next && next.startsWith('/') && !next.startsWith('//')) {
        return NextResponse.redirect(`${origin}${next}`)
      }
      // Default: root redirect will fan out by role
      return NextResponse.redirect(`${origin}/`)
    }
  }

  // Code missing or exchange failed — redirect to login with error hint
  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
}
