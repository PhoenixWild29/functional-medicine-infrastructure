import type { Metadata } from 'next'
import { connection } from 'next/server'
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

// Compliance C9: the CSP nonce is per request, so every page must render
// per request for Next.js to stamp the nonce on its scripts. A statically
// prerendered page would carry inline scripts without it, and the enforced
// CSP would block them. connection() opts the whole tree into dynamic
// rendering (every authenticated page already was).
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await connection()
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="font-sans">
        {children}
      </body>
    </html>
  )
}
