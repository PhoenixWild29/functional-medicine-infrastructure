// ============================================================
// /new-prescription/sign/[orderId] — moved to the batch sign page (WO-99)
// ============================================================
//
// src/middleware.ts redirects this path to /new-prescription/sign?orders=<id>
// before it renders (a redirect() from inside the (clinic-app) Suspense
// boundary hangs instead of navigating). This page is only reached if that
// redirect is ever bypassed, and then it links on rather than signing.

import { batchSignHref } from '@/lib/orders/batch-sign-view'

interface PageProps {
  params: Promise<{ orderId: string }>
}

export const metadata = {
  title: 'Sign Prescriptions',
}

export default async function SignDraftMovedPage({ params }: PageProps) {
  const { orderId } = await params
  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-xl font-semibold text-foreground">Signing has moved</h1>
      <p className="mt-2 text-sm text-muted-foreground">Drafts are now signed together on the batch sign page.</p>
      <a href={batchSignHref([orderId])} className="mt-4 inline-block text-sm text-primary underline">
        Open this draft on the batch sign page
      </a>
    </main>
  )
}
