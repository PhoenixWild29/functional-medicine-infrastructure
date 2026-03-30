// ============================================================
// Checkout Expired / Invalid Page — WO-48
// ============================================================
//
// REQ-GCX-005: Expired token state — "Payment link expired."
// REQ-GCX-007: Invalid token state — "Invalid payment link."
//
// This page is the redirect target for both scenarios from middleware.
// Static — no server fetch required.

export default function CheckoutExpiredPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm space-y-4 text-center">
        <div
          className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-100"
          aria-hidden
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-7 w-7 text-amber-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>

        {/* WO-73 NB-2: Calm, professional copy — use semantic tokens, not hardcoded gray */}
        <h1 className="text-2xl font-semibold text-foreground">
          This payment link has expired
        </h1>

        <p className="text-base text-muted-foreground">
          Payment links expire after 72 hours for security. Please contact your
          clinic to request a new one.
        </p>
      </div>
    </main>
  )
}
