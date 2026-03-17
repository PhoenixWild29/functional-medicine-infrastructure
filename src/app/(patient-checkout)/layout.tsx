import { redirect } from 'next/navigation'
import { verifyCheckoutToken } from '@/lib/auth/checkout-token'
import { Providers } from '@/components/providers'

// Patient Checkout: stateless JWT token auth (no Supabase session)
// Mobile-first: optimized for 320px-428px viewports
// No login required — access via one-time checkout token in URL
export default async function PatientCheckoutLayout({
  children,
  searchParams,
}: {
  children: React.ReactNode
  searchParams: { token?: string }
}) {
  const token = searchParams.token

  if (!token) {
    redirect('/checkout/expired')
  }

  const payload = await verifyCheckoutToken(token)

  if (!payload) {
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
