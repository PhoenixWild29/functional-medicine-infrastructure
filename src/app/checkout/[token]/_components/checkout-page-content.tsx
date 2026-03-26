'use client'

// ============================================================
// Checkout Page Content — WO-48 + WO-49
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
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

// ============================================================
// INNER PAYMENT FORM — WO-49
// ============================================================

interface PaymentFormProps {
  onError: (msg: string | null) => void
}

function PaymentForm({ onError }: PaymentFormProps) {
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
      // REQ-PSR-006: User-facing error messages for payment failures
      const userMessage =
        error.type === 'card_error' || error.type === 'validation_error'
          ? (error.message ?? 'Your payment could not be processed.')
          : 'An unexpected error occurred. Please try again.'
      onError(userMessage)
    }

    setIsSubmitting(false)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Stripe PaymentElement — handles card, Apple Pay, Google Pay — REQ-PSR-003 */}
      <PaymentElement
        options={{
          layout: 'tabs',
          wallets: { applePay: 'auto', googlePay: 'auto' },
        }}
      />

      <button
        type="submit"
        disabled={!stripe || !elements || isSubmitting}
        className="w-full rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
      >
        {isSubmitting ? 'Processing…' : 'Pay Now'}
      </button>

      <p className="text-center text-xs text-gray-500">
        Secured by{' '}
        <span className="font-medium text-gray-700">Stripe</span>
      </p>
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
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-6 w-6 text-emerald-600"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h2 className="text-lg font-semibold text-gray-900">
        Payment Already Processed
      </h2>
      <p className="text-sm text-gray-600">
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
        className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gray-100"
        aria-hidden
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-6 w-6 text-gray-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </div>
      <h2 className="text-lg font-semibold text-gray-900">
        Order No Longer Active
      </h2>
      <p className="text-sm text-gray-600">
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
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [fetchError,   setFetchError]   = useState<string | null>(null)
  const [payError,     setPayError]     = useState<string | null>(null)

  // REQ-PSR-001: Fetch (or create) the PaymentIntent for this order
  useEffect(() => {
    if (checkoutState !== 'active') return

    fetch('/api/checkout/payment-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
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

  return (
    <main className="flex min-h-screen flex-col items-center px-4 py-8 sm:py-12" aria-label="Checkout">
      <div className="w-full max-w-sm space-y-6">

        {/* Clinic branding — REQ-GCX-003 */}
        <div className="flex flex-col items-center space-y-2">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={`${clinicName} logo`}
              className="h-12 w-auto max-w-[160px] object-contain"
            />
          ) : (
            <div
              className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-100"
              aria-hidden
            >
              <span className="text-lg font-bold text-indigo-700">
                {clinicName.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
          <p className="text-sm font-medium text-gray-700">{clinicName}</p>
        </div>

        {/* Order summary — REQ-GCX-004 (generic language, zero PHI) */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Order Summary
          </p>
          <div className="mt-2 flex items-center justify-between">
            {/* REQ-GCX-008: Generic description — no medication name or diagnosis */}
            <span className="text-sm text-gray-700">Prescription Service</span>
            <span className="text-lg font-bold text-gray-900">
              {toCurrency(retailCents)}
            </span>
          </div>
        </div>

        {/* State-specific content */}
        {checkoutState === 'paid' && (
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <PaidState clinicName={clinicName} />
          </div>
        )}

        {checkoutState === 'cancelled_expired' && (
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <CancelledState clinicName={clinicName} />
          </div>
        )}

        {checkoutState === 'active' && (
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-4">
              <p className="text-sm font-medium text-gray-900">
                Complete Your Payment
              </p>
              <p className="mt-0.5 text-xs text-gray-500">
                Amount due: {toCurrency(retailCents)}
              </p>
            </div>

            {fetchError && (
              <div
                role="alert"
                className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              >
                {fetchError}
              </div>
            )}

            {payError && (
              <div
                role="alert"
                className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              >
                {payError}
              </div>
            )}

            {!fetchError && !clientSecret && (
              <div className="space-y-3" aria-busy="true" aria-label="Loading payment form">
                <div className="h-10 animate-pulse rounded-md bg-gray-200" />
                <div className="h-10 animate-pulse rounded-md bg-gray-200" />
                <div className="h-11 animate-pulse rounded-lg bg-gray-200" />
              </div>
            )}

            {clientSecret && (
              <Elements
                stripe={stripePromise}
                options={{
                  clientSecret,
                  appearance: {
                    theme: 'stripe',
                    variables: {
                      colorPrimary: '#4f46e5',
                      borderRadius: '8px',
                      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
                    },
                  },
                }}
              >
                <PaymentForm onError={setPayError} />
              </Elements>
            )}
          </div>
        )}

        <p className="text-center text-xs text-gray-400">
          This is a secure, encrypted checkout powered by Stripe.
        </p>
      </div>
    </main>
  )
}
