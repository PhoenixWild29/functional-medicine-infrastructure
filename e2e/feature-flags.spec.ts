import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { seedStaticData, cleanupTestOrders, TEST_IDS } from './fixtures/seed'
import { generateCheckoutToken } from '../src/lib/auth/checkout-token'

// ============================================================
// Feature Flag E2E — WO-69
// ============================================================
// Verifies that TWILIO_ENABLED=false and DOCUMO_ENABLED=false
// correctly suppress external service calls in CI / POC environments.
//
// Twilio test:
//   Walks the cascading prescription builder (WO-80/82/83/85/86/87),
//   signs & sends, then asserts NO sms_log row is created for the order
//   — sendSms() returns early before any DB insert when TWILIO_ENABLED=false.
//
// Documo test (STRIPE_WEBHOOK_FORWARDING required):
//   Creates a Tier 4 (fax) order via DB, completes Stripe checkout,
//   polls orders.documo_fax_id for the synthetic
//   poc-disabled-fax-{orderId[0..7]}-attempt{N} value written by the
//   tier4-fax adapter when DOCUMO_ENABLED=false.
//
// Required env vars:
//   E2E_SUPABASE_URL, E2E_SUPABASE_SERVICE_ROLE_KEY — all tests
//   JWT_SECRET, CHECKOUT_TOKEN_EXPIRY — Documo test (generateCheckoutToken)

const STRIPE_TEST_CARD = {
  number: '4242424242424242',
  expiry: '12/30',
  cvc:    '123',
  zip:    '10001',
}

test.describe('Feature Flags — External Service Suppression', () => {
  test.beforeAll(async () => {
    await seedStaticData()
  })

  test.afterEach(async () => {
    await cleanupTestOrders()
  })

  // ── Twilio: TWILIO_ENABLED=false ──────────────────────────────
  // SKIPPED: this test's purpose is "when clicking Sign & Send in the UI,
  // no sms_log row is created because TWILIO_ENABLED=false is set." The
  // Sign & Send button cannot be enabled in headless Playwright because
  // react-signature-canvas's underlying signature_pad library does not
  // register dispatched pointer events (four event-dispatch strategies
  // verified across two dispatch cycles — see cowork review #5 in the
  // e2e-refresh campaign log). Without a captured signature the button
  // stays disabled and handleSignAndSend never runs.
  //
  // Follow-up (tracked as backlog before PR 7 merges): convert this to
  // an API-level integration test that POSTs to /api/orders/{id}/sign
  // with a stub signatureDataUrl, then asserts sms_log count = 0 for
  // the order. That exercises the suppression path (TWILIO_ENABLED=false
  // short-circuit in src/lib/sms/sender.ts) without depending on the
  // canvas stroke being recognised.
  test.skip('TWILIO_ENABLED=false: no sms_log row created when payment link is sent', async ({ page: _page }) => {
    void _page
    // Body intentionally omitted — see skip rationale above.
  })

  // ── Documo: DOCUMO_ENABLED=false ─────────────────────────────
  test('DOCUMO_ENABLED=false: synthetic fax ID written to orders.documo_fax_id', async ({ page }) => {
    if (!process.env['STRIPE_WEBHOOK_FORWARDING']) {
      test.skip(true, 'STRIPE_WEBHOOK_FORWARDING not set — Stripe CLI webhook forwarding required for this test')
    }

    // Documo polling (up to 60 s) + Stripe iframe interaction — extend timeout
    test.setTimeout(90_000)

    const supabase = createClient(
      process.env['E2E_SUPABASE_URL']!,
      process.env['E2E_SUPABASE_SERVICE_ROLE_KEY']!
    )

    // ── 1. Create a Tier 4 (fax) order directly via DB ──────────
    // Tier 4 pharmacy (pharmacyTier4) routes through the Documo fax adapter.
    // Creating via DB avoids needing a UI pharmacy selection for Tier 4.
    const { data: order } = await supabase
      .from('orders')
      .insert({
        patient_id:               TEST_IDS.patient,
        provider_id:              TEST_IDS.provider,
        catalog_item_id:          TEST_IDS.catalogItem,
        clinic_id:                TEST_IDS.clinic,
        pharmacy_id:              TEST_IDS.pharmacyTier4,
        status:                   'AWAITING_PAYMENT',
        quantity:                 1,
        wholesale_price_snapshot: 100.00,
        retail_price_snapshot:    200.00,
        sig_text:                 'Feature flag E2E — Documo suppression check',
        locked_at:                new Date().toISOString(),
      })
      .select('order_id')
      .single()

    if (!order) throw new Error('Feature flag test: failed to create Tier 4 test order')

    // ── 2. Patient completes Stripe test checkout ───────────────
    const token = await generateCheckoutToken(order.order_id, TEST_IDS.patient, TEST_IDS.clinic)
    await page.goto(`/checkout/${token}`)
    await expect(page.getByText('$200.00')).toBeVisible({ timeout: 10_000 })

    const stripeFrame = page.frameLocator('iframe[title*="Secure payment"]').first()
    await stripeFrame.getByLabel('Card number').fill(STRIPE_TEST_CARD.number)
    await stripeFrame.getByLabel('Expiration date').fill(STRIPE_TEST_CARD.expiry)
    await stripeFrame.getByLabel('Security code').fill(STRIPE_TEST_CARD.cvc)
    await stripeFrame.getByLabel('ZIP').fill(STRIPE_TEST_CARD.zip)
    await page.getByRole('button', { name: /Pay/i }).click()
    await expect(page.getByText(/Payment Received/i)).toBeVisible({ timeout: 30_000 })

    // ── 3. Poll for Documo fax dispatch ─────────────────────────
    // When DOCUMO_ENABLED=false, tier4-fax adapter writes:
    //   poc-disabled-fax-{orderId.slice(0,8)}-attempt{N}
    // to orders.documo_fax_id after the dispatch step executes.
    let faxId: string | null = null
    let finalStatus: string | null = null
    for (let i = 0; i < 30; i++) {
      const { data } = await supabase
        .from('orders')
        .select('documo_fax_id, status')
        .eq('order_id', order.order_id)
        .single()
      faxId = data?.documo_fax_id ?? null
      finalStatus = data?.status ?? null
      if (faxId) break
      await new Promise(r => setTimeout(r, 2_000))
    }

    // ── 4. Assert synthetic fax ID and order status ─────────────
    expect(faxId).not.toBeNull()
    // Full pattern: poc-disabled-fax-{8-char hex orderId prefix}-attempt{N}
    expect(faxId).toMatch(/^poc-disabled-fax-[a-f0-9]{8}-attempt\d+$/)
    // Order must have transitioned to FAX_QUEUED — CAS in tier4-fax adapter
    expect(finalStatus).toBe('FAX_QUEUED')
  })
})
