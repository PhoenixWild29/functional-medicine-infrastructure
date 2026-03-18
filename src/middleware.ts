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
  // /checkout/[token] — token segment is the signed JWT
  // /checkout (base) and /checkout/expired — pass through without auth
  if (pathname.startsWith('/checkout')) {
    const segments = pathname.split('/').filter(Boolean)
    const tokenSegment = segments[1] // undefined for /checkout, 'expired' for /checkout/expired

    if (tokenSegment && tokenSegment !== 'expired') {
      const payload = await verifyCheckoutToken(tokenSegment)

      if (!payload) {
        // Expired or invalid — redirect to the expired page
        return NextResponse.redirect(new URL('/checkout/expired', request.url))
      }

      // Attach decoded claims as request headers for downstream page/API handlers
      // NOTE: these headers are set on the request forwarded to the Next.js page, not the client response
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
