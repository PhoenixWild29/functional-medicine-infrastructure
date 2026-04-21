import { test, expect, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { seedStaticData, cleanupTestOrders, TEST_IDS, TEST_USERS, TEST_CATALOG } from './fixtures/seed'

// ============================================================
// Clinic App E2E — cascading prescription builder (WO-80/82/83/85/86/87)
// ============================================================
// The new-prescription flow is:
//   Step 0: /new-prescription           — patient + provider selection
//   Step 1: /new-prescription/search    — cascading ingredient → formulation →
//                                         pharmacy, with structured sig builder
//   Step 2: /new-prescription/margin    — retail price (sig pre-fills from Step 1)
//   Step 3: /new-prescription/review    — batch review + signature + send
//
// The Zero-PHI describe block below inserts directly into `orders` and does
// NOT use the UI wizard.

// ── Shared wizard navigation helper ──────────────────────────────────────────
//
// Walks Steps 0-2 and leaves the browser on /new-prescription/review with the
// signature canvas ready to be drawn on. The seed ingredient has
// dea_schedule=null, so no EPCS TOTP gate fires — callers can proceed straight
// to canvas interaction.
//
// Prerequisites: seedStaticData must have run (seeds V3 hierarchical catalog).

async function navigateToReviewPage(
  page: Page,
  { retailPrice = '200.00' }: { retailPrice?: string } = {},
) {
  // ── Step 0: Patient + provider selection ──────────────────
  await page.goto('/new-prescription')

  // Patient: type first name into the search box, then click the result.
  // The UI renders patient buttons as "{last_name}, {first_name}".
  await page.getByLabel('Search patients').fill('Test')
  await page.getByRole('button', { name: /Patient,\s*Test/i }).click()

  // Provider: only one provider seeded per clinic, so the UI auto-selects
  // it (patient-provider-selector.tsx handles this). No click needed — the
  // Continue button becomes enabled as soon as patient is chosen.
  await page.getByRole('button', { name: 'Continue to Pharmacy Search' }).click()

  // ── Step 1: Cascading prescription builder ────────────────
  await expect(page).toHaveURL(/\/new-prescription\/search/, { timeout: 10_000 })

  // Ingredient search — aria-label added in this PR for stable selection.
  await page.getByLabel('Search medications').fill('Test Compound')
  await page.getByRole('button', { name: new RegExp(TEST_CATALOG.ingredientName, 'i') }).click()

  // Salt form: only one per ingredient, so the builder auto-selects and the
  // salt-form picker section does not render (see cascading-prescription-
  // builder.tsx — section is gated on saltForms.length > 1).

  // Formulation.
  await page.getByRole('button', { name: new RegExp(TEST_CATALOG.formulationName, 'i') }).click()

  // Structured sig: dose 10 mg, daily, morning, 30 days. aria-labels added
  // in this PR. Any valid combination that yields a ≥10-char sig preview
  // satisfies the "Continue" button's canAdd gate.
  await page.getByLabel('Dose amount').fill('10')
  await page.getByLabel('Dose unit').selectOption('mg')
  await page.getByLabel('Frequency').selectOption('QD')
  // Timing defaults to the first option; explicitly set for determinism.
  await page.getByLabel('Timing').selectOption({ index: 1 })
  await page.getByLabel('Duration').selectOption({ index: 1 })

  // Pharmacy — auto-populates once formulation is set; click by name.
  await page.getByRole('button', { name: /Test Pharmacy Tier1/ }).click()

  // Advance to margin.
  await page.getByRole('button', { name: /Continue.*Set Retail Price/i }).click()

  // ── Step 2: Margin builder ────────────────────────────────
  await expect(page).toHaveURL(/\/new-prescription\/margin/, { timeout: 10_000 })
  await page.locator('#retail-price').fill(retailPrice)

  // Sig was already computed in Step 1; it pre-fills on this page via URL
  // param. We do not re-fill #sig-text here — just advance.

  // Button is "Review & Send" (or "Review & Send (N)" when batching).
  await page.getByRole('button', { name: /Review & Send/ }).click()

  // ── Step 3: Review page (signature canvas ready) ──────────
  await expect(page).toHaveURL(/\/new-prescription\/review/, { timeout: 10_000 })
}

test.describe('Clinic App — Order Creation Flow', () => {
  test.beforeAll(async () => {
    await seedStaticData()
  })

  test.afterEach(async () => {
    await cleanupTestOrders()
  })

  test('MA can walk the cascading builder to the review page', async ({ page }) => {
    // ── 1. Login as clinic admin ──────────────────────────────
    await page.goto('/login')
    await page.getByLabel('Email').fill(TEST_USERS.clinicAdmin.email)
    await page.getByLabel('Password').fill(TEST_USERS.clinicAdmin.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 })

    // ── 2. Walk all 4 wizard steps ───────────────────────────
    // Patient → cascading builder → margin → review.
    await navigateToReviewPage(page)

    // ── 3. Verify the review page is correctly initialised ───
    // Coverage note — signature drawing is NOT E2E-tested:
    //   Playwright's input-synthesis layer cannot reliably trigger
    //   react-signature-canvas's underlying signature_pad in headless
    //   CI. page.mouse.* dispatches MouseEvents (signature_pad v4 only
    //   listens to pointer events); locator.dispatchEvent('pointerdown')
    //   constructs a plain Event instead of a PointerEvent (coords
    //   lost); page.evaluate with native PointerEvent also failed on
    //   chromium after two dispatch verifications. Documented in
    //   cowork review #5; decisive fallback is to split coverage by
    //   layer:
    //     - This E2E test: verify the canvas mounts + Sign & Send is
    //       disabled without a signature (proves the state machine is
    //       in its initial, safe state).
    //     - Manual QA pre-launch: draw an actual signature on the live
    //       demo and verify the order submit flow completes.
    //     - Follow-up: component-level unit test of BatchReviewForm's
    //       signature state transitions (mocks react-signature-canvas
    //       so onEnd can be triggered deterministically).
    await expect(
      page.locator('canvas[aria-label="Provider signature pad"]')
    ).toBeVisible({ timeout: 15_000 })
    await expect(
      page.getByRole('button', { name: /Sign & Send/ })
    ).toBeDisabled()
  })

  test('retail price validation rejects price below wholesale', async ({ page }) => {
    // ── 1. Login ──────────────────────────────────────────────
    await page.goto('/login')
    await page.getByLabel('Email').fill(TEST_USERS.clinicAdmin.email)
    await page.getByLabel('Password').fill(TEST_USERS.clinicAdmin.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 })

    // ── 2. Walk Steps 0-1 of the cascading builder ───────────
    await page.goto('/new-prescription')
    await page.getByLabel('Search patients').fill('Test')
    await page.getByRole('button', { name: /Patient,\s*Test/i }).click()
    await page.getByRole('button', { name: 'Continue to Pharmacy Search' }).click()

    await expect(page).toHaveURL(/\/new-prescription\/search/, { timeout: 10_000 })
    await page.getByLabel('Search medications').fill('Test Compound')
    await page.getByRole('button', { name: new RegExp(TEST_CATALOG.ingredientName, 'i') }).click()
    await page.getByRole('button', { name: new RegExp(TEST_CATALOG.formulationName, 'i') }).click()
    await page.getByLabel('Dose amount').fill('10')
    await page.getByLabel('Dose unit').selectOption('mg')
    await page.getByLabel('Frequency').selectOption('QD')
    await page.getByLabel('Timing').selectOption({ index: 1 })
    await page.getByLabel('Duration').selectOption({ index: 1 })
    await page.getByRole('button', { name: /Test Pharmacy Tier1/ }).click()
    await page.getByRole('button', { name: /Continue.*Set Retail Price/i }).click()

    // ── 3. On margin page: set retail BELOW wholesale ($100) ──
    await expect(page).toHaveURL(/\/new-prescription\/margin/, { timeout: 10_000 })
    await page.locator('#retail-price').fill('50.00')

    // ── 4. Verify inline error appears ───────────────────────
    // REQ-DMB-005: "Retail price must be at least the wholesale cost ($100.00)."
    await expect(
      page.getByText(/retail price must be at least/i)
    ).toBeVisible()

    // "Review & Send" button should be disabled while retail < wholesale.
    await expect(
      page.getByRole('button', { name: /Review & Send/ })
    ).toBeDisabled()
  })
})

test.describe('Clinic App — 8-Step Order Happy Path', () => {
  // This test covers the full lifecycle from order creation through payment confirmation
  // and into the ops dashboard. Steps 3+ depend on Stripe test webhook delivery.
  //
  // Prerequisites for this test to pass end-to-end:
  //   - STRIPE_WEBHOOK_FORWARDING=1 env var set (set by CI job that runs stripe listen)
  //   - Stripe CLI webhook forwarding active (stripe listen --forward-to ...)
  //   - DOCUMO_ENABLED=false (Tier 4 fax suppressed; uses synthetic fax ID)
  //
  // If STRIPE_WEBHOOK_FORWARDING is not set, this test is skipped with a clear message
  // rather than timing out after 60s with a cryptic error.

  const STRIPE_TEST_CARD = {
    number:  '4242424242424242',
    expiry:  '12/30',
    cvc:     '123',
    zip:     '10001',
  }

  test.beforeAll(async () => {
    await seedStaticData()
  })

  test.afterEach(async () => {
    await cleanupTestOrders()
  })

  test('order progresses AWAITING_PAYMENT → PAID_PROCESSING via Stripe test payment', async ({ page }) => {
    if (!process.env['STRIPE_WEBHOOK_FORWARDING']) {
      test.skip(true, 'STRIPE_WEBHOOK_FORWARDING not set — Stripe CLI webhook forwarding required for this test')
    }
    const supabase = createClient(
      process.env['E2E_SUPABASE_URL']!,
      process.env['E2E_SUPABASE_SERVICE_ROLE_KEY']!
    )

    // ── Step 1: Insert an AWAITING_PAYMENT order directly ─────
    // The cascading-builder → sign-and-send flow cannot be driven from
    // Playwright (signature_pad in headless CI ignores dispatched pointer
    // events — see e2e/clinic-app.spec.ts:97 coverage note). To still
    // exercise the Stripe payment and webhook-driven status transitions
    // that this test is actually about, we seed the order directly via
    // the service-role client, the same pattern the Zero-PHI test uses.
    const { data: inserted, error: insertErr } = await supabase
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
        sig_text:                 '8-step happy path E2E test sig text',
        locked_at:                new Date().toISOString(),
      })
      .select('order_id')
      .single()
    if (insertErr || !inserted) {
      throw new Error(`Failed to seed 8-step happy-path order: ${insertErr?.message}`)
    }

    // ── Step 2: Find the created order ID from DB ─────────────
    // Kept the same select-most-recent query for symmetry with how a
    // real user flow would land an order here.
    const { data: recent } = await supabase
      .from('orders')
      .select('order_id')
      .eq('clinic_id', TEST_IDS.clinic)
      .eq('status', 'AWAITING_PAYMENT')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    const createdOrderId = recent?.order_id ?? null
    if (!createdOrderId) {
      throw new Error('8-step happy path: could not find created order ID')
    }

    // ── Step 3: Patient completes Stripe payment ──────────────
    // Generate checkout token for the order
    const { generateCheckoutToken } = await import('../src/lib/auth/checkout-token')
    const token = await generateCheckoutToken(createdOrderId, TEST_IDS.patient, TEST_IDS.clinic)

    // Open checkout as patient
    const checkoutPage = await page.context().newPage()
    await checkoutPage.goto(`/checkout/${token}`)
    await expect(checkoutPage.getByText('$200.00')).toBeVisible({ timeout: 10_000 })

    // Enter Stripe test card
    const stripeFrame = checkoutPage.frameLocator('iframe[title*="Secure payment"]').first()
    await stripeFrame.getByLabel('Card number').fill(STRIPE_TEST_CARD.number)
    await stripeFrame.getByLabel('Expiration date').fill(STRIPE_TEST_CARD.expiry)
    await stripeFrame.getByLabel('Security code').fill(STRIPE_TEST_CARD.cvc)
    await stripeFrame.getByLabel('ZIP').fill(STRIPE_TEST_CARD.zip)

    await checkoutPage.getByRole('button', { name: /Pay/i }).click()
    // Stripe redirects to /checkout/success — success page title is "Payment Received"
    await expect(checkoutPage.getByText(/Payment Received/i)).toBeVisible({ timeout: 30_000 })

    // ── Step 4: Stripe webhook triggers PAID_PROCESSING ───────
    // Wait for Stripe webhook to be processed (requires Stripe CLI forward)
    // Poll the DB for status transition
    let status = 'AWAITING_PAYMENT'
    for (let i = 0; i < 30; i++) {
      const { data } = await supabase
        .from('orders')
        .select('status')
        .eq('order_id', createdOrderId)
        .single()
      status = data?.status ?? status
      if (status === 'PAID_PROCESSING' || status === 'SUBMISSION_PENDING' || status === 'FAX_QUEUED') break
      await new Promise(r => setTimeout(r, 2_000))
    }

    expect(['PAID_PROCESSING', 'SUBMISSION_PENDING', 'FAX_QUEUED']).toContain(status)

    // ── Step 8: Order visible in ops pipeline ──────────────────
    // Login as ops admin in a new page and verify order is visible
    const opsPage = await page.context().newPage()
    await opsPage.goto('/login')
    await opsPage.getByLabel('Email').fill(TEST_USERS.opsAdmin.email)
    await opsPage.getByLabel('Password').fill(TEST_USERS.opsAdmin.password)
    await opsPage.getByRole('button', { name: 'Sign in' }).click()
    await expect(opsPage).toHaveURL(/\/ops\/pipeline/, { timeout: 15_000 })

    // The order should appear in the pipeline (data-order-id attribute on <tr>)
    await expect(
      opsPage.locator(`[data-order-id="${createdOrderId}"]`)
    ).toBeVisible({ timeout: 10_000 })

    await checkoutPage.close()
    await opsPage.close()
  })
})

test.describe('Clinic App — Order Zero-PHI Validation', () => {
  // REQ-HIPAA: Order creation and dashboard pages must not display
  // medication name, dosage, or pharmacy name in patient-facing views.
  // This test verifies that the patient checkout page shows no PHI.

  // seedStaticData is normally called by globalSetup, but this describe block
  // inserts directly into `orders` referencing clinic/provider/patient/pharmacy/catalog
  // rows by FK. Re-running ensures they exist even if global-setup rows were cleared.
  test.beforeAll(async () => {
    await seedStaticData()
  })

  test('checkout page shows no medication name (zero-PHI compliance)', async ({ page }) => {
    const supabase = createClient(
      process.env['E2E_SUPABASE_URL']!,
      process.env['E2E_SUPABASE_SERVICE_ROLE_KEY']!
    )

    const { data: order } = await supabase
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
        sig_text:                 'PHI validation test order',
        locked_at:                new Date().toISOString(),
      })
      .select('order_id')
      .single()

    if (!order) throw new Error('Failed to create test order for PHI validation')

    const { generateCheckoutToken } = await import('../src/lib/auth/checkout-token')
    const token = await generateCheckoutToken(order.order_id, TEST_IDS.patient, TEST_IDS.clinic)

    await page.goto(`/checkout/${token}`)
    await expect(page.getByText('$200.00')).toBeVisible({ timeout: 10_000 })

    // Medication name must NOT appear on checkout page (HIPAA minimum necessary)
    await expect(page.getByText(/Test Compound Injectable/i)).not.toBeVisible()
    // Pharmacy name must NOT appear on checkout page
    await expect(page.getByText(/Test Pharmacy Tier1/i)).not.toBeVisible()
    // Sig text / dosage instructions must NOT appear
    await expect(page.getByText(/PHI validation test order/i)).not.toBeVisible()

    await supabase
      .from('orders')
      .update({ is_active: false, deleted_at: new Date().toISOString() })
      .eq('order_id', order.order_id)
  })
})
