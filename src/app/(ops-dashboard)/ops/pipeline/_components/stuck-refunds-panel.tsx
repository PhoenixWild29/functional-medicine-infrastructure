// ============================================================
// Stuck refunds — ops pipeline panel (Batch 2, PR B)
// ============================================================
//
// Refunds automation has stopped retrying: pending past Stripe's 24-hour
// idempotency window, or with no readable pending time. Each needs a
// person to check the PaymentIntent in Stripe. Server-rendered; no
// client state.

import type { StuckRefundsResult } from '@/lib/refunds/stuck'

function formatSince(iso: string | null): string {
  if (!iso) return 'pending since: unknown'
  return `pending since ${new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`
}

export function StuckRefundsPanel({ result }: { result: StuckRefundsResult }) {
  if (!result.ok) {
    return (
      <div
        role="alert"
        data-testid="stuck-refunds-error"
        className="rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700"
      >
        Stuck refunds could not be loaded: {result.error}. This is an error, not an empty list.
      </div>
    )
  }

  return (
    <section
      data-testid="stuck-refunds"
      className={`rounded-md border px-4 py-2.5 text-sm ${result.rows.length > 0 ? 'border-red-200 bg-red-50 text-red-800' : 'border-border bg-muted/30 text-muted-foreground'}`}
    >
      {result.rows.length === 0 ? (
        <p>No stuck refunds.</p>
      ) : (
        <>
          <p className="font-semibold">
            {result.rows.length} stuck refund{result.rows.length !== 1 ? 's' : ''} — automatic retry has stopped.
            Check each PaymentIntent in Stripe and resolve by hand.
          </p>
          <ul className="mt-1 space-y-0.5">
            {result.rows.map(r => (
              <li key={r.orderId} data-testid={`stuck-refund-${r.orderId}`} className="font-mono text-xs">
                {r.orderId} — ${(r.retailCents / 100).toFixed(2)} retail — {formatSince(r.pendingSince)}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
