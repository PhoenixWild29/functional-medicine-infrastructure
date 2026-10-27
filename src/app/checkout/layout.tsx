// ============================================================
// Guest Checkout Layout — WO-48
// ============================================================
//
// REQ-GCX-001: Mobile-first layout (320px-428px primary viewport).
// No clinic-app nav or sidebar — patients arrive via SMS link.
// No session required — JWT token validated by Edge Middleware.

import type { Metadata } from 'next'
import { LegalFooter } from '@/components/legal/legal-footer'

export const metadata: Metadata = {
  title: 'Secure Checkout',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export default function CheckoutLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-background">
      {children}
      <LegalFooter />
    </div>
  )
}
