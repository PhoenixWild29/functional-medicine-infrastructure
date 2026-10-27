// ============================================================
// /checkout: the payment page with the token out of the address bar
// ============================================================
//
// Two ways here:
//   - /checkout?token=<jwt>: the legacy query form. Middleware validates
//     the token exactly as for /checkout/<jwt> (an invalid one goes to
//     /checkout/expired), and the page renders the same checkout.
//   - /checkout with no token: what the address bar shows once the
//     checkout has taken the token out of it (history.replaceState, so
//     Stripe.js never sees it in window.location). A refresh lands here.
//     The token is not kept anywhere the browser would send it back
//     (no storage, no cookie), so the patient reopens the link.

import type { Metadata } from 'next'
import { renderCheckout } from './[token]/_components/render-checkout'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Payment link' }

interface PageProps {
  searchParams: Promise<{ token?: string | string[] }>
}

export default async function CheckoutReopenPage({ searchParams }: PageProps) {
  const { token } = await searchParams
  if (typeof token === 'string' && token.length > 0) return renderCheckout(token)

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-16" data-testid="checkout-reopen">
      <div className="w-full max-w-sm space-y-4 text-center">
        <h1 className="text-2xl font-semibold text-foreground">
          Please reopen your payment link
        </h1>
        <p className="text-base text-muted-foreground">
          For your security, please reopen the payment link from your text message.
        </p>
      </div>
    </main>
  )
}
