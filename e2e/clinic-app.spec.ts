import { test, expect, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { seedStaticData, cleanupTestOrders, seedSecondProvider, retireSecondProvider, TEST_IDS, TEST_USERS, TEST_CATALOG, TEST_PATIENTS } from './fixtures/seed'
import { decryptSecret } from '../src/lib/epcs/crypto'
import { DEMO_TOTP_SECRET } from '../src/lib/poc/totp-enrollment'

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

// ── Shared wizard navigation helper ────────────────────────────────────────
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
  // ── Step 0: Patient + provider selection ──────────────────────
  await page.goto('/new-prescription')

  // Patient: type first name into the search box, then click the result.
  // The UI renders patient buttons as "{last_name}, {first_name}".
  await page.getByLabel('Search patients').fill('Test')
  await page.getByRole('button', { name: /Patient,\s*Test/i }).click()

  // Provider (WO-100): a provider login never sees a provider list — they
  // are the provider. An MA / clinic-admin login sees the clinic's providers;
  // with one it auto-selects, with two (while the WO-100 block has its
  // second provider active) we pick the one with a login by name.
  await pickProviderIfListed(page)
  await page.getByRole('button', { name: 'Continue to Pharmacy Search' }).click()

  // ── Step 1: Cascading prescription builder ────────────────────
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

  test('non-provider (clinic admin) sees Save as Draft, not Sign & Send, on review', async ({ page }) => {
    // Cosmetic sign-gating: a clinic_admin (non-provider) must NOT see the
    // provider signature canvas or the "Sign & Send" button — the server
    // rejects a non-provider signer with 403 at
    // /api/orders/[orderId]/sign-and-send, so those controls would only
    // dead-end on submit. Instead they get "Save as Draft — Provider Signs
    // Later", which creates DRAFT orders for the assigned provider to sign.

    // ── 1. Login as clinic admin ──────────────────────────────
    await page.goto('/login')
    await page.getByLabel('Email').fill(TEST_USERS.clinicAdmin.email)
    await page.getByLabel('Password').fill(TEST_USERS.clinicAdmin.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 })

    // ── 2. Walk all 4 wizard steps ───────────────────────
    // Patient → cascading builder → margin → review.
    await navigateToReviewPage(page)

    // ── 3. Non-provider review UI ────────────────────────
    // The Save-as-Draft action + explanatory note render (wait for hydrate).
    await expect(
      page.getByRole('button', { name: /Save as Draft/ })
    ).toBeVisible({ timeout: 15_000 })
    await expect(
      page.getByText(/Only the assigned provider can sign and send/i)
    ).toBeVisible()
    // The provider-only signing UI must NOT be present for a clinic_admin.
    await expect(
      page.locator('canvas[aria-label="Provider signature pad"]')
    ).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: /Sign & Send/ })
    ).toHaveCount(0)
  })

  test('provider sees the signature canvas and Sign & Send on review', async ({ page }) => {
    // The assigned provider keeps the sign-and-send UI unchanged.
    //
    // Coverage note — signature DRAWING itself is NOT E2E-tested:
    //   Playwright's input-synthesis layer cannot reliably trigger
    //   react-signature-canvas's underlying signature_pad in headless
    //   CI. page.mouse.* dispatches MouseEvents (signature_pad v4 only
    //   listens to pointer events); locator.dispatchEvent('pointerdown')
    //   constructs a plain Event instead of a PointerEvent (coords
    //   lost); page.evaluate with native PointerEvent also failed on
    //   chromium. Documented in cowork review #5; coverage is split by
    //   layer — here we verify the canvas mounts + Sign & Send is
    //   disabled without a signature (initial, safe state). Actual
    //   drawing + submit is covered by manual QA pre-launch.

    // ── 1. Login as provider ──────────────────────────────────
    await page.goto('/login')
    await page.getByLabel('Email').fill(TEST_USERS.provider.email)
    await page.getByLabel('Password').fill(TEST_USERS.provider.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 })

    // ── 2. Walk all 4 wizard steps to the review page ────────
    await navigateToReviewPage(page)

    // ── 3. Provider review UI (unchanged) ────────────────────
    await expect(
      page.locator('canvas[aria-label="Provider signature pad"]')
    ).toBeVisible({ timeout: 15_000 })
    await expect(
      page.getByRole('button', { name: /Sign & Send/ })
    ).toBeDisabled()
    // fix/review-send-flow: the disabled state must explain itself — a
    // gray button with no hint reads as "broken" (user bug report).
    await expect(
      page.getByText(/Sign in the signature box above to enable sending/i)
    ).toBeVisible()
    // The non-provider fallback must NOT render for a provider.
    await expect(
      page.getByRole('button', { name: /Save as Draft/ })
    ).toHaveCount(0)
  })

  test('clinic user can copy a payment link from an AWAITING_PAYMENT order', async ({ page, context }) => {
    // PR #1 of the demo-readiness fixes — replaces the
    // `scripts/get-checkout-url.ts` terminal command in the demo flow
    // with a "Copy Payment Link" button on the order drawer. Fixes
    // cowork review finding A1.

    // Permissions for clipboard read-back (only used to verify the
    // button wrote *something* — we don't assert the exact token value
    // because JWT iat makes tokens non-deterministic).
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])

    // Seed an AWAITING_PAYMENT order belonging to the test clinic.
    const supabase = createClient(
      process.env['E2E_SUPABASE_URL']!,
      process.env['E2E_SUPABASE_SERVICE_ROLE_KEY']!
    )
    const { data: order, error: insertErr } = await supabase
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
        sig_text:                 'Copy-payment-link E2E test order',
        locked_at:                new Date().toISOString(),
      })
      .select('order_id')
      .single()
    if (insertErr || !order) {
      throw new Error(`Failed to seed AWAITING_PAYMENT order: ${insertErr?.message}`)
    }

    // Login as clinic_admin and navigate to the dashboard.
    await page.goto('/login')
    await page.getByLabel('Email').fill(TEST_USERS.clinicAdmin.email)
    await page.getByLabel('Password').fill(TEST_USERS.clinicAdmin.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 })

    // Open the drawer for the seeded order.
    const orderRow = page.locator(`[data-order-id="${order.order_id}"]`)
    await expect(orderRow).toBeVisible({ timeout: 10_000 })
    await orderRow.click()

    // The drawer should expose the Copy Payment Link button.
    const copyButton = page.getByRole('button', { name: 'Copy Payment Link' })
    await expect(copyButton).toBeVisible({ timeout: 5_000 })

    // Click the button. The handler POSTs to /api/orders/{id}/checkout-link,
    // receives { checkoutUrl, expiresAt }, writes to clipboard, fires a toast.
    await copyButton.click()

    // Toast fires on successful clipboard write. Text per the component:
    //   "Payment link copied · valid for 72 hours"
    await expect(page.getByText(/Payment link copied/i)).toBeVisible({ timeout: 5_000 })

    // Verify the clipboard actually contains a /checkout/ URL that points
    // at the live-app origin. We match the shape, not the exact token —
    // tokens are non-deterministic because of iat.
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText())
    expect(clipboardText).toMatch(/\/checkout\/[A-Za-z0-9._-]+$/)
  })

  test('retail price validation rejects price below wholesale', async ({ page }) => {
    // ── 1. Login ──────────────────────────────────────────
    await page.goto('/login')
    await page.getByLabel('Email').fill(TEST_USERS.clinicAdmin.email)
    await page.getByLabel('Password').fill(TEST_USERS.clinicAdmin.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 })

    // ── 2. Walk Steps 0-1 of the cascading builder ───────────
    await page.goto('/new-prescription')
    await page.getByLabel('Search patients').fill('Test')
    await page.getByRole('button', { name: /Patient,\s*Test/i }).click()
    await pickProviderIfListed(page)   // WO-100: tolerate a second active provider (pick by name)
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

    // ── 4. Verify inline error appears ─────────────────────
    // REQ-DMB-005: "Retail price must be at least the wholesale cost ($100.00)."
    await expect(
      page.getByText(/retail price must be at least/i)
    ).toBeVisible()

    // "Review & Send" button should be disabled while retail < wholesale.
    await expect(
      page.getByRole('button', { name: /Review & Send/ })
    ).toBeDisabled()
  })

  test('E2E provider is pre-enrolled with the canonical demo TOTP secret', async () => {
    // PR #2 of the demo-readiness campaign — fixes cowork review finding A2
    // (EPCS 2FA silent dependency). The seed pre-enrolls the provider row
    // with a known secret + flips totp_enabled = true + totp_verified_at
    // so a presenter's authenticator app just needs to enter the 6-digit
    // code when the EPCS gate fires. No first-time setup flow, no QR scan
    // mid-demo.
    //
    // This test verifies the FULL enrollment chain at the data layer:
    //   1. The encrypted blob in providers.totp_secret_encrypted is
    //      well-formed AES-256-GCM ciphertext that the shared crypto
    //      helper can decrypt (same helper /api/epcs?action=verify uses).
    //   2. The decrypted plaintext matches DEMO_TOTP_SECRET byte-for-byte.
    //   3. totp_enabled and totp_verified_at are both flipped, matching
    //      the post-verify state that /api/epcs?action=status checks.
    //
    // A controlled-substance UI flow test that exercises the EPCS modal
    // end-to-end is blocked by the same signature_pad issue the prior
    // E2E campaign hit; coverage for that path is via manual QA pre-demo.
    const supabase = createClient(
      process.env['E2E_SUPABASE_URL']!,
      process.env['E2E_SUPABASE_SERVICE_ROLE_KEY']!
    )

    const { data: provider } = await supabase
      .from('providers')
      .select('totp_secret_encrypted, totp_enabled, totp_verified_at')
      .eq('provider_id', TEST_IDS.provider)
      .single()

    if (!provider) throw new Error('E2E test provider not found — seedStaticData must run first')

    expect(provider.totp_enabled).toBe(true)
    expect(provider.totp_verified_at).not.toBeNull()
    expect(provider.totp_secret_encrypted).toMatch(/^[a-f0-9]{24}:[a-f0-9]{32}:[a-f0-9]+$/)

    const decrypted = decryptSecret(provider.totp_secret_encrypted!)
    expect(decrypted).toBe(DEMO_TOTP_SECRET)
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

// ============================================================
// WO-96 — Rx detail fields (derived + defaulted)
// ============================================================
// Phase 21 acceptance criteria covered here (browser layer):
//   - days supply + dispense computed on the margin page, nothing typed
//   - Review card shows "Rx details" collapsed; expanding shows fields
//   - controlled substance → row auto-expands, diagnosis focused, send
//     blocked until a diagnosis is entered
//   - requires_clinical_difference → row auto-expands, picklist
//     pre-selected with the first option, nothing to type
//   - a line with neither rule saves with zero interaction with the row
//     and the defaults land on the order row
//   - no new page or step: the same three wizard URLs as before

type BuilderChoice = {
  ingredientName: string
  formulationName: string
  doseAmount: string
  doseUnit: string
  frequency: string
  quantity: string
}

/**
 * WO-100: the provider list only renders for MA / clinic-admin logins. When
 * it does, choose the seeded provider that has an auth login ("Provider,
 * Test") by name — never rely on auto-select, which only happens with
 * exactly one active provider. A provider login has nothing to pick.
 */
async function pickProviderIfListed(page: Page) {
  const providerButton = page.getByRole('button', { name: /Provider,\s*Test/i })
  if (await providerButton.count() > 0) await providerButton.click()
}

async function loginAs(page: Page, user: { email: string; password: string }) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(user.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 })
}

/** Steps 0–1 of the wizard with an explicit quantity, landing on the margin page. */
async function walkBuilderToMargin(page: Page, choice: BuilderChoice) {
  await page.goto('/new-prescription')
  await page.getByLabel('Search patients').fill('Test')
  await page.getByRole('button', { name: /Patient,\s*Test/i }).click()
  await pickProviderIfListed(page)
  await page.getByRole('button', { name: 'Continue to Pharmacy Search' }).click()

  await expect(page).toHaveURL(/\/new-prescription\/search/, { timeout: 10_000 })
  await page.getByLabel('Search medications').fill(choice.ingredientName)
  await page.getByRole('button', { name: new RegExp(choice.ingredientName, 'i') }).click()
  await page.getByRole('button', { name: new RegExp(choice.formulationName, 'i') }).click()
  await page.getByLabel('Dose amount').fill(choice.doseAmount)
  await page.getByLabel('Dose unit').selectOption(choice.doseUnit)
  await page.getByLabel('Frequency').selectOption(choice.frequency)
  await page.getByLabel('Timing').selectOption({ index: 1 })
  await page.getByRole('button', { name: /Test Pharmacy Tier1/ }).click()
  await page.getByLabel('Quantity').selectOption(choice.quantity)
  await page.getByRole('button', { name: /Continue.*Set Retail Price/i }).click()
  await expect(page).toHaveURL(/\/new-prescription\/margin/, { timeout: 10_000 })
}

const PLAIN: BuilderChoice = {
  ingredientName:  TEST_CATALOG.ingredientName,
  formulationName: TEST_CATALOG.formulationName,
  doseAmount: '10', doseUnit: 'mg', frequency: 'QD',
  quantity: '30',   // bare number on an injectable → 30 mL
}
const GLP1: BuilderChoice = {
  ingredientName:  TEST_CATALOG.glp1IngredientName,
  formulationName: TEST_CATALOG.glp1FormulationName,
  doseAmount: '10', doseUnit: 'units', frequency: 'QW',
  quantity: '5mL vial',
}
const CONTROLLED: BuilderChoice = {
  ingredientName:  TEST_CATALOG.controlledIngredientName,
  formulationName: TEST_CATALOG.controlledFormulationName,
  doseAmount: '0.5', doseUnit: 'mL', frequency: 'QW',
  quantity: '1 vial',
}

test.describe('Clinic App — WO-96 Rx detail fields', () => {
  test.beforeAll(async () => {
    await seedStaticData()
  })

  test.afterEach(async () => {
    await cleanupTestOrders()
  })

  test('margin page shows days supply and dispense computed from dose × frequency × quantity', async ({ page }) => {
    await loginAs(page, TEST_USERS.provider)
    await walkBuilderToMargin(page, PLAIN)

    // 10 mg of a 10 mg/mL injectable = 1 mL daily; 30 mL lasts 30 days.
    await expect(page.getByTestId('days-supply-value')).toHaveText('30 days')
    await expect(page.getByTestId('dispense-value')).toHaveText('30 mL')
    await expect(page.getByText(/Computed from dose × frequency × quantity/)).toBeVisible()
    // Read-only until the provider opts in to override.
    await expect(page.getByLabel('Days supply')).toHaveCount(0)
    await page.getByRole('button', { name: 'Override' }).click()
    await page.getByLabel('Days supply').fill('28')
    await expect(page.getByTestId('days-supply-value')).toHaveText('28 days')
  })

  test('GLP-1 analogue: 10 units weekly from a 5 mL vial derives 350 days / 5 mL; Review pre-selects the clinical difference', async ({ page }) => {
    await loginAs(page, TEST_USERS.provider)
    await walkBuilderToMargin(page, GLP1)

    await expect(page.getByTestId('days-supply-value')).toHaveText('350 days')
    await expect(page.getByTestId('dispense-value')).toHaveText('5 mL')

    await page.locator('#retail-price').fill('200.00')
    await page.getByRole('button', { name: /Review & Send/ }).click()
    await expect(page).toHaveURL(/\/new-prescription\/review/, { timeout: 10_000 })

    // Row auto-expands because the formulation requires a clinical difference…
    const row = page.locator('[data-testid^="rx-details-"]').first()
    await expect(row).toHaveAttribute('data-expanded', 'true', { timeout: 15_000 })
    // …with the picklist already on the first option and cold-chain shipping pre-selected.
    await expect(row.getByLabel(/Clinical difference \(required\)/)).toHaveValue(TEST_CATALOG.glp1ClinicalDifferenceOptions[0]!)
    await expect(row.getByLabel('Shipping')).toHaveValue('cold_chain')
    await expect(row.getByLabel('Syringe option')).toHaveValue('sc_kit')
    await expect(row.getByLabel('Refills')).toHaveValue('0')
    // Nothing is missing — only the signature stands between the provider and Send.
    await expect(page.getByText(/Sign in the signature box above to enable sending/)).toBeVisible()
  })

  test('controlled substance: Review row auto-expands with the diagnosis focused and blocks Send until it is entered', async ({ page }) => {
    await loginAs(page, TEST_USERS.provider)
    await walkBuilderToMargin(page, CONTROLLED)

    // "1 vial" carries no volume → dispense derived, days supply not (no typing either way).
    await expect(page.getByTestId('dispense-value')).toHaveText('1 vial')

    await page.locator('#retail-price').fill('300.00')
    await page.getByRole('button', { name: /Review & Send/ }).click()
    await expect(page).toHaveURL(/\/new-prescription\/review/, { timeout: 10_000 })

    const row = page.locator('[data-testid^="rx-details-"]').first()
    await expect(row).toHaveAttribute('data-expanded', 'true', { timeout: 15_000 })
    const dxCode = row.getByLabel(/Diagnosis code \(required\)/)
    await expect(dxCode).toBeFocused()
    await expect(row.getByRole('alert')).toContainText(/A diagnosis is required for a controlled substance/)
    await expect(page.getByRole('button', { name: /Sign & Send/ })).toBeDisabled()
    await expect(page.getByText(/needs a diagnosis \(controlled substance\)/)).toBeVisible()

    await dxCode.fill('E29.1')
    await expect(page.getByText(/Sign in the signature box above to enable sending/)).toBeVisible()
    await expect(row.getByRole('alert')).toHaveCount(0)
  })

  test('no rule applies: Rx details stays collapsed, Save as Draft needs no interaction with it, defaults land on the order', async ({ page }) => {
    await loginAs(page, TEST_USERS.clinicAdmin)
    await walkBuilderToMargin(page, PLAIN)
    await page.locator('#retail-price').fill('200.00')
    await page.getByRole('button', { name: /Review & Send/ }).click()
    await expect(page).toHaveURL(/\/new-prescription\/review/, { timeout: 10_000 })

    const row = page.locator('[data-testid^="rx-details-"]').first()
    await expect(row).toHaveAttribute('data-expanded', 'false', { timeout: 15_000 })
    await expect(row).toContainText('30-day supply · dispense 30 mL · 0 refills · substitution OK · SubQ syringe kit · Standard')

    // Expanding shows the pre-filled fields; collapse again without touching anything.
    await row.getByRole('button', { name: /Rx details/ }).click()
    await expect(row.getByLabel('Syringe option')).toHaveValue('sc_kit')
    await expect(row.getByLabel('Shipping')).toHaveValue('standard')
    await row.getByRole('button', { name: /Rx details/ }).click()
    await expect(row).toHaveAttribute('data-expanded', 'false')

    await page.getByRole('button', { name: /Save as Draft/ }).click()
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 })

    // The derived + defaulted values are on the order row.
    const supabase = createClient(
      process.env['E2E_SUPABASE_URL']!,
      process.env['E2E_SUPABASE_SERVICE_ROLE_KEY']!
    )
    const { data: order } = await supabase
      .from('orders')
      .select('days_supply, dispense_quantity, dispense_unit, refills, substitution_allowed, syringe_option, shipping_type, clinical_difference, diagnosis_code, special_instructions')
      .eq('clinic_id', TEST_IDS.clinic)
      .eq('formulation_id', TEST_IDS.formulation)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    expect(order).toEqual({
      days_supply:          30,
      dispense_quantity:    30,
      dispense_unit:        'mL',
      refills:              0,
      substitution_allowed: true,
      syringe_option:       'sc_kit',
      shipping_type:        'standard',
      clinical_difference:  null,
      diagnosis_code:       null,
      special_instructions: null,
    })
  })

  test('no new page or step: the wizard still has exactly three steps', async ({ page }) => {
    await loginAs(page, TEST_USERS.provider)
    await walkBuilderToMargin(page, PLAIN)
    // The step indicator on the margin page lists the same three labels as
    // before WO-96 (WO-100 renames step 1 to "Patient" for a provider login).
    await expect(page.getByText('Patient', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Add Prescriptions')).toBeVisible()
    // Both the wizard step label and the submit button read "Review & Send".
    await expect(page.getByText('Review & Send', { exact: true }).first()).toBeVisible()
    await expect(page.getByText(/Rx details/)).toHaveCount(0)
  })
})

// ============================================================
// WO-97 — Patient allergies / NKDA
// ============================================================
// Allergies live on the patient. The seed carries one patient per chip
// state (see e2e/fixtures/seed.ts): "Patient, Test" not recorded,
// "Nkda, Test" NKDA, "Allergic, Test" sulfa + penicillin. The tests that
// write allergies do so on "Patient, Test" and reset the row afterwards
// so the WO-96 block (and any other branch's run on the shared E2E
// project) still meets the seeded "not recorded" state.

test.describe('Clinic App — WO-97 patient allergies / NKDA', () => {
  const supabase = () => createClient(
    process.env['E2E_SUPABASE_URL']!,
    process.env['E2E_SUPABASE_SERVICE_ROLE_KEY']!
  )

  async function resetTestPatientAllergies() {
    await supabase()
      .from('patients')
      .update({ allergies: null, nkda: false, allergies_updated_at: null })
      .eq('patient_id', TEST_IDS.patient)
  }

  async function readTestPatientAllergies() {
    const { data } = await supabase()
      .from('patients')
      .select('allergies, nkda, allergies_updated_at')
      .eq('patient_id', TEST_IDS.patient)
      .single()
    return data
  }

  test.beforeAll(async () => {
    await seedStaticData()
  })

  test.afterEach(async () => {
    await resetTestPatientAllergies()
    await cleanupTestOrders()
  })

  test('chip is visible on patient selection and in the session banner for all three states', async ({ page }) => {
    await loginAs(page, TEST_USERS.provider)
    await page.goto('/new-prescription')
    await page.getByLabel('Search patients').fill('Test')

    const notRecorded = page.getByRole('button', { name: /Patient,\s*Test/i })
    const nkda        = page.getByRole('button', { name: new RegExp(`${TEST_PATIENTS.nkdaLastName},\\s*Test`, 'i') })
    const allergic    = page.getByRole('button', { name: new RegExp(`${TEST_PATIENTS.allergiesLastName},\\s*Test`, 'i') })

    // Selector cards — one chip each, the not-recorded one amber.
    await expect(notRecorded.getByTestId('allergy-chip')).toHaveText('Allergies: not recorded')
    await expect(notRecorded.getByTestId('allergy-chip')).toHaveAttribute('data-allergy-status', 'not_recorded')
    await expect(nkda.getByTestId('allergy-chip')).toHaveText('NKDA')
    await expect(allergic.getByTestId('allergy-chip')).toHaveText(`Allergies: ${TEST_PATIENTS.allergies.join(', ')}`)

    // Selecting shows the clickable chip on the selected-patient card…
    await nkda.click()
    const card = page.getByTestId('selected-patient-card')
    await expect(card.getByRole('button', { name: /NKDA/ })).toBeVisible()

    // …and the session banner carries the same chip on the next step.
    await page.getByRole('button', { name: 'Continue to Pharmacy Search' }).click()
    await expect(page).toHaveURL(/\/new-prescription\/search/, { timeout: 10_000 })
    const banner = page.getByTestId('session-banner')
    await expect(banner.getByTestId('allergy-chip')).toHaveText('NKDA')
    await expect(banner.getByTestId('allergy-chip')).toHaveAttribute('data-allergy-status', 'nkda')
  })

  test('editing allergies from the banner updates the patient and every subsequent Rx in the session', async ({ page }) => {
    await loginAs(page, TEST_USERS.provider)
    await walkBuilderToMargin(page, PLAIN)

    const banner = page.getByTestId('session-banner')
    await expect(banner.getByTestId('allergy-chip')).toHaveText('Allergies: not recorded')

    // Inline editor — no navigation away from the margin page.
    await banner.getByRole('button', { name: /Allergies: not recorded/ }).click()
    const editor = banner.getByTestId('allergy-editor')
    // exact: the NKDA checkbox's label also contains "drug allergies".
    await editor.getByLabel('Drug allergies', { exact: true }).fill('latex, Penicillin')
    await editor.getByRole('button', { name: 'Save allergies' }).click()
    await expect(banner.getByTestId('allergy-chip')).toHaveText('Allergies: latex, Penicillin')
    await expect(editor).toHaveCount(0)
    await expect(page).toHaveURL(/\/new-prescription\/margin/)

    // Stored once, on the patient.
    const row = await readTestPatientAllergies()
    expect(row?.allergies).toEqual(['latex', 'Penicillin'])
    expect(row?.nkda).toBe(false)
    expect(row?.allergies_updated_at).not.toBeNull()

    // The Rx added after the edit sees it: Review shows the chip, no notice.
    await page.locator('#retail-price').fill('200.00')
    await page.getByRole('button', { name: /Review & Send/ }).click()
    await expect(page).toHaveURL(/\/new-prescription\/review/, { timeout: 10_000 })
    await expect(page.getByTestId('session-banner').getByTestId('allergy-chip')).toHaveText('Allergies: latex, Penicillin')
    await expect(page.getByTestId('allergy-notice')).toHaveCount(0)
  })

  test('not recorded: Review shows the amber notice but Save as Draft still goes through', async ({ page }) => {
    await loginAs(page, TEST_USERS.clinicAdmin)
    await walkBuilderToMargin(page, PLAIN)
    await page.locator('#retail-price').fill('200.00')
    await page.getByRole('button', { name: /Review & Send/ }).click()
    await expect(page).toHaveURL(/\/new-prescription\/review/, { timeout: 10_000 })

    const notice = page.getByTestId('allergy-notice')
    await expect(notice).toBeVisible()
    await expect(notice).toContainText('Allergies not recorded for Test Patient')
    await expect(notice.getByRole('button', { name: 'Confirm NKDA' })).toBeEnabled()

    // Non-blocking: the draft saves without touching the notice.
    await expect(page.getByRole('button', { name: /Save as Draft/ })).toBeEnabled()
    await page.getByRole('button', { name: /Save as Draft/ }).click()
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 })

    const { data: order } = await supabase()
      .from('orders')
      .select('order_id, status')
      .eq('clinic_id', TEST_IDS.clinic)
      .eq('patient_id', TEST_IDS.patient)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    expect(order?.status).toBe('DRAFT')
    // Still not recorded — the notice never wrote anything by itself.
    expect((await readTestPatientAllergies())?.allergies_updated_at).toBeNull()
  })

  test('not recorded: "Confirm NKDA" on Review writes to the patient inline and clears the notice', async ({ page }) => {
    await loginAs(page, TEST_USERS.provider)
    await walkBuilderToMargin(page, PLAIN)
    await page.locator('#retail-price').fill('200.00')
    await page.getByRole('button', { name: /Review & Send/ }).click()
    await expect(page).toHaveURL(/\/new-prescription\/review/, { timeout: 10_000 })

    const notice = page.getByTestId('allergy-notice')
    await notice.getByRole('button', { name: 'Confirm NKDA' }).click()
    await expect(notice).toHaveCount(0)
    await expect(page.getByTestId('session-banner').getByTestId('allergy-chip')).toHaveText('NKDA')
    await expect(page).toHaveURL(/\/new-prescription\/review/)

    const row = await readTestPatientAllergies()
    expect(row?.nkda).toBe(true)
    expect(row?.allergies).toEqual([])
    expect(row?.allergies_updated_at).not.toBeNull()
  })
})

// ============================================================
// WO-98 — Edit at Review, Edit Draft, Add to Draft
// ============================================================
//
// Signature drawing cannot be automated in Playwright (see the WO-96
// block above), so the draft scenarios stop at the draft state and
// assert the rows directly; nothing here signs an order.

/** Steps 1 of the wizard only — assumes the browser is already on /new-prescription/search. */
async function fillBuilder(page: Page, choice: BuilderChoice) {
  await page.getByLabel('Search medications').fill(choice.ingredientName)
  await page.getByRole('button', { name: new RegExp(choice.ingredientName, 'i') }).click()
  await page.getByRole('button', { name: new RegExp(choice.formulationName, 'i') }).click()
  await page.getByLabel('Dose amount').fill(choice.doseAmount)
  await page.getByLabel('Dose unit').selectOption(choice.doseUnit)
  await page.getByLabel('Frequency').selectOption(choice.frequency)
  await page.getByLabel('Timing').selectOption({ index: 1 })
  await page.getByRole('button', { name: /Test Pharmacy Tier1/ }).click()
  await page.getByLabel('Quantity').selectOption(choice.quantity)
  await page.getByRole('button', { name: /Continue.*Set Retail Price/i }).click()
  await expect(page).toHaveURL(/\/new-prescription\/margin/, { timeout: 10_000 })
}

function e2eSupabase() {
  return createClient(process.env['E2E_SUPABASE_URL']!, process.env['E2E_SUPABASE_SERVICE_ROLE_KEY']!)
}

test.describe('Clinic App — WO-98 edit at review / edit draft / add to draft', () => {
  test.beforeAll(async () => {
    await seedStaticData()
  })

  test.afterEach(async () => {
    await cleanupTestOrders()
  })

  test('changing a dose at Review updates the card in place and recomputes totals; Back keeps both Rx in session', async ({ page }) => {
    await loginAs(page, TEST_USERS.provider)

    // Two lines in the session: PLAIN ($200) then GLP1 ($200).
    await walkBuilderToMargin(page, PLAIN)
    await page.locator('#retail-price').fill('200.00')
    await page.getByRole('button', { name: /Review & Send/ }).click()
    await expect(page).toHaveURL(/\/new-prescription\/review/, { timeout: 10_000 })
    await page.getByRole('button', { name: '+ Add Another Prescription' }).click()
    await expect(page).toHaveURL(/\/new-prescription\/search/, { timeout: 10_000 })
    await fillBuilder(page, GLP1)
    await page.locator('#retail-price').fill('200.00')
    // One line is already in the session, so the banner carries a "Review & Send"
    // link too — click the form's submit ("Review & Send (2)").
    await page.getByRole('button', { name: 'Review & Send (2)' }).click()
    await expect(page).toHaveURL(/\/new-prescription\/review/, { timeout: 10_000 })

    await expect(page.getByText('Prescriptions (2)')).toBeVisible()
    await expect(page.getByText('$400.00')).toBeVisible()
    const glp1Card = page.locator('[data-testid^="rx-details-"]').nth(1).locator('..')
    await expect(glp1Card).toContainText('10 units')
    const glp1LineId = (await page.locator('[data-testid^="rx-details-"]').nth(1).getAttribute('data-testid'))!.replace('rx-details-', '')

    // ── Edit the second (GLP-1) line ──────────────────────────
    await page.getByRole('button', { name: `Edit ${TEST_CATALOG.glp1FormulationName}` }).click()
    await expect(page).toHaveURL(new RegExp(`/new-prescription/search\\?editId=${glp1LineId}`), { timeout: 10_000 })
    await expect(page.getByRole('heading', { name: 'Edit Prescription' })).toBeVisible()

    // The existing builder reopens with the line's values pre-selected — no re-entry.
    await expect(page.getByLabel('Dose amount')).toHaveValue('10', { timeout: 15_000 })
    await expect(page.getByLabel('Dose unit')).toHaveValue('units')
    await expect(page.getByLabel('Frequency')).toHaveValue('QW')
    await expect(page.getByLabel('Quantity')).toHaveValue('5mL vial', { timeout: 15_000 })

    await page.getByLabel('Dose amount').fill('15')
    await page.getByRole('button', { name: /Continue.*Set Retail Price/i }).click()
    await expect(page).toHaveURL(/\/new-prescription\/margin\?.*editId=/, { timeout: 10_000 })

    // Margin page: price carried over from the line; the derived days supply follows the new dose.
    await expect(page.locator('#retail-price')).toHaveValue('200.00')
    await expect(page.getByTestId('days-supply-value')).toHaveText('233 days')   // 5 mL vial / (15 u = 0.15 mL weekly)
    await expect(page.getByRole('button', { name: 'Add & Search Another' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Save as Draft/ })).toHaveCount(0)
    await page.locator('#retail-price').fill('250.00')
    await page.getByRole('button', { name: 'Save Changes — Back to Review' }).click()
    await expect(page).toHaveURL(/\/new-prescription\/review$/, { timeout: 10_000 })

    // Same card (same line id, still second), new dose, totals recomputed: 200 + 250.
    await expect(page.getByText('Prescriptions (2)')).toBeVisible()
    const editedCard = page.getByTestId(`rx-details-${glp1LineId}`).locator('..')
    await expect(editedCard).toContainText(`2. ${TEST_CATALOG.glp1FormulationName}`)
    await expect(editedCard).toContainText('15 units')
    await expect(editedCard).toContainText('$250.00')
    await expect(editedCard).toContainText('233-day supply')
    await expect(page.getByText('$450.00')).toBeVisible()

    // ── Back lands on search with the session intact ──────────
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await expect(page).toHaveURL(/\/new-prescription\/search$/, { timeout: 10_000 })
    // Banner badge + label are separate spans: "2" · "prescriptions in this session".
    await expect(page.locator('p').filter({ hasText: 'prescriptions in this session' })).toContainText('2')
    await page.getByRole('button', { name: 'Review & Send' }).click()
    await expect(page).toHaveURL(/\/new-prescription\/review/, { timeout: 10_000 })
    await expect(page.getByText('Prescriptions (2)')).toBeVisible()
    await expect(page.getByText('$450.00')).toBeVisible()
  })

  test('provider opens a draft, edits the dose, adds a second line, removes it: same order id, audit rows, soft delete', async ({ page }) => {
    // ── The MA (clinic admin) saves a draft ───────────────────
    await loginAs(page, TEST_USERS.clinicAdmin)
    await walkBuilderToMargin(page, PLAIN)
    await page.locator('#retail-price').fill('200.00')
    await page.getByRole('button', { name: /Review & Send/ }).click()
    await expect(page).toHaveURL(/\/new-prescription\/review/, { timeout: 10_000 })
    await page.getByRole('button', { name: /Save as Draft/ }).click()
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 })

    const supabase = e2eSupabase()
    const { data: draft } = await supabase
      .from('orders')
      .select('order_id, sig_text')
      .eq('clinic_id', TEST_IDS.clinic)
      .eq('status', 'DRAFT')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
    const anchorId = draft!.order_id
    // 10 mg of a 10 mg/mL injectable → "Inject 100 units (1.00mL / 10mg) …"
    expect(draft!.sig_text).toContain('10mg')

    // The MA can edit the draft they created — the creator rule, server-side.
    const ownEdit = await page.request.patch(`/api/orders/${anchorId}`, {
      data: { formulationId: TEST_IDS.formulation, pharmacyId: TEST_IDS.pharmacyTier1, retailCents: 20000, sigText: 'Inject 10 mg (1.00mL) subcutaneously once daily at bedtime', dose: '10 mg', frequencyCode: 'QD', quantityLabel: '30' },
    })
    expect(ownEdit.status()).toBe(200)

    // ── The provider takes over ───────────────────────────────
    await page.context().clearCookies()
    await loginAs(page, TEST_USERS.provider)
    await page.goto(`/new-prescription/sign/${anchorId}`)
    const lines = page.getByTestId('draft-lines')
    await expect(lines).toContainText('Draft lines (1)')

    // Edit → the existing builder, patient/provider pinned, values pre-selected.
    await lines.getByRole('button', { name: 'Edit' }).click()
    await expect(page).toHaveURL(new RegExp(`/new-prescription/search\\?editOrder=${anchorId}`), { timeout: 10_000 })
    await expect(page.getByTestId('draft-edit-notice')).toContainText(TEST_CATALOG.formulationName)
    // The draft's patient is pinned on the session banner.
    await expect(page.getByText('Test Patient').first()).toBeVisible()
    await expect(page.getByLabel('Dose amount')).toHaveValue('10', { timeout: 15_000 })
    await expect(page.getByLabel('Quantity')).toHaveValue('30', { timeout: 15_000 })
    await page.getByLabel('Dose amount').fill('12')
    await page.getByRole('button', { name: /Continue.*Set Retail Price/i }).click()
    await expect(page).toHaveURL(/\/new-prescription\/margin\?.*editOrder=/, { timeout: 10_000 })
    await expect(page.locator('#retail-price')).toHaveValue('200.00')
    await page.getByRole('button', { name: 'Save Changes to Draft' }).click()
    await expect(page).toHaveURL(new RegExp(`/new-prescription/sign/${anchorId}`), { timeout: 15_000 })
    await expect(page.getByTestId('draft-lines')).toContainText('12 mg')

    // + Add prescription → builder pinned to the draft's patient/provider, appends a line.
    await page.getByRole('button', { name: '+ Add prescription' }).click()
    await expect(page).toHaveURL(new RegExp(`/new-prescription/search\\?addToOrder=${anchorId}`), { timeout: 10_000 })
    await expect(page.getByRole('heading', { name: 'Add Prescription to Draft' })).toBeVisible()
    await fillBuilder(page, GLP1)
    await page.locator('#retail-price').fill('200.00')
    await page.getByRole('button', { name: 'Add to Draft' }).click()
    await expect(page).toHaveURL(new RegExp(`/new-prescription/sign/${anchorId}`), { timeout: 15_000 })
    await expect(page.getByTestId('draft-lines')).toContainText('Draft lines (2)')
    await expect(page.getByTestId('draft-lines')).toContainText(TEST_CATALOG.glp1FormulationName)

    // ── Rows: same order id, 2 draft lines, audit trail with actor + diff ──
    const { data: anchor } = await supabase
      .from('orders')
      .select('order_id, status, sig_text, medication_snapshot, days_supply')
      .eq('order_id', anchorId)
      .single()
    expect(anchor!.status).toBe('DRAFT')
    expect(anchor!.sig_text).toContain('12mg')
    expect((anchor!.medication_snapshot as { prescribed_dose?: string }).prescribed_dose).toBe('12 mg')

    const { data: drafts } = await supabase
      .from('orders')
      .select('order_id')
      .eq('clinic_id', TEST_IDS.clinic)
      .eq('patient_id', TEST_IDS.patient)
      .eq('status', 'DRAFT')
      .eq('is_active', true)
      .is('deleted_at', null)
    expect(drafts).toHaveLength(2)
    const addedId = drafts!.map(d => d.order_id).find(id => id !== anchorId)!

    const { data: audit } = await supabase
      .from('order_status_history')
      .select('order_id, old_status, new_status, changed_by, metadata')
      .in('order_id', [anchorId, addedId])
      .order('created_at', { ascending: true })
    type Audit = { order_id: string; old_status: string; new_status: string; changed_by: string | null; metadata: { event: string; actor: { user_id: string; role: string | null }; diff?: Record<string, { from: unknown; to: unknown }>; appended_to_order_id?: string | null } }
    const rows = audit as Audit[]
    const events = rows.filter(r => r.order_id === anchorId).map(r => r.metadata.event)
    expect(events).toEqual(['draft_created', 'draft_edited', 'draft_edited'])
    for (const row of rows) {
      expect(row.old_status).toBe('DRAFT')
      expect(row.new_status).toBe('DRAFT')
      expect(row.changed_by).toBe(row.metadata.actor.user_id)
    }
    const providerEdit = rows.filter(r => r.order_id === anchorId && r.metadata.event === 'draft_edited').at(-1)!
    expect(providerEdit.metadata.actor.role).toBe('provider')
    expect(providerEdit.metadata.diff!['sig_text']).toMatchObject({ to: expect.stringContaining('12mg') })
    expect(providerEdit.metadata.diff!['medication_snapshot.prescribed_dose']).toEqual({ from: '10 mg', to: '12 mg' })
    const added = rows.find(r => r.order_id === addedId)!
    expect(added.metadata).toMatchObject({ event: 'draft_created', appended_to_order_id: anchorId })

    // ── Remove the added line: soft delete, never a hard delete ──
    await page.getByTestId(`draft-line-${addedId}`).getByRole('button', { name: 'Remove' }).click()
    await expect(page.getByTestId('draft-lines')).toContainText('Draft lines (1)', { timeout: 15_000 })
    const { data: removed } = await supabase
      .from('orders')
      .select('order_id, is_active, deleted_at, status')
      .eq('order_id', addedId)
      .single()
    expect(removed).toMatchObject({ order_id: addedId, is_active: false, status: 'DRAFT' })
    expect(removed!.deleted_at).not.toBeNull()
    const { data: removedAudit } = await supabase
      .from('order_status_history')
      .select('metadata')
      .eq('order_id', addedId)
      .contains('metadata', { event: 'draft_line_removed' })
    expect(removedAudit).toHaveLength(1)
  })

  test('server enforces who may edit a draft: a non-provider gets 403 on a draft they did not create', async ({ page }) => {
    const supabase = e2eSupabase()
    // A draft with no draft_created row by the clinic admin (inserted directly).
    const { data: inserted, error } = await supabase
      .from('orders')
      .insert({
        patient_id: TEST_IDS.patient, provider_id: TEST_IDS.provider, clinic_id: TEST_IDS.clinic,
        pharmacy_id: TEST_IDS.pharmacyTier1, formulation_id: TEST_IDS.formulation,
        status: 'DRAFT', quantity: 1,
        wholesale_price_snapshot: 100, retail_price_snapshot: 200,
        medication_snapshot: { medication_name: TEST_CATALOG.formulationName, form: 'Injectable Solution', dose: '10 mg/mL', wholesale_price: 100, dea_schedule: 0 },
        pharmacy_snapshot: { pharmacy_id: TEST_IDS.pharmacyTier1, name: 'Test Pharmacy Tier1', integration_tier: 'TIER_1_API', fax_number: null },
        shipping_state_snapshot: 'TX', sig_text: 'Inject 10 mg subcutaneously once daily',
      })
      .select('order_id')
      .single()
    if (error || !inserted) throw new Error(`Failed to seed draft: ${error?.message}`)
    const body = { formulationId: TEST_IDS.formulation, pharmacyId: TEST_IDS.pharmacyTier1, retailCents: 20000, sigText: 'Inject 12 mg subcutaneously once daily', dose: '12 mg', frequencyCode: 'QD' }

    await loginAs(page, TEST_USERS.clinicAdmin)
    expect((await page.request.patch(`/api/orders/${inserted.order_id}`, { data: body })).status()).toBe(403)
    expect((await page.request.delete(`/api/orders/${inserted.order_id}`)).status()).toBe(403)

    await page.context().clearCookies()
    await loginAs(page, TEST_USERS.provider)
    expect((await page.request.patch(`/api/orders/${inserted.order_id}`, { data: body })).status()).toBe(200)
    const { data: row } = await supabase.from('orders').select('sig_text, is_active').eq('order_id', inserted.order_id).single()
    expect(row).toEqual({ sig_text: 'Inject 12 mg subcutaneously once daily', is_active: true })
  })
})

// ============================================================
// WO-100 — Provider defaults to self + draft reassignment
// ============================================================
// Phase 21 acceptance criteria covered here (browser layer):
//   - provider → + New Prescription → no provider list; banner shows the
//     provider's own name
//   - clinic admin → + New Prescription → provider list present
//   - a draft saved for provider B: provider A opens it, clicks Sign as me,
//     the order now shows provider = A and the audit trail records the
//     reassignment from B (signature drawing itself is not automatable —
//     see the coverage note on the WO-77 provider test above)
//   - the server rejects a provider creating an order under a different
//     provider_id (403) while accepting their own (201)

test.describe('Clinic App — WO-100 provider defaults to self', () => {
  // The second provider is shared state on the E2E project: activate it only
  // for this block and retire it afterwards so other specs (and other
  // branches' runs) keep a single auto-selecting provider.
  test.beforeAll(async () => {
    await seedStaticData()
    await seedSecondProvider()
  })

  test.afterEach(async () => {
    await cleanupTestOrders()
  })

  test.afterAll(async () => {
    await retireSecondProvider()
  })

  test('provider: no provider list, step 1 reads "Patient", banner shows the signed-in provider', async ({ page }) => {
    await loginAs(page, TEST_USERS.provider)
    await page.goto('/new-prescription')

    await expect(page.getByText('Select Patient')).toBeVisible()
    await expect(page.getByText('Patient', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Patient & Provider')).toHaveCount(0)
    await expect(page.getByText('Select Provider')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Provider,\s*(Test|Other)/i })).toHaveCount(0)
    await expect(page.getByText(/Prescribing as Test Provider/)).toBeVisible()

    await page.getByLabel('Search patients').fill('Test')
    await page.getByRole('button', { name: /Patient,\s*Test/i }).click()
    await page.getByRole('button', { name: 'Continue to Pharmacy Search' }).click()
    await expect(page).toHaveURL(/\/new-prescription\/search/, { timeout: 10_000 })

    // Session banner: patient on the left, the signed-in provider on the right.
    await expect(page.getByText('Test Provider', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('NPI: 1234567890').first()).toBeVisible()
    await expect(page.getByText('Patient', { exact: true }).first()).toBeVisible()
  })

  test('clinic admin: provider list present with both seeded providers', async ({ page }) => {
    await loginAs(page, TEST_USERS.clinicAdmin)
    await page.goto('/new-prescription')

    await expect(page.getByText('Select Provider')).toBeVisible()
    await expect(page.getByText('Patient & Provider')).toBeVisible()
    await expect(page.getByRole('button', { name: /Provider,\s*Test/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Provider,\s*Other/i })).toBeVisible()

    // Two providers → nothing auto-selects; Continue needs both picks.
    await page.getByLabel('Search patients').fill('Test')
    await page.getByRole('button', { name: /Patient,\s*Test/i }).click()
    await expect(page.getByRole('button', { name: 'Continue to Pharmacy Search' })).toBeDisabled()
    await page.getByRole('button', { name: /Provider,\s*Other/i }).click()
    await expect(page.getByRole('button', { name: 'Continue to Pharmacy Search' })).toBeEnabled()
  })

  test('Sign as me: provider A takes over a draft saved for provider B; order + audit reflect the reassignment', async ({ page }) => {
    const supabase = createClient(
      process.env['E2E_SUPABASE_URL']!,
      process.env['E2E_SUPABASE_SERVICE_ROLE_KEY']!
    )

    // A draft for provider B (as the MA would save it). Two lines, so the
    // take-over has a sibling to carry along.
    const draftLine = (sig: string) => ({
      patient_id:               TEST_IDS.patient,
      provider_id:              TEST_IDS.providerB,
      catalog_item_id:          TEST_IDS.catalogItem,
      clinic_id:                TEST_IDS.clinic,
      pharmacy_id:              TEST_IDS.pharmacyTier1,
      status:                   'DRAFT',
      quantity:                 1,
      wholesale_price_snapshot: 100.00,
      retail_price_snapshot:    200.00,
      provider_npi_snapshot:    '1987654321',
      sig_text:                 sig,
    })
    const { data: drafts, error } = await supabase
      .from('orders')
      .insert([draftLine('WO-100 reassignment line one'), draftLine('WO-100 reassignment line two')])
      .select('order_id')
    if (error || !drafts || drafts.length !== 2) throw new Error(`Failed to seed drafts: ${error?.message}`)
    const [first, second] = drafts

    await loginAs(page, TEST_USERS.provider)
    await page.goto(`/new-prescription/sign/${first!.order_id}`)

    // Not mine → the Sign as me panel, not a signature pad.
    const panel = page.getByTestId('sign-as-me-panel')
    await expect(panel).toBeVisible({ timeout: 15_000 })
    await expect(panel).toContainText('This draft is assigned to Other Provider')
    await expect(panel).toContainText('signed in as Test Provider')
    await expect(panel).toContainText('all 2 prescriptions in this draft')
    await expect(page.locator('canvas[aria-label="Provider signature pad"]')).toHaveCount(0)

    await panel.getByRole('button', { name: 'Sign as me' }).click()

    // Same URL re-renders as the signing form under my name, up to the
    // point of drawing the signature.
    await expect(page.locator('canvas[aria-label="Provider signature pad"]')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('sign-as-me-panel')).toHaveCount(0)
    await expect(page.getByText('Test Provider').first()).toBeVisible()
    await expect(page.getByText('Other Provider')).toHaveCount(0)

    // Both lines now belong to provider A with A's NPI snapshot…
    const { data: rows } = await supabase
      .from('orders')
      .select('order_id, provider_id, provider_npi_snapshot, status')
      .in('order_id', [first!.order_id, second!.order_id])
    expect(rows).toHaveLength(2)
    for (const row of rows ?? []) {
      expect(row.provider_id).toBe(TEST_IDS.provider)
      expect(row.provider_npi_snapshot).toBe('1234567890')
      expect(row.status).toBe('DRAFT')
    }

    // …and the audit trail records the reassignment from B on each line.
    const { data: audit } = await supabase
      .from('order_status_history')
      .select('order_id, old_status, new_status, metadata')
      .in('order_id', [first!.order_id, second!.order_id])
    expect(audit).toHaveLength(2)
    for (const row of audit ?? []) {
      expect(row.old_status).toBe('DRAFT')
      expect(row.new_status).toBe('DRAFT')
      expect(row.metadata).toEqual(expect.objectContaining({
        actor:            'provider_reassign_to_self',
        from_provider_id: TEST_IDS.providerB,
        to_provider_id:   TEST_IDS.provider,
      }))
    }
  })

  test('server rejects a provider creating an order under a different provider_id (403)', async ({ page }) => {
    await loginAs(page, TEST_USERS.provider)

    const body = (providerId: string) => ({
      patientId:     TEST_IDS.patient,
      providerId,
      formulationId: TEST_IDS.formulation,
      pharmacyId:    TEST_IDS.pharmacyTier1,
      retailCents:   20000,
      sigText:       'WO-100 server guard: inject 10 mg subcutaneously daily',
      patientState:  'TX',
    })

    const rejected = await page.request.post('/api/orders', { data: body(TEST_IDS.providerB) })
    expect(rejected.status()).toBe(403)
    expect((await rejected.json()).error).toMatch(/under their own name/i)

    const accepted = await page.request.post('/api/orders', { data: body(TEST_IDS.provider) })
    expect(accepted.status()).toBe(201)
  })
})
