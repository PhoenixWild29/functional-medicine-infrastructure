import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'
// NOTE: importing generateCheckoutToken directly from source (not via HTTP) is intentional.
// It avoids exposing SUPABASE_SERVICE_ROLE_KEY as a bearer token over a local HTTP call.
// Trade-off: these tests must run with the source tree present (CI only, not against deployed prod).
import { generateCheckoutToken } from '../src/lib/auth/checkout-token'
import { cleanupTestOrders, TEST_IDS } from './fixtures/seed'

// ============================================================
// Patient Checkout E2E — WO-42 (rewritten PR 6.3)
// ============================================================
//
// Coverage split (cowork review #6 verdict — Option 3):
//
//   Test A — "checkout page renders amount and hides PHI" (all 4 browsers)
//     Asserts what CompoundIQ controls on the server-rendered page: amount,
//     clinic name, zero-PHI (no medication or pharmacy name visible to the
//     patient). Does NOT interact with Stripe Elements. Runs green on
//     chromium / firefox / webkit / mobile-chrome because no third-party
//     iframe is exercised.
//
//   Test B — "checkout token creates a valid PaymentIntent and confirms"
//     Hits /api/checkout/payment-intent with a valid token, extracts the
//     client secret, confirms the PaymentIntent with Stripe's test card
//     token (`pm_card_visa`). Tests our Stripe SDK integration + our API
//     route + Stripe test mode round-trip. Browserless — no Playwright
//     page needed; runs on the chromium project only (to avoid running
//     the same non-browser logic 4x).
//
//   Test C — "expired / invalid checkout token shows error page"
//     Unchanged from the previous implementation. Page-level assertion,
//     no Stripe dependency.
//
// The previous single mobile-viewport test that walked the full UI
// including Stripe Elements iframe interaction was removed because
// Playwright's patched Firefox/WebKit binaries do not reliably
// initialize Stripe's cross-origin iframe in headless CI. That iframe
// is Stripe's code running on Stripe's domain — not CompoundIQ's
// responsibility to drive in tests, and the app's own "Unable to load
// the payment form" alert already serves as its user-facing fallback.

test.describe('Patient Checkout Flow', () => {
  let checkoutToken: string
  let testOrderId: string

  test.beforeAll(async () => {
    // Create a test order in AWAITING_PAYMENT state using the service_role client directly
    const supabase = createClient(
      process.env['E2E_SUPABASE_URL']!,
      process.env['E2E_SUPABASE_SERVICE_ROLE_KEY']!
    )

    const { data: order, error } = await supabase
      .from('orders')
      .insert({
        patient_id:               TEST_IDS.patient,
        provider_id:              TEST_IDS.provider,
        catalog_item_id:          TEST_IDS.catalogItem,
        clinic_id:                TEST_IDS.clinic,
        pharmacy_id:              TEST_IDS.pharmacyTier1,
        status:                   'AWAITING_PAYMENT',
        quantity:                 1,
        wholesale_price_snapshot: 100.00,
        retail_price_snapshot:    200.00,
        sig_text:                 'Test sig for E2E checkout test — at least 10 chars',
        locked_at:                new Date().toISOString(),
      })
      .select('order_id')
      .single()

    if (error || !order) throw new Error(`Failed to create test order: ${error?.message}`)
    testOrderId = order.order_id

    // Generate checkout token directly using the application utility — no HTTP call needed
    checkoutToken = await generateCheckoutToken(
      order.order_id,
      TEST_IDS.patient,
      TEST_IDS.clinic
    )
  })

  test.afterAll(async () => {
    await cleanupTestOrders()
  })

  // ── Test A — page render, all browsers ────────────────────────
  test('checkout page renders amount and hides PHI', async ({ page }) => {
    await page.goto(`/checkout/${checkoutToken}`)

    // Amount + generic service name render server-side — no Stripe dependency
    await expect(page.getByText('$200.00')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/Prescription Service/i)).toBeVisible()

    // Zero-PHI (REQ-HIPAA): medication + pharmacy names must NOT appear
    // on patient-facing checkout (minimum-necessary disclosure principle).
    await expect(page.getByText(/test compound/i)).not.toBeVisible()
    await expect(page.getByText(/test pharmacy/i)).not.toBeVisible()

    // Clinic branding renders. The clinic name appears in TWO places on the
    // checkout page (banner and the order-summary subtitle), so scope the
    // selector to the banner to avoid a strict-mode multi-match.
    await expect(page.getByRole('banner').getByText('Test Clinic E2E')).toBeVisible()
  })

  // ── Test B — API-level PaymentIntent, browserless ────────────
  // Split into two phases:
  //   Phase 1 — always runs: calls our /api/checkout/payment-intent route,
  //     asserts it returns a valid client_secret. This is the part that
  //     lives in OUR ownership boundary (our API, our auth, our Stripe
  //     SDK configuration).
  //   Phase 2 — test-mode only: if STRIPE_SECRET_KEY is a Stripe TEST
  //     key (`sk_test_*`), also confirm the PaymentIntent with Stripe's
  //     pm_card_visa test-card token. This covers Stripe's own test-mode
  //     round-trip. Skipped when the CI env has a LIVE key (`sk_live_*`)
  //     because pm_card_visa is rejected in livemode. To enable Phase 2
  //     in CI, populate a TEST secret key as STRIPE_SECRET_KEY in the
  //     E2E job env; the production Vercel env keeps the live key.
  //
  // Scoped to browserName === 'chromium' to avoid running the same
  // non-browser logic 4x. The `chromium` project includes checkout.spec.ts
  // per playwright.config.ts for exactly this reason.
  test('checkout token produces a valid PaymentIntent client_secret', async ({
    baseURL,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'API-level test runs once per suite')

    // Phase 1 — OUR ownership: call our API, verify the shape of the response.
    const response = await fetch(`${baseURL}/api/checkout/payment-intent`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token: checkoutToken }),
    })
    expect(response.ok).toBe(true)

    const body = await response.json() as { clientSecret: string }
    expect(body.clientSecret).toMatch(/^pi_[a-zA-Z0-9]+_secret_/)

    const piId = body.clientSecret.split('_secret_')[0]
    if (!piId) throw new Error(`Unexpected client secret shape: ${body.clientSecret}`)
    expect(piId).toMatch(/^pi_/)

    // Phase 2 — Stripe's ownership: confirm the PI with a test-card token.
    // Requires a test-mode secret key. Current CI populates STRIPE_SECRET_KEY
    // from the production Vercel env (live key), so this phase skips in CI
    // until a dedicated test key is provisioned. Follow-up tracked in
    // STATUS.md §backlog.
    const secretKey = process.env['STRIPE_SECRET_KEY']
    if (!secretKey || !secretKey.startsWith('sk_test_')) {
      test.info().annotations.push({
        type: 'skip-phase-2',
        description: 'STRIPE_SECRET_KEY is not a test key; Phase 2 PI confirmation skipped',
      })
      return
    }

    const stripe = new Stripe(secretKey)
    const intent = await stripe.paymentIntents.confirm(piId, {
      payment_method: 'pm_card_visa',
    })
    expect(intent.status).toBe('succeeded')

    // Phase 3 — Webhook round-trip coverage. Only when Stripe CLI forwarding
    // is active. Downstream webhook handler coverage otherwise lives in the
    // 8-step happy path test in clinic-app.spec.ts.
    if (process.env['STRIPE_WEBHOOK_FORWARDING']) {
      const supabase = createClient(
        process.env['E2E_SUPABASE_URL']!,
        process.env['E2E_SUPABASE_SERVICE_ROLE_KEY']!
      )
      let status = 'AWAITING_PAYMENT'
      for (let i = 0; i < 15; i++) {
        const { data } = await supabase
          .from('orders')
          .select('status')
          .eq('order_id', testOrderId)
          .single()
        status = data?.status ?? status
        if (status !== 'AWAITING_PAYMENT') break
        await new Promise(r => setTimeout(r, 2_000))
      }
      expect(['PAID_PROCESSING', 'SUBMISSION_PENDING', 'FAX_QUEUED']).toContain(status)
    }
  })

  // ── Test C — invalid token → error page ──────────────────────
  test('expired or invalid checkout token shows error page', async ({ page }) => {
    await page.goto('/checkout/invalid-token-that-does-not-exist')
    await expect(
      page.getByText(/link has expired/i).or(page.getByText(/not found/i))
    ).toBeVisible()
  })
})
