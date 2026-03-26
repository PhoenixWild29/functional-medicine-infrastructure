import { test, expect, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { seedStaticData, cleanupTestOrders, TEST_IDS, TEST_USERS } from './fixtures/seed'

// ============================================================
// Clinic App E2E — WO-65 (extends WO-42)
// ============================================================
// Tests the medical assistant order creation workflow:
//   Step 1: /new-prescription  — medication search + pharmacy selection
//   Step 2: /new-prescription/margin — retail price + sig text
//   Step 3: /new-prescription/review — patient/provider, signature, send
//
// Also includes the 8-step happy path for the full order lifecycle
// up to the point of Stripe payment confirmation.

// ── Shared wizard navigation helper ──────────────────────────────────────────
//
// Navigates through all 3 steps of the new prescription wizard:
//   1. Search medication, select state TX, click Search, click pharmacy card
//   2. Set retail price, set sig text, click Continue to Review
//   3. Select patient, select provider (compliance checks auto-run)
//
// Leaves the browser on step 3 (/new-prescription/review) with patient + provider
// selected and compliance checks running. Caller must await signature canvas and
// click "Sign & Send Payment Link" / "Confirm & Send" to complete the flow.
//
// Prerequisites: test data seeded (seedStaticData must have run)

async function navigateToReviewPage(
  page: Page,
  { retailPrice = '200.00', sigText = 'Inject 0.5mg subcutaneously weekly' }: {
    retailPrice?: string
    sigText?: string
  } = {},
) {
  // ── Step 1: Pharmacy search ───────────────────────────────
  await page.goto('/new-prescription')
  await expect(page.getByRole('heading', { name: /Find a Pharmacy/i })).toBeVisible()

  // Type in medication autocomplete (fires at 3+ chars)
  await page.locator('#medication-search').fill('Test Compound')
  await expect(page.getByRole('option', { name: /Test Compound Injectable/i })).toBeVisible({ timeout: 10_000 })
  await page.getByRole('option', { name: /Test Compound Injectable/i }).click()

  // Select patient shipping state
  await page.locator('#patient-state').selectOption('TX')

  // Execute search
  await page.getByRole('button', { name: 'Search Pharmacies' }).click()

  // Click the pharmacy result card — it's a <button> with the pharmacy name
  await expect(page.getByRole('button', { name: /Test Pharmacy Tier1/ })).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: /Test Pharmacy Tier1/ }).click()

  // ── Step 2: Margin builder ────────────────────────────────
  await expect(page).toHaveURL(/\/new-prescription\/margin/, { timeout: 10_000 })

  // Set retail price (label: "Retail Price *")
  await page.locator('#retail-price').fill(retailPrice)

  // Set sig text (label: "Sig (Prescription Directions) *")
  await page.locator('#sig-text').fill(sigText)

  // Navigate to review
  await page.getByRole('button', { name: 'Continue to Review' }).click()

  // ── Step 3: Review page — patient + provider selection ────
  await expect(page).toHaveURL(/\/new-prescription\/review/, { timeout: 10_000 })

  // Select patient by option value (patient UUID)
  await page.locator('#patient-select').selectOption(TEST_IDS.patient)

  // Select provider by option value (provider UUID)
  await page.locator('#provider-select').selectOption(TEST_IDS.provider)

  // Compliance checks auto-run when both are selected — wait for them to complete
  await expect(page.getByText('Pre-Dispatch Compliance Checks')).toBeVisible()
  await expect(page.getByText('Running compliance checks…')).not.toBeVisible({ timeout: 15_000 })
}

test.describe('Clinic App — Order Creation Flow', () => {
  test.beforeAll(async () => {
    await seedStaticData()
  })

  test.afterEach(async () => {
    await cleanupTestOrders()
  })

  test('MA can create an order and send payment link', async ({ page }) => {
    // ── 1. Login as clinic admin ──────────────────────────────
    await page.goto('/login')
    await page.getByLabel('Email').fill(TEST_USERS.clinicAdmin.email)
    await page.getByLabel('Password').fill(TEST_USERS.clinicAdmin.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 })

    // ── 2-6. Navigate wizard (pharmacy → margin → review) ────
    await navigateToReviewPage(page)

    // ── 7. Draw signature on canvas ───────────────────────────
    // Canvas appears only after all compliance checks (except provider_signature) pass.
    // aria-label is "Provider signature pad".
    const canvas = page.locator('canvas[aria-label="Provider signature pad"]').first()
    await expect(canvas).toBeVisible({ timeout: 15_000 })
    const box = await canvas.boundingBox()
    if (box) {
      await page.mouse.move(box.x + 50, box.y + 50)
      await page.mouse.down()
      await page.mouse.move(box.x + 100, box.y + 80)
      await page.mouse.move(box.x + 150, box.y + 50)
      await page.mouse.up()
    }
    // Wait for signature captured confirmation
    await expect(page.getByText('✓ Signature captured')).toBeVisible()

    // ── 8. Click Sign & Send → confirm dialog ─────────────────
    await page.getByRole('button', { name: 'Sign & Send Payment Link' }).click()
    // Confirmation dialog: "Confirm & Send"
    await expect(page.getByRole('dialog', { name: /Confirm & Send/i })).toBeVisible()
    await page.getByRole('button', { name: 'Confirm & Send' }).click()

    // ── 9. Verify redirect to dashboard ───────────────────────
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 })
  })

  test('retail price validation rejects price below wholesale', async ({ page }) => {
    // ── 1. Login ──────────────────────────────────────────────
    await page.goto('/login')
    await page.getByLabel('Email').fill(TEST_USERS.clinicAdmin.email)
    await page.getByLabel('Password').fill(TEST_USERS.clinicAdmin.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 })

    // ── 2. Navigate to Step 1 and search ─────────────────────
    await page.goto('/new-prescription')
    await page.locator('#medication-search').fill('Test Compound')
    await expect(page.getByRole('option', { name: /Test Compound Injectable/i })).toBeVisible({ timeout: 10_000 })
    await page.getByRole('option', { name: /Test Compound Injectable/i }).click()
    await page.locator('#patient-state').selectOption('TX')
    await page.getByRole('button', { name: 'Search Pharmacies' }).click()
    await expect(page.getByRole('button', { name: /Test Pharmacy Tier1/ })).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: /Test Pharmacy Tier1/ }).click()

    // ── 3. On margin page: set retail BELOW wholesale ($100) ──
    await expect(page).toHaveURL(/\/new-prescription\/margin/, { timeout: 10_000 })
    await page.locator('#retail-price').fill('50.00')

    // ── 4. Verify inline error appears ───────────────────────
    // REQ-DMB-005: "Retail price must be at least the wholesale cost ($100.00)."
    await expect(
      page.getByText(/retail price must be at least/i)
    ).toBeVisible()

    // "Continue to Review" button should be disabled
    await expect(
      page.getByRole('button', { name: 'Continue to Review' })
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
      process.env['SUPABASE_URL']!,
      process.env['SUPABASE_SERVICE_ROLE_KEY']!
    )

    // ── Step 1: Clinic user creates order (AWAITING_PAYMENT) ──
    await page.goto('/login')
    await page.getByLabel('Email').fill(TEST_USERS.clinicAdmin.email)
    await page.getByLabel('Password').fill(TEST_USERS.clinicAdmin.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 })

    // Navigate wizard to review page
    await navigateToReviewPage(page, {
      sigText: 'Step-8 happy path E2E test sig text 123',
    })

    // Draw signature
    const canvas = page.locator('canvas[aria-label="Provider signature pad"]').first()
    await expect(canvas).toBeVisible({ timeout: 15_000 })
    const box = await canvas.boundingBox()
    if (box) {
      await page.mouse.move(box.x + 50, box.y + 50)
      await page.mouse.down()
      await page.mouse.move(box.x + 100, box.y + 80)
      await page.mouse.up()
    }
    await expect(page.getByText('✓ Signature captured')).toBeVisible()

    // Sign & send
    await page.getByRole('button', { name: 'Sign & Send Payment Link' }).click()
    await expect(page.getByRole('dialog', { name: /Confirm & Send/i })).toBeVisible()
    await page.getByRole('button', { name: 'Confirm & Send' }).click()

    // Verify Step 1 complete: redirected to dashboard
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 })

    // ── Step 2: Find the created order ID from DB ─────────────
    // Find most recent AWAITING_PAYMENT order for this clinic
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

  test('checkout page shows no medication name (zero-PHI compliance)', async ({ page }) => {
    const supabase = createClient(
      process.env['SUPABASE_URL']!,
      process.env['SUPABASE_SERVICE_ROLE_KEY']!
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
