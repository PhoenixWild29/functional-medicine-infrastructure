'use client'

// ============================================================
// Checkout Page Content — WO-48 + WO-49 + WO-73
// ============================================================
//
// WO-48: REQ-GCX-001 through REQ-GCX-009
//   Mobile-first guest checkout UI with clinic branding,
//   generic order summary, and state-aware display.
//
// WO-49: REQ-PSR-001 through REQ-PSR-006
//   Stripe Elements (card + Apple Pay + Google Pay via PaymentElement),
//   single PaymentIntent per order, Connect split routing enforced
//   server-side via POST /api/checkout/payment-intent.
//
// WO-73 upgrades:
//   - Sticky backdrop-blur header (CompoundIQ + clinic name)
//   - Upgraded order summary card (32px amount, "Amount due" label)
//   - Trust badges: 🔒 256-bit TLS + ⚡ Stripe only (NO HIPAA badge — legal risk)
//   - 48px-minimum Pay button (mobile touch target standard)
//   - Card declined: specific user-facing message with retry
//   - Stripe iframe 10s load timeout with fallback message
//   - fontSizeBase 16px in Stripe appearance (prevents iOS auto-zoom)
//
// REQ-GCX-008: Zero PHI — no patient name, medication name, or diagnosis.
// REQ-PSR-008: REQ-OAS-008 carried forward — no PHI in Stripe metadata.

import { useState, useEffect } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js'
import { clientEnv } from '@/lib/env'

// Stripe.js singleton — created once per page load
const stripePromise = loadStripe(clientEnv.stripePublishableKey)

function toCurrency(cents: number): string {
  return (cents / 100).toLocaleString('en-US', {
    style:                 'currency',
    currency:              'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

// ============================================================
// INNER PAYMENT FORM — WO-49 + WO-73
// ============================================================

interface PaymentFormProps {
  retailCents: number
  onError:     (msg: string | null) => void
  onReady:     () => void
}

function PaymentForm({ retailCents, onError, onReady }: PaymentFormProps) {
  const stripe   = useStripe()
  const elements = useElements()
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!stripe || !elements) return

    setIsSubmitting(true)
    onError(null)

    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        // Stripe redirects here after payment; success page reads ?payment_intent=pi_xxx
        return_url: `${window.location.origin}/checkout/success`,
      },
    })

    // confirmPayment only reaches here on error (success triggers redirect)
    if (error) {
      // WO-73: specific messages per error type
      const userMessage =
        error.code === 'card_declined'
          ? 'Your card was declined. Please try a different card or contact your bank.'
          : error.type === 'card_error' || error.type === 'validation_error'
          ? (error.message ?? 'Your payment could not be processed.')
          : 'Something went wrong processing your payment. Please try again.'
      onError(userMessage)
    }

    setIsSubmitting(false)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Stripe PaymentElement — handles card, Apple Pay, Google Pay — REQ-PSR-003 */}
      <PaymentElement
        options={{
          layout:  'tabs',
          wallets: { applePay: 'auto', googlePay: 'auto' },
        }}
        onReady={onReady}
      />

      {/* WO-73: min-h-[48px] — 48px touch target standard, shows amount */}
      <button
        type="submit"
        disabled={!stripe || !elements || isSubmitting}
        className="w-full min-h-[48px] rounded-lg bg-primary px-4 py-3 text-base font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {isSubmitting ? 'Processing…' : `Pay ${toCurrency(retailCents)}`}
      </button>
    </form>
  )
}

// ============================================================
// STATIC STATE DISPLAYS — WO-48
// ============================================================

function PaidState({ clinicName }: { clinicName: string }) {
  return (
    <div className="space-y-3 text-center" role="region" aria-label="Payment status">
      <div
        className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100"
        aria-hidden
      >
        <svg className="h-6 w-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} xmlns="http://www.w3.org/2000/svg">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h2 className="text-lg font-semibold text-foreground">
        Payment Already Processed
      </h2>
      <p className="text-sm text-muted-foreground">
        Your prescription order with {clinicName} has already been paid. If you
        have questions, please contact your clinic.
      </p>
    </div>
  )
}

function CancelledState({ clinicName }: { clinicName: string }) {
  return (
    <div className="space-y-3 text-center" role="alert">
      <div
        className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted"
        aria-hidden
      >
        <svg className="h-6 w-6 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} xmlns="http://www.w3.org/2000/svg">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </div>
      <h2 className="text-lg font-semibold text-foreground">
        Order No Longer Active
      </h2>
      <p className="text-sm text-muted-foreground">
        This prescription order is no longer available for payment. Please
        contact {clinicName} if you believe this is an error.
      </p>
    </div>
  )
}

// ============================================================
// MAIN COMPONENT
// ============================================================

interface Props {
  token:         string
  orderId:       string
  retailCents:   number
  clinicName:    string
  logoUrl:       string | null
  checkoutState: 'active' | 'paid' | 'cancelled_expired'
}

export function CheckoutPageContent({
  token,
  orderId,
  retailCents,
  clinicName,
  logoUrl,
  checkoutState,
}: Props) {
  const [clientSecret,   setClientSecret]   = useState<string | null>(null)
  const [fetchError,     setFetchError]     = useState<string | null>(null)
  const [payError,       setPayError]       = useState<string | null>(null)
  // WO-73: Track Stripe Elements readiness for 10s timeout
  const [stripeReady,    setStripeReady]    = useState(false)
  const [stripeTimeout,  setStripeTimeout]  = useState(false)

  // REQ-PSR-001: Fetch (or create) the PaymentIntent for this order
  useEffect(() => {
    if (checkoutState !== 'active') return

    fetch('/api/checkout/payment-intent', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token }),
    })
      .then(async res => {
        if (!res.ok) {
          const err = await res.json() as { error?: string }
          throw new Error(err.error ?? `HTTP ${res.status}`)
        }
        return res.json() as Promise<{ clientSecret: string }>
      })
      .then(data => setClientSecret(data.clientSecret))
      .catch(err => {
        console.error('[checkout] failed to load payment form:', err)
        setFetchError('Unable to load the payment form. Please try again or contact your clinic.')
      })
  }, [token, checkoutState])

  // WO-73: 10-second timeout for Stripe Elements iframe — common on restricted Wi-Fi
  useEffect(() => {
    if (!clientSecret || stripeReady) return
    const timer = setTimeout(() => {
      setStripeTimeout(true)
    }, 10_000)
    return () => clearTimeout(timer)
  }, [clientSecret, stripeReady])

  return (
    <>
      {/* WO-73: Sticky header — backdrop-blur, CompoundIQ wordmark + clinic name */}
      <header className="sticky top-0 z-10 flex h-12 items-center justify-between border-b border-border bg-background/95 px-4 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary" aria-hidden>
            <svg width="12" height="12" viewBox="0 0 32 32" fill="none">
              <rect x="4"  y="4"  width="11" height="11" rx="2" fill="white" fillOpacity="0.95" />
              <rect x="18" y="4"  width="11" height="11" rx="2" fill="white" fillOpacity="0.6" />
              <rect x="4"  y="18" width="11" height="11" rx="2" fill="white" fillOpacity="0.6" />
              <rect x="18" y="18" width="11" height="11" rx="2" fill="white" fillOpacity="0.3" />
            </svg>
          </div>
          <span className="text-sm font-bold text-foreground">CompoundIQ</span>
        </div>
        <span className="max-w-[160px] truncate text-sm text-muted-foreground">{clinicName}</span>
      </header>

      <main className="flex flex-col items-center px-4 pb-10 pt-6" aria-label="Checkout">
        <div className="w-full max-w-[480px] space-y-4">

          {/* WO-73: Order summary card — "Amount due" label + 32px amount */}
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            {logoUrl && (
              <img
                src={logoUrl}
                alt={`${clinicName} logo`}
                className="mb-4 h-10 w-auto max-w-[140px] object-contain"
              />
            )}
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Amount due
            </p>
            <div className="mt-2 flex items-start justify-between gap-4">
              <div>
                {/* REQ-GCX-008: Generic description — no medication name or diagnosis */}
                <p className="text-sm font-medium text-foreground">Prescription Service</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{clinicName}</p>
              </div>
              <p
                className="shrink-0 text-3xl font-bold text-foreground"
                aria-label={`Amount due: ${toCurrency(retailCents)}`}
              >
                {toCurrency(retailCents)}
              </p>
            </div>
          </div>

          {/* State-specific content */}
          {checkoutState === 'paid' && (
            <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <PaidState clinicName={clinicName} />
            </div>
          )}

          {checkoutState === 'cancelled_expired' && (
            <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <CancelledState clinicName={clinicName} />
            </div>
          )}

          {checkoutState === 'active' && (
            <div className="rounded-xl border border-border bg-card p-5 shadow-sm">

              {/* Error: payment-intent fetch failed */}
              {fetchError && (
                <div
                  role="alert"
                  className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
                >
                  {fetchError}
                </div>
              )}

              {/* WO-73: Error: card declined or payment failed — aria-live for screen readers */}
              {payError && (
                <div
                  role="alert"
                  aria-live="assertive"
                  className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700"
                >
                  <svg className="mt-0.5 h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  {payError}
                </div>
              )}

              {/* WO-73: Stripe iframe load timeout — shown if Stripe doesn't load within 10s */}
              {stripeTimeout && !stripeReady && (
                <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
                  <p className="font-medium">Unable to load secure payment form</p>
                  <p className="mt-1 text-xs">
                    This may be due to network restrictions. Try connecting to a different network
                    or contact your clinic.
                  </p>
                </div>
              )}

              {/* WO-73: Skeleton — shown before clientSecret arrives.
                  NOTE: we do NOT hide Elements after clientSecret loads — sr-only would
                  prevent Stripe's iframe from initializing (clip/size restrictions).
                  The brief transition from skeleton to Elements is acceptable. */}
              {!fetchError && !stripeTimeout && !clientSecret && (
                <div className="space-y-3" aria-busy="true" aria-label="Loading payment form">
                  <div className="h-12 animate-pulse rounded-lg bg-muted" />
                  <div className="h-12 animate-pulse rounded-lg bg-muted" />
                  <div className="h-14 animate-pulse rounded-lg bg-muted" />
                </div>
              )}

              {/* Stripe Elements — rendered immediately when clientSecret available. */}
              {clientSecret && !stripeTimeout && (
                <Elements
                  stripe={stripePromise}
                  options={{
                    clientSecret,
                    appearance: {
                      theme:     'stripe',
                      variables: {
                        // NB-3: #2563EB matches --primary (blue-600), not indigo-600
                        colorPrimary:  '#2563EB',
                        borderRadius:  '8px',
                        fontFamily:    'ui-sans-serif, system-ui, sans-serif',
                        // WO-73: 16px minimum prevents iOS auto-zoom on input focus
                        fontSizeBase:  '16px',
                      },
                    },
                  }}
                >
                  <PaymentForm
                    retailCents={retailCents}
                    onError={setPayError}
                    onReady={() => setStripeReady(true)}
                  />
                </Elements>
              )}

            </div>
          )}

          {/* WO-73: Trust badges — 🔒 256-bit TLS + ⚡ Stripe only. NO HIPAA badge (legal risk). */}
          <div className="space-y-1.5 text-center">
            <div className="flex items-center justify-center gap-5 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                  <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                </svg>
                256-bit TLS Encryption
              </span>
              <span className="flex items-center gap-1.5">
                <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                  <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
                </svg>
                Powered by Stripe
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Your payment info is encrypted and never stored by CompoundIQ.
            </p>
          </div>

        </div>
      </main>
    </>
  )
}
