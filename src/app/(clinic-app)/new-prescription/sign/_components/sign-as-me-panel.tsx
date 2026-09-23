'use client'

// ============================================================
// Sign as me — WO-100
// ============================================================
//
// Shown on the draft signing page when the draft is assigned to a
// different provider than the signed-in one. One action: take the
// draft over (every line of it) and continue to signing under the
// caller's own name. The server writes the audit row.

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  orderId:              string
  assignedProviderName: string
  myProviderName:       string
  /** Number of DRAFT lines that will move with this one (same patient, same provider). */
  lineCount:            number
}

export function SignAsMePanel({ orderId, assignedProviderName, myProviderName, lineCount }: Props) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSignAsMe() {
    setIsSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/orders/${orderId}/reassign-to-me`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'Could not reassign this draft')
      }
      // Same URL, now under my name — the server component re-renders the
      // signing form. WO-99 will redirect this to the batch sign page.
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred')
      setIsSubmitting(false)
    }
  }

  return (
    <div
      className="rounded-lg border-2 border-amber-300 bg-amber-50 p-5"
      data-testid="sign-as-me-panel"
      role="region"
      aria-label="Draft assigned to another provider"
    >
      <p className="text-sm font-semibold text-amber-900">
        This draft is assigned to {assignedProviderName}
      </p>
      <p className="mt-1 text-sm text-amber-800">
        You are signed in as {myProviderName}. Sign as me moves{' '}
        {lineCount > 1 ? `all ${lineCount} prescriptions in this draft` : 'this prescription'}{' '}
        to your name and records the reassignment in the audit trail. You then review and sign as usual.
      </p>

      {error && (
        <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={handleSignAsMe}
          disabled={isSubmitting}
          className="min-h-[44px] rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
        >
          {isSubmitting ? 'Reassigning…' : 'Sign as me'}
        </button>
        <button
          type="button"
          onClick={() => router.push('/dashboard')}
          disabled={isSubmitting}
          className="text-sm text-muted-foreground underline hover:text-foreground focus-visible:outline-none"
        >
          Back to dashboard
        </button>
      </div>
    </div>
  )
}
