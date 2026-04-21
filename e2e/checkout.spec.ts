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

    // Clinic branding renders
    await expect(page.getByText('Test Clinic E2E')).toBeVisible()
  })

  // ── Test B — API-level PaymentIntent round-trip, browserless ──
  // Scoped to a single project to avoid running the same non-browser logic
  // once per browser configuration. The `chromium` project is the natural
  // home because it also runs the rest of this spec via Test A.
  test('checkout token creates a valid PaymentIntent and confirms', async ({
    baseURL,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'API-level test runs once per suite')
    test.skip(!process.env['STRIPE_SECRET_KEY'], 'STRIPE_SECRET_KEY required for API confirmation')

    // 1. POST to our API — same path the checkout page client uses
    const response = await fetch(`${baseURL}/api/checkout/payment-intent`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token: checkoutToken }),
    })
    expect(response.ok).toBe(true)

    const body = await response.json() as { clientSecret: string }
    expect(body.clientSecret).toMatch(/^pi_[a-zA-Z0-9]+_secret_/)

    // Extract the PaymentIntent ID from the client secret
    const piId = body.clientSecret.split('_secret_')[0]
    if (!piId) throw new Error(`Unexpected client secret shape: ${body.clientSecret}`)
    expect(piId).toMatch(/^pi_/)

    // 2. Confirm the PaymentIntent with Stripe's test card (succeeds immediately
    //    in test mode — no 3DS challenge on pm_card_visa).
    const stripe = new Stripe(process.env['STRIPE_SECRET_KEY']!)
    const intent = await stripe.paymentIntents.confirm(piId, {
      payment_method: 'pm_card_visa',
    })
    expect(intent.status).toBe('succeeded')

    // 3. If Stripe CLI webhook forwarding is running (manual / STRIPE_WEBHOOK_FORWARDING=1),
    //    poll the orders table for the expected status transition. Otherwise the
    //    confirmed-PI assertion above is the terminal check — downstream webhook
    //    handler coverage belongs to the 8-step happy path in clinic-app.spec.ts.
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
