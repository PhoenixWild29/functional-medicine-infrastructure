'use client'

// ============================================================
// "Protocol saved" on the dashboard, after /protocols/new
// ============================================================
//
// /protocols/new returns here with ?protocolSaved=<name>. The notice says
// it was saved and where to find it; Dismiss removes the parameter.

import { useRouter, useSearchParams } from 'next/navigation'

export function ProtocolSavedNotice() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const name = searchParams?.get('protocolSaved') ?? null
  if (!name) return null

  function dismiss() {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.delete('protocolSaved')
    const rest = params.toString()
    router.replace(rest ? `/dashboard?${rest}` : '/dashboard', { scroll: false })
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-green-200 bg-green-50 px-4 py-3">
      <p role="status" className="text-sm text-green-800">
        Protocol saved: {name}. It is in your Protocols list on New Prescription.
      </p>
      <button
        type="button"
        onClick={dismiss}
        className="text-sm font-medium text-green-800 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Dismiss
      </button>
    </div>
  )
}
