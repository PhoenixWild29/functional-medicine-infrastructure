// ============================================================
// Guest Checkout Page — WO-48 + Phase C Stage 5
// /checkout/[token]
// ============================================================
//
// Server Component — token validated by the proxy (src/proxy.ts) before render
// (see _components/render-checkout.tsx, shared with /checkout?token=). Once the
// page is on screen the client takes the token out of the address bar
// (history.replaceState to /checkout) before Stripe.js loads; see
// _components/checkout-page-content.tsx.

import { renderCheckout } from './_components/render-checkout'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ token: string }>
}

export default async function CheckoutPage({ params }: PageProps) {
  const { token } = await params
  return renderCheckout(token)
}
