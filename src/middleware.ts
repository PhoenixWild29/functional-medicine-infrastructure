import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs'
import { verifyCheckoutToken } from '@/lib/auth/checkout-token'

// Edge Middleware: runs on every request before page rendering
// Handles auth verification for clinic-app and ops-dashboard route groups
export async function middleware(request: NextRequest) {
  const response = NextResponse.next()
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

    // Resolve token — path segment takes priority; skip reserved segments
    const token = (pathToken && pathToken !== 'expired') ? pathToken : queryToken

    if (token) {
      const payload = await verifyCheckoutToken(token)

      if (!payload) {
        // Expired or invalid — redirect to the expired page
        return NextResponse.redirect(new URL('/checkout/expired', request.url))
      }

      // Attach decoded claims as request headers for downstream Server Components
      // (Next.js 14 layouts/pages read these via `headers()` from 'next/headers')
      const forwarded = NextResponse.next()
      forwarded.headers.set('x-checkout-order-id', payload.orderId)
      forwarded.headers.set('x-checkout-patient-id', payload.patientId)
      forwarded.headers.set('x-checkout-clinic-id', payload.clinicId)
      return forwarded
    }

    return response
  }

  // Public routes — no auth required
  // /api/webhooks must be public — Stripe/Documo/Twilio arrive without a session
  const publicRoutes = ['/login', '/unauthorized', '/api/webhooks']
  if (publicRoutes.some(route => pathname.startsWith(route))) {
    return response
  }

  // Verify Supabase session for protected routes
  const supabase = createMiddlewareClient({ req: request, res: response })
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirectTo', pathname)
    return NextResponse.redirect(loginUrl)
  }

  const appRole = session.user.user_metadata['app_role'] as string | undefined

  // Ops dashboard: ops_admin only
  if (pathname.startsWith('/ops') && appRole !== 'ops_admin') {
    return NextResponse.redirect(new URL('/unauthorized', request.url))
  }

  // Clinic app: clinic users only
  const clinicUserRoles = ['clinic_admin', 'provider', 'medical_assistant']
  if (!pathname.startsWith('/ops') && appRole && !clinicUserRoles.includes(appRole) && appRole !== 'ops_admin') {
    return NextResponse.redirect(new URL('/unauthorized', request.url))
  }

  return response
}

export const config = {
  matcher: [
    // Match all routes except static files and Next.js internals
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
