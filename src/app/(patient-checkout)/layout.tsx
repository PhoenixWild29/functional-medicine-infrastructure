import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { Providers } from '@/components/providers'

// Patient Checkout: stateless JWT token auth (no Supabase session)
// Mobile-first: optimized for 320px-428px viewports
// No login required — access via one-time checkout token in URL
//
// JWT validation is performed at the Edge Middleware layer (src/middleware.ts).
// On success, middleware forwards x-checkout-order-id as a request header.
// This layout reads that header as a defense-in-depth guard — if the header
// is absent it means middleware either rejected the token (rare: middleware
// should have already redirected) or the request bypassed middleware entirely.
//
// NOTE: Next.js 14 App Router layouts do NOT receive searchParams — only
// page.tsx files do. Token validation must happen in middleware or page layer.
export default async function PatientCheckoutLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const headersList = headers()
  const orderId = headersList.get('x-checkout-order-id')

  if (!orderId) {
    redirect('/checkout/expired')
  }

  return (
    <Providers>
      {/* Mobile-first container: max-width matches patient device range */}
      <div className="mx-auto min-h-screen max-w-sm bg-background px-4 py-6">
        {children}
      </div>
    </Providers>
  )
}
