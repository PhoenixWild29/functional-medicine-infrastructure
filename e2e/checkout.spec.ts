import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
// NOTE: importing generateCheckoutToken directly from source (not via HTTP) is intentional.
// It avoids exposing SUPABASE_SERVICE_ROLE_KEY as a bearer token over a local HTTP call.
// Trade-off: these tests must run with the source tree present (CI only, not against deployed prod).
import { generateCheckoutToken } from '../src/lib/auth/checkout-token'
import { cleanupTestOrders, TEST_IDS, TEST_USERS } from './fixtures/seed'

// ============================================================
// Patient Checkout E2E — WO-42
// ============================================================
// Tests the patient checkout flow:
//   Receive checkout URL → Enter payment → Confirm order

// Stripe test card details (test mode only)
const STRIPE_TEST_CARD = {
  number:  '4242424242424242',
  expiry:  '12/30',
  cvc:     '123',
  zip:     '10001',
}

test.describe('Patient Checkout Flow', () => {
  let checkoutToken: string
  let testOrderId: string

  test.beforeAll(async () => {
    // Create a test order in AWAITING_PAYMENT state using the service_role client directly
    const supabase = createClient(
      process.env['SUPABASE_URL']!,
      process.env['SUPABASE_SERVICE_ROLE_KEY']!
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

  test('patient can complete checkout on mobile viewport', async ({ page }) => {
    // ── 1. Open checkout URL ──────────────────────────────────
    await page.goto(`/checkout/${checkoutToken}`)

    // ── 2. Verify clinic logo and generic order summary ───────
    await expect(page.getByAltText(/clinic logo/i)).toBeVisible()
    // No medication name should appear (HIPAA — not shown on checkout page)
    await expect(page.getByText(/test compound/i)).not.toBeVisible()

    // ── 3. Verify order amount displayed ─────────────────────
    await expect(page.getByText('$200.00')).toBeVisible()

    // ── 4. Enter Stripe test card ─────────────────────────────
    // Stripe Elements renders in an iframe
    const stripeFrame = page.frameLocator('iframe[title*="Secure payment"]').first()
    await stripeFrame.getByLabel('Card number').fill(STRIPE_TEST_CARD.number)
    await stripeFrame.getByLabel('Expiration date').fill(STRIPE_TEST_CARD.expiry)
    await stripeFrame.getByLabel('Security code').fill(STRIPE_TEST_CARD.cvc)
    await stripeFrame.getByLabel('ZIP').fill(STRIPE_TEST_CARD.zip)

    // ── 5. Submit payment ─────────────────────────────────────
    await page.getByRole('button', { name: /Pay/i }).click()

    // ── 6. Verify confirmation page ───────────────────────────
    // Stripe redirects to /checkout/success — success page shows "Payment Received"
    await expect(page.getByText(/Payment Received/i)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(/Your prescription order/i)).toBeVisible()
  })

  test('expired token shows error page', async ({ page }) => {
    await page.goto('/checkout/invalid-token-that-does-not-exist')
    await expect(page.getByText(/link has expired/i).or(page.getByText(/not found/i))).toBeVisible()
  })
})
