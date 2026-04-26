import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { verifyCheckoutToken } from '@/lib/auth/checkout-token'

// PR R7-Bucket-1: Apply HIPAA-grade no-store cache headers to every response
// that touches authenticated state OR PHI. Closes a CRITICAL bfcache leak
// where pressing the browser Back button after sign-out restored the prior
// authenticated page (with patient name, DOB, medication, financial split)
// from the browser's bfcache without re-running middleware.
//
// Verbose directive list is intentional defense-in-depth against unknown
// intermediate caches (corporate / hospital IT proxies). On modern
// infrastructure `no-store` alone suffices, but the rest are HTTP/1.0-era
// belt-and-suspenders for a healthcare context.
//
// MUST NOT be applied to /auth/callback — Supabase OAuth flows briefly
// rely on caching the callback HTML during the code exchange.
function applySecurityHeaders(res: NextResponse): NextResponse {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private')
  res.headers.set('Pragma', 'no-cache')
  res.headers.set('Expires', '0')
  return res
}

// Edge Middleware: runs on every request before page rendering
// Handles auth verification for clinic-app and ops-dashboard route groups
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })
  const { pathname } = request.nextUrl

  // Patient checkout: validate JWT token before page render
  //
  // Supported URL patterns:
  //   /checkout/[token]  — token as path segment (primary pattern)
  //   /checkout?token=x  — token as query param (legacy / layout compat)
  //
  // /checkout (bare, no token) and /checkout/expired pass through without auth.
  // On success, forwards x-checkout-order-id, x-checkout-patient-id,
  // and x-checkout-clinic-id as request headers for downstream Server Components.
  if (pathname.startsWith('/checkout')) {
    const segments = pathname.split('/').filter(Boolean)
    const pathToken = segments[1] // path-based: /checkout/[token]
    const queryToken = request.nextUrl.searchParams.get('token') // query-based: /checkout?token=x

    // Resolve token — path segment takes priority; skip reserved static segments
    const RESERVED_SEGMENTS = new Set(['expired', 'success'])
    const token = (pathToken && !RESERVED_SEGMENTS.has(pathToken)) ? pathToken : queryToken

    if (token) {
      const payload = await verifyCheckoutToken(token)

      if (!payload) {
        // Expired or invalid — redirect to the expired page
        return applySecurityHeaders(NextResponse.redirect(new URL('/checkout/expired', request.url)))
      }

      // Attach decoded claims as REQUEST headers so Server Components can read
      // them via `headers()` from 'next/headers'. Must use the `request` option
      // of NextResponse.next() — setting on the response object attaches them as
      // response headers sent to the browser, not request headers visible to pages.
      // BLK-01 fix: copy existing request headers first, then append checkout claims.
      // NB-01: patient-id not forwarded — not consumed downstream (defense-in-depth).
      // R7-Bucket-1: this branch renders patient PHI (name, medication, sig,
      // financial split) — wrap with security headers so a patient hitting Back
      // after navigating away doesn't bfcache-restore their own checkout PHI.
      const requestHeaders = new Headers(request.headers)
      requestHeaders.set('x-checkout-order-id',  payload.orderId)
      requestHeaders.set('x-checkout-clinic-id',  payload.clinicId)
      return applySecurityHeaders(NextResponse.next({ request: { headers: requestHeaders } }))
    }

    return response
  }

  // Public routes — no auth required
  // /api/webhooks must be public — Stripe/Documo/Twilio arrive without a session
  // BLK-1 (cowork): /api/cron and /api/health must be public.
  //   - Cron jobs authenticate via CRON_SECRET bearer token inside the route handler,
  //     not via Supabase session cookies. Without this, all cron invocations get
  //     302-redirected to /login and never execute.
  //   - /api/health is called by the CI/CD deploy pipeline (deploy.yml health check)
  //     with no session cookie — redirect would break the deploy gate.
  // NB-05: /auth/callback must be public — Supabase email-verification links arrive
  //   as cold visits (no session) and must reach the route handler to exchange the code.
  const publicRoutes = ['/login', '/unauthorized', '/auth/callback', '/api/webhooks', '/api/cron', '/api/health', '/api/checkout']
  if (publicRoutes.some(route => pathname.startsWith(route))) {
    return response
  }

  // Verify Supabase session for protected routes
  const supabase = createServerClient(
    process.env['NEXT_PUBLIC_SUPABASE_URL']!,
    process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value)
            response = NextResponse.next({ request })
            response.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirectTo', pathname)
    return applySecurityHeaders(NextResponse.redirect(loginUrl))
  }

  const appRole = session.user.user_metadata['app_role'] as string | undefined

  // Ops dashboard: ops_admin only
  if (pathname.startsWith('/ops') && appRole !== 'ops_admin') {
    return applySecurityHeaders(NextResponse.redirect(new URL('/unauthorized', request.url)))
  }

  // Clinic app: clinic users only
  const clinicUserRoles = ['clinic_admin', 'provider', 'medical_assistant']
  if (!pathname.startsWith('/ops') && appRole && !clinicUserRoles.includes(appRole) && appRole !== 'ops_admin') {
    return applySecurityHeaders(NextResponse.redirect(new URL('/unauthorized', request.url)))
  }

  return applySecurityHeaders(response)
}

export const config = {
  matcher: [
    // Match all routes except static files and Next.js internals
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
