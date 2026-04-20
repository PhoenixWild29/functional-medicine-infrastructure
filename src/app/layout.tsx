import type { Metadata } from 'next'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import './globals.css'

export const metadata: Metadata = {
  title: 'CompoundIQ',
  description: 'Compounding pharmacy order management',
  robots: { index: false, follow: false }, // Never index — HIPAA
}

// Note: Toaster is intentionally NOT rendered here. Every route group
// that emits toasts mounts its own Toaster inside <Providers /> (see
// src/components/providers.tsx), which is wrapped by each of:
//   (clinic-app)/layout.tsx
//   (ops-dashboard)/layout.tsx
//   (patient-checkout)/layout.tsx
// Public routes that do not use Providers (/login, /unauthorized,
// /checkout/[token], /checkout/success, /checkout/expired) do not emit
// toasts — they use inline role="alert" divs for feedback instead.
// Adding a Toaster here previously caused two sonner live regions to
// mount on every authenticated page, which screen readers announce
// twice and Playwright's strict-mode selectors report as duplicates.

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="font-sans">
        {children}
      </body>
    </html>
  )
}
