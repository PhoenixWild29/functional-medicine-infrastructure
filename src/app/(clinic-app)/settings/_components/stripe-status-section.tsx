'use client'

// ============================================================
// Stripe Status Section — WO-30
// ============================================================
//
// REQ-CAD-001: Stripe Connect Express onboarding — shows current status
//   and provides a CTA to start or resume onboarding.
// REQ-CAD-002: Connected account lifecycle display.
//   - PENDING/ONBOARDING: progress banner + "Start/Continue Onboarding" button
//   - ACTIVE: green success badge
//   - RESTRICTED: warning banner + "Resume Onboarding" button
//   - DEACTIVATED: error banner + contact support message
//
// HC-02/PF-01: Onboarding button calls POST /api/stripe/connect-onboarding
//   which creates an EXPRESS account (never Standard or Custom).

import { useState } from 'react'
import type { StripeConnectStatusEnum } from '@/types/database.types'

interface Props {
  stripeConnectStatus: StripeConnectStatusEnum
  stripeAccountId: string | null
}

export function StripeStatusSection({ stripeConnectStatus, stripeAccountId }: Props) {
  const [isLoading, setIsLoading] = useState(false)
  const [error,     setError]     = useState<string | null>(null)

  async function handleStartOnboarding() {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/stripe/connect-onboarding', { method: 'POST' })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        throw new Error(data.error ?? 'Failed to start onboarding')
      }
      const { url } = await res.json() as { url: string }
      window.location.href = url
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred')
      setIsLoading(false)
    }
  }

  const showOnboardingButton =
    stripeConnectStatus === 'PENDING' ||
    stripeConnectStatus === 'ONBOARDING' ||
    stripeConnectStatus === 'RESTRICTED'

  return (
    <section className="rounded-lg border border-border bg-card p-6 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Stripe Payout Account</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Required to receive clinic payouts from patient payments.
          </p>
        </div>
        <StatusBadge status={stripeConnectStatus} />
      </div>

      {/* PENDING / ONBOARDING: progress banner */}
      {(stripeConnectStatus === 'PENDING' || stripeConnectStatus === 'ONBOARDING') && (
        <div role="status" className="rounded-md border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800">
          <p className="font-medium">Onboarding in progress</p>
          <p className="mt-0.5 text-xs">
            Complete your Stripe account setup to enable order creation and payouts.
            Order intake is blocked until onboarding is complete.
          </p>
        </div>
      )}

      {/* RESTRICTED: warning banner */}
      {stripeConnectStatus === 'RESTRICTED' && (
        <div role="status" className="rounded-md border border-orange-300 bg-orange-50 p-3 text-sm text-orange-800">
          <p className="font-medium">Account restricted</p>
          <p className="mt-0.5 text-xs">
            Stripe requires additional information. New order creation is blocked.
            Existing orders in progress are not affected.
          </p>
        </div>
      )}

      {/* DEACTIVATED: error banner */}
      {stripeConnectStatus === 'DEACTIVATED' && (
        <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          <p className="font-medium">Account deactivated</p>
          <p className="mt-0.5 text-xs">
            Your Stripe account has been deactivated. All order operations are blocked.
            Contact platform support to resolve this issue.
          </p>
        </div>
      )}

      {/* ACTIVE: success message */}
      {stripeConnectStatus === 'ACTIVE' && (
        <div role="status" className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">
          <p className="font-medium">Payouts active</p>
          <p className="mt-0.5 text-xs">
            Your Stripe account is fully verified. Clinic payouts are enabled.
            {stripeAccountId && (
              <span className="block mt-0.5 font-mono text-xs opacity-70">
                Account: {stripeAccountId}
              </span>
            )}
          </p>
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
          {error}
        </div>
      )}

      {/* Onboarding CTA */}
      {showOnboardingButton && (
        <button
          type="button"
          onClick={handleStartOnboarding}
          disabled={isLoading}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {isLoading
            ? 'Redirecting…'
            : stripeConnectStatus === 'PENDING'
              ? 'Start Onboarding'
              : 'Continue Onboarding'}
        </button>
      )}
    </section>
  )
}

function StatusBadge({ status }: { status: StripeConnectStatusEnum }) {
  const config: Record<StripeConnectStatusEnum, { label: string; className: string }> = {
    PENDING:     { label: 'Pending',     className: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
    ONBOARDING:  { label: 'Onboarding',  className: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
    ACTIVE:      { label: 'Active',      className: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
    RESTRICTED:  { label: 'Restricted',  className: 'bg-orange-100 text-orange-800 border-orange-300' },
    DEACTIVATED: { label: 'Deactivated', className: 'bg-red-100 text-red-800 border-red-300' },
  }
  const { label, className } = config[status]
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${className}`}>
      {label}
    </span>
  )
}
