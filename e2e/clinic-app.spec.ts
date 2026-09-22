import { test, expect, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { seedStaticData, cleanupTestOrders, cleanupTestFavorites, seedSecondProvider, retireSecondProvider, seedLegacySemaglutideFavorites, insertRecentOrder, TEST_IDS, TEST_USERS, TEST_CATALOG, TEST_PATIENTS, TEST_SHIPPING } from './fixtures/seed'
import { packageId } from '../src/lib/catalog/packages'
import { decryptSecret } from '../src/lib/epcs/crypto'
import { DEMO_TOTP_SECRET } from '../src/lib/poc/totp-enrollment'
import { totpCode, wrongTotpCode } from './fixtures/totp'

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

  test('EPCS: a wrong authenticator code is rejected and the current one is accepted (real otplib)', async ({ page }) => {
    // otplib 13's verifySync returns { valid: false } for a wrong code — an
    // object, and truthy. The route read it as a boolean, so every 6-digit
    // code verified. This runs the real library in the real route: the code
    // is computed here from the seeded secret by an independent RFC 6238
    // implementation (e2e/fixtures/totp.ts), not by otplib.
    await loginAs(page, TEST_USERS.provider)

    const verify = (code: string) => page.request.post('/api/epcs?action=verify', {
      data: { provider_id: TEST_IDS.provider, code },
    })

    const wrong = await verify(wrongTotpCode(DEMO_TOTP_SECRET))
    const wrongBody = await wrong.json()
    expect({ status: wrong.status(), verified: wrongBody.verified }).toEqual({ status: 401, verified: false })

    const right = await verify(totpCode(DEMO_TOTP_SECRET))
    const rightBody = await right.json()
    expect({ status: right.status(), verified: rightBody.verified }).toEqual({ status: 200, verified: true })
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

  test('margin page with no duration selected: days supply and dispense computed from the selected package', async ({ page }) => {
    await loginAs(page, TEST_USERS.provider)
    await walkBuilderToMargin(page, PLAIN)

    // 10 mg of a 10 mg/mL injectable = 1 mL daily; 30 mL lasts 30 days.
    await expect(page.getByTestId('days-supply-value')).toHaveText('30 days')
    await expect(page.getByTestId('dispense-value')).toHaveText('30 mL')
    // No duration on this sig, so the explanation names the fallback basis.
    await expect(page.getByText('No duration selected, so days supply is how long the 30 mL package lasts at this dose and frequency.', { exact: false })).toBeVisible()
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
    // WO-102: Subtotal and Patient total both read $400.00 here (Tier1 ships free) — read the subtotal by test id.
    await expect(page.getByTestId('review-subtotal')).toHaveText('$400.00')
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
    await expect(page.getByTestId('review-subtotal')).toHaveText('$450.00')

    // ── Back lands on search with the session intact ──────────
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await expect(page).toHaveURL(/\/new-prescription\/search$/, { timeout: 10_000 })
    // Banner badge + label are separate spans: "2" · "prescriptions in this session".
    await expect(page.locator('p').filter({ hasText: 'prescriptions in this session' })).toContainText('2')
    await page.getByRole('button', { name: 'Review & Send' }).click()
    await expect(page).toHaveURL(/\/new-prescription\/review/, { timeout: 10_000 })
    await expect(page.getByText('Prescriptions (2)')).toBeVisible()
    await expect(page.getByTestId('review-subtotal')).toHaveText('$450.00')
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
    const rejectedBody = await rejected.json()
    expect(rejectedBody.error).toMatch(/belongs to another provider.*Sign as me/i)
    expect(rejectedBody.code).toBe('DRAFT_BELONGS_TO_OTHER_PROVIDER')

    const accepted = await page.request.post('/api/orders', { data: body(TEST_IDS.provider) })
    expect(accepted.status()).toBe(201)
  })
})

// ============================================================
// WO-103 — Search bar to top + Favorites/Protocols as buttons +
//          Save-as-favorite + mg display
// ============================================================
// Phase 21 acceptance criteria covered here (browser layer):
//   - the medication search input is visible without scrolling at 1366×768
//   - Favorites (N) and Protocols (N) open as panels; counts still shown
//   - Save Semaglutide-style line (10 units weekly, 5 mg/mL) from Review →
//     it appears in Favorites as "<name>" with a "10 units (0.5 mg) weekly"
//     dose chip (WO-104: the dose is a chip under the drug)
//   - edit that favorite's dose to 20 units → the chip shows "(1.0 mg)"
//   - delete removes it clinic-wide with a confirm

test.describe('Clinic App — WO-103 search bar, favorites/protocols panels, save-as-favorite, mg', () => {
  test.beforeAll(async () => {
    await seedStaticData()
    await cleanupTestFavorites()
  })

  test.afterEach(async () => {
    await cleanupTestOrders()
    await cleanupTestFavorites()
  })

  test('search input is visible without scrolling at 1366×768; Favorites / Protocols open as panels with counts', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 })
    await loginAs(page, TEST_USERS.provider)

    await page.goto('/new-prescription')
    await page.getByLabel('Search patients').fill('Test')
    await page.getByRole('button', { name: /Patient,\s*Test/i }).click()
    await pickProviderIfListed(page)
    await page.getByRole('button', { name: 'Continue to Pharmacy Search' }).click()
    await expect(page).toHaveURL(/\/new-prescription\/search/, { timeout: 10_000 })

    // The search input is the first element under the session banner and
    // sits inside the initial viewport — no scrolling.
    const search = page.getByLabel('Search medications')
    await expect(search).toBeVisible()
    await expect(search).toBeInViewport({ ratio: 1 })
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
    const box = await search.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.y + box!.height).toBeLessThanOrEqual(768)

    // Favorites (N) / Protocols (N) are buttons beside the search that open panels.
    const favButton = page.getByRole('button', { name: /^Favorites \(\d+\)$/ })
    const protoButton = page.getByRole('button', { name: /^Protocols \(\d+\)$/ })
    await expect(favButton).toBeVisible()
    await expect(protoButton).toBeVisible()
    await expect(favButton).toBeInViewport()
    await expect(page.getByTestId('favorites-panel')).toHaveCount(0)

    await favButton.click()
    await expect(page.getByTestId('favorites-panel')).toBeVisible()
    await expect(favButton).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByTestId('favorites-panel').getByRole('button', { name: '+ New' })).toBeVisible()

    await protoButton.click()
    await expect(page.getByTestId('protocols-panel')).toBeVisible()
    await expect(page.getByTestId('favorites-panel')).toHaveCount(0)
    await expect(page.getByTestId('protocols-panel').getByRole('button', { name: '+ New' })).toBeVisible()

    // "+ New" in Favorites hands focus to the search.
    await favButton.click()
    await page.getByTestId('favorites-panel').getByRole('button', { name: '+ New' }).click()
    await expect(page.getByTestId('favorites-panel')).toHaveCount(0)
    await expect(search).toBeFocused()
  })

  test('save a GLP-1 line from Review → Favorites shows "10 units (0.5 mg) weekly"; edit to 20 units → "(1.0 mg)"; delete with confirm', async ({ page }) => {
    await loginAs(page, TEST_USERS.provider)
    await walkBuilderToMargin(page, GLP1)

    // mg is computed from units × concentration on the margin page …
    await expect(page.getByTestId('dose-display')).toHaveText('10 units (0.5 mg)')
    await page.locator('#retail-price').fill('200.00')
    await page.getByRole('button', { name: /Review & Send/ }).click()
    await expect(page).toHaveURL(/\/new-prescription\/review/, { timeout: 10_000 })

    // … and on the Review card.
    await expect(page.locator('[data-testid^="dose-display-"]').first()).toHaveText('10 units (0.5 mg)')

    // ☆ Save as favorite — WO-104: the name defaults to the drug; the dose
    // is saved as a chip under it.
    await page.getByRole('button', { name: '☆ Save as favorite' }).click()
    const nameInput = page.getByLabel('Favorite name')
    await expect(nameInput).toHaveValue(TEST_CATALOG.glp1FormulationName)
    const favoriteName = 'E2E GLP1 10 units weekly'
    await nameInput.fill(favoriteName)
    await page.getByRole('button', { name: 'Save favorite' }).click()
    await expect(page.getByText('Saved to favorites')).toBeVisible()

    // Back to the search page with the session intact; open the Favorites panel.
    await page.getByRole('button', { name: '+ Add Another Prescription' }).click()
    await expect(page).toHaveURL(/\/new-prescription\/search/, { timeout: 10_000 })
    await page.getByRole('button', { name: /^Favorites \(\d+\)$/ }).click()
    const panel = page.getByTestId('favorites-panel')
    // WO-104: cards sit inside category groups (favorite-group-*); match the card itself.
    const row = panel.locator('[data-testid^="favorite-"]:not([data-testid^="favorite-group-"])').filter({ hasText: favoriteName })
      .filter({ has: page.getByTestId('favorite-custom') })
    await expect(row).toHaveCount(1)
    await expect(row.getByTestId('favorite-preset')).toHaveText('10 units (0.5 mg) weekly')

    // Edit the dose to 20 units → the mg follows.
    await page.getByRole('button', { name: `Edit favorite ${favoriteName}` }).click()
    await page.getByLabel('Favorite dose amount 1', { exact: true }).fill('20')
    await expect(page.getByTestId('favorite-dose-preview-1')).toHaveText('20 units (1.0 mg) weekly')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(row.getByTestId('favorite-preset')).toHaveText('20 units (1.0 mg) weekly', { timeout: 10_000 })

    const supabase = createClient(
      process.env['E2E_SUPABASE_URL']!,
      process.env['E2E_SUPABASE_SERVICE_ROLE_KEY']!
    )
    const { data: saved } = await supabase
      .from('provider_favorites')
      .select('label, dose_presets, pharmacy_id, formulation_id, patient_id, category, sig_text')
      .eq('provider_id', TEST_IDS.provider)
      .eq('label', favoriteName)
      .maybeSingle()
    expect(saved).toEqual(expect.objectContaining({
      pharmacy_id:    TEST_IDS.pharmacyTier1,
      formulation_id: TEST_IDS.glp1Formulation,
      patient_id:     null,
      // Derived from the ingredient's therapeutic_category, nothing typed.
      category:       'Testing — GLP-1',
      dose_presets:   [{ dose: '20', unit: 'units', frequency: 'QW', timing: '', duration: '', label: null }],
    }))
    // WO-104: doses are structured; no sig is stored on a favorite.
    expect(saved?.sig_text).toBeNull()

    // Delete — two-step confirm, removes it clinic-wide.
    await page.getByRole('button', { name: `Delete favorite ${favoriteName}` }).click()
    await expect(row.getByRole('button', { name: 'Confirm' })).toBeVisible()
    await row.getByRole('button', { name: 'Cancel' }).click()
    await expect(row).toHaveCount(1)
    await page.getByRole('button', { name: `Delete favorite ${favoriteName}` }).click()
    await row.getByRole('button', { name: 'Confirm' }).click()
    await expect(row).toHaveCount(0, { timeout: 10_000 })

    const { count } = await supabase
      .from('provider_favorites')
      .select('*', { count: 'exact', head: true })
      .eq('provider_id', TEST_IDS.provider)
      .eq('label', favoriteName)
    expect(count ?? 0).toBe(0)
  })
})

// ============================================================
// WO-104 — Favorites model: drug → common doses; sorting; Recent;
//          patient favorites (Gina Rooks, 2026-09-11)
// ============================================================
// Phase 21 acceptance criteria covered here (browser layer):
//   - migrated seed: the one-row-per-dose Semaglutide favorites collapse
//     (collapse_provider_favorites(), the migration's own function) to one
//     card with 10 / 20 / 40 units presets
//   - "20 units" chip → the DOSE STEP with amount, unit, frequency, timing
//     and duration populated; Continue → price step with the sig
//     "Inject 20 units (0.20mL / 1.00mg) subcutaneous once weekly…" and
//     the dose "20 units (1.0 mg)"
//   - Custom chip → dose step, formulation pre-selected, dropdowns live
//   - Recent strip shows last prescribed formulations; Make favorite
//     creates a card
//   - groups sorted in a fixed category order, A–Z within a group; a
//     favorite pinned to the selected patient surfaces first
// The GLP-1 analogue (5 mg/mL) stands in for Semaglutide.

async function startSearchAsProvider(page: Page, patientButton: RegExp = /Patient,\s*Test/i) {
  await loginAs(page, TEST_USERS.provider)
  await page.goto('/new-prescription')
  await page.getByLabel('Search patients').fill('Test')
  await page.getByRole('button', { name: patientButton }).click()
  await pickProviderIfListed(page)
  await page.getByRole('button', { name: 'Continue to Pharmacy Search' }).click()
  await expect(page).toHaveURL(/\/new-prescription\/search/, { timeout: 10_000 })
}

// The collapse keeps the most used of the three rows (the 10-unit one).
const SEMA_CARD_ID = 'aaaaaaaa-0000-4000-8000-000000000100'

test.describe('Clinic App — WO-104 favorites: doses as chips, dose step, Recent, categories, patient favorites', () => {
  test.beforeAll(async () => {
    await seedStaticData()
  })

  test.beforeEach(async () => {
    await cleanupTestFavorites()
  })

  test.afterEach(async () => {
    await cleanupTestOrders()
    await cleanupTestFavorites()
  })

  test('legacy Semaglutide favorites collapse to one card with 10 / 20 / 40 units; "20 units" opens the dose step, then prices', async ({ page }) => {
    const merged = await seedLegacySemaglutideFavorites()
    expect(merged).toBeGreaterThanOrEqual(2)

    const supabase = createClient(process.env['E2E_SUPABASE_URL']!, process.env['E2E_SUPABASE_SERVICE_ROLE_KEY']!)
    const { data: rows } = await supabase
      .from('provider_favorites')
      .select('favorite_id, label, category, dose_presets, use_count')
      .eq('provider_id', TEST_IDS.provider)
      .eq('formulation_id', TEST_IDS.glp1Formulation)
    expect(rows).toHaveLength(1)
    expect(rows![0]).toEqual(expect.objectContaining({
      favorite_id: SEMA_CARD_ID,
      label:       TEST_CATALOG.glp1IngredientName,
      category:    'Testing — GLP-1',
      use_count:   6,
    }))
    // Legacy "morning" / "30-days" normalised to the builder's codes.
    expect(rows![0]!.dose_presets).toEqual(['10', '20', '40'].map(dose => ({
      dose, unit: 'units', frequency: 'QW', timing: 'MORNING', duration: '30', label: `Semaglutide ${dose} units weekly`,
    })))

    await startSearchAsProvider(page)
    await page.getByRole('button', { name: /^Favorites \(\d+\)$/ }).click()
    const card = page.getByTestId(`favorite-${SEMA_CARD_ID}`)
    await expect(card.getByTestId('favorite-preset')).toHaveText([
      '10 units (0.5 mg) weekly', '20 units (1.0 mg) weekly', '40 units (2.0 mg) weekly',
    ])
    await expect(card.getByTestId('favorite-custom')).toBeVisible()

    // "20 units" → the dose step with the builder dropdowns, not the price step.
    await card.getByTestId('favorite-preset').filter({ hasText: /^20 units/ }).click()
    await expect(page.getByLabel('Dose amount')).toHaveValue('20', { timeout: 10_000 })
    await expect(page).toHaveURL(/\/new-prescription\/search/)
    await expect(page.getByLabel('Dose unit')).toHaveValue('units')
    await expect(page.getByLabel('Frequency')).toHaveValue('QW')
    await expect(page.getByLabel('Timing')).toHaveValue('MORNING')
    await expect(page.getByLabel('Duration')).toHaveValue('30')
    await expect(page.getByText('“Inject 20 units (0.20mL / 1.00mg) subcutaneous once weekly in the morning for 30 days”')).toBeVisible()

    // The pinned pharmacy is selected; continue to price as normal.
    const cont = page.getByRole('button', { name: /Continue.*Set Retail Price/i })
    await expect(cont).toBeEnabled({ timeout: 10_000 })
    await cont.click()
    await expect(page).toHaveURL(/\/new-prescription\/margin/, { timeout: 10_000 })
    await expect(page).toHaveURL(/durationDays=30/)
    await expect(page.getByTestId('dose-display')).toHaveText('20 units (1.0 mg)')
    await expect(page.getByLabel(/Sig \(Prescription Directions\)/)).toHaveValue(
      'Inject 20 units (0.20mL / 1.00mg) subcutaneous once weekly in the morning for 30 days',
    )
    await expect(page.getByTestId('days-supply-value')).toHaveText('30 days')
  })

  test('Custom opens the dose step with the formulation pre-selected and the dropdowns live', async ({ page }) => {
    await seedLegacySemaglutideFavorites()
    await startSearchAsProvider(page)
    await page.getByRole('button', { name: /^Favorites \(\d+\)$/ }).click()
    await page.getByTestId(`favorite-${SEMA_CARD_ID}`).getByTestId('favorite-custom').click()

    await expect(page.getByTestId('dose-step')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByLabel('Search medications')).toHaveValue(TEST_CATALOG.glp1IngredientName)
    await expect(page.getByLabel('Dose amount')).toHaveValue('')
    await expect(page.getByLabel('Frequency')).toHaveValue('')
    // The clinic's common doses are offered on the dose step too.
    await expect(page.getByTestId('dose-step-presets').getByRole('button')).toHaveCount(3)

    await page.getByLabel('Dose amount').fill('15')
    await page.getByLabel('Frequency').selectOption('QW')
    await expect(page.getByText('“Inject 15 units (0.15mL / 0.75mg) subcutaneous once weekly”')).toBeVisible()
    await expect(page.getByRole('button', { name: /Continue.*Set Retail Price/i })).toBeEnabled({ timeout: 10_000 })
  })

  test('Recent shows the last prescribed formulations; Make favorite creates a card', async ({ page }) => {
    await insertRecentOrder({
      formulationId: TEST_IDS.formulation, medicationName: TEST_CATALOG.formulationName,
      prescribedDose: '10 mg', frequencyCode: 'QD',
    })
    await startSearchAsProvider(page)
    await page.getByRole('button', { name: /^Favorites \(\d+\)$/ }).click()

    const item = page.getByTestId('favorites-recent').getByTestId(`recent-${TEST_IDS.formulation}`)
    await expect(item).toContainText(TEST_CATALOG.formulationName, { timeout: 10_000 })
    await expect(item).toContainText('10 mg daily · Test Pharmacy Tier1')
    await item.getByRole('button', { name: `Make ${TEST_CATALOG.formulationName} a favorite` }).click()
    await expect(item).toContainText('★ Favorite', { timeout: 10_000 })

    const card = page.getByTestId('favorites-panel').locator('[data-testid^="favorite-"]:not([data-testid^="favorite-group-"])').filter({ hasText: TEST_CATALOG.formulationName })
      .filter({ has: page.getByTestId('favorite-custom') })
    await expect(card).toHaveCount(1)
    await expect(card.getByTestId('favorite-preset')).toHaveText('10 mg daily')

    const supabase = createClient(process.env['E2E_SUPABASE_URL']!, process.env['E2E_SUPABASE_SERVICE_ROLE_KEY']!)
    const { data: saved } = await supabase
      .from('provider_favorites')
      .select('label, pharmacy_id, patient_id, dose_presets')
      .eq('provider_id', TEST_IDS.provider)
      .eq('formulation_id', TEST_IDS.formulation)
      .maybeSingle()
    expect(saved).toEqual({
      label: TEST_CATALOG.formulationName, pharmacy_id: TEST_IDS.pharmacyTier1, patient_id: null,
      dose_presets: [{ dose: '10', unit: 'mg', frequency: 'QD', timing: '', duration: '', label: null }],
    })

    // Clicking the Recent item opens its last dose on the dose step.
    await item.getByText(TEST_CATALOG.formulationName).click()
    await expect(page.getByLabel('Dose amount')).toHaveValue('10', { timeout: 10_000 })
    await expect(page.getByLabel('Dose unit')).toHaveValue('mg')
    await expect(page.getByLabel('Frequency')).toHaveValue('QD')
  })

  test('categories in a fixed order, A–Z within a group; a favorite saved for this patient surfaces first', async ({ page }) => {
    const supabase = createClient(process.env['E2E_SUPABASE_URL']!, process.env['E2E_SUPABASE_SERVICE_ROLE_KEY']!)
    const card = (label: string, category: string, formulationId: string, pharmacyId: string, patientId: string | null) => ({
      provider_id: TEST_IDS.provider, formulation_id: formulationId, pharmacy_id: pharmacyId, patient_id: patientId,
      label, category, sig_mode: 'standard',
      dose_presets: [{ dose: '1', unit: 'mL', frequency: 'QW', timing: '', duration: '', label: null }],
    })
    const { error } = await supabase.from('provider_favorites').insert([
      card('Zeta Peptide', 'Peptides', TEST_IDS.formulation, TEST_IDS.pharmacyTier1, null),
      card('Beta Hormone', 'Hormones', TEST_IDS.glp1Formulation, TEST_IDS.pharmacyTier2, null),
      card('Alpha Hormone', 'Hormones', TEST_IDS.controlledFormulation, TEST_IDS.pharmacyTier1, null),
      // Pinned to a different patient: never shown for this one.
      card('Other Patient Only', 'Peptides', TEST_IDS.glp1Formulation, TEST_IDS.pharmacyTier4, TEST_IDS.patientNkda),
    ])
    expect(error).toBeNull()

    // Save a dose for THIS patient with the ☆ on the dose step. (Stays on
    // one page: a full reload restores the session asynchronously.)
    await startSearchAsProvider(page)
    await page.getByLabel('Search medications').fill(TEST_CATALOG.glp1IngredientName)
    await page.getByRole('button', { name: new RegExp(TEST_CATALOG.glp1IngredientName, 'i') }).click()
    await page.getByRole('button', { name: new RegExp(TEST_CATALOG.glp1FormulationName, 'i') }).click()
    await page.getByLabel('Dose amount').fill('10')
    await page.getByLabel('Dose unit').selectOption('units')
    await page.getByLabel('Frequency').selectOption('QW')
    await page.getByRole('button', { name: /Test Pharmacy Tier1/ }).click()
    await page.getByRole('button', { name: `Save ${TEST_CATALOG.glp1FormulationName} as favorite` }).click()
    await page.getByLabel('Favorite name').fill('E2E For Test Patient')
    await page.getByLabel(/^Only for /).check()
    await page.getByRole('button', { name: 'Save favorite' }).click()
    await expect(page.getByText('Saved to favorites')).toBeVisible()
    const { data: pinned } = await supabase
      .from('provider_favorites')
      .select('patient_id, dose_presets')
      .eq('provider_id', TEST_IDS.provider)
      .eq('label', 'E2E For Test Patient')
      .maybeSingle()
    expect(pinned?.patient_id).toBe(TEST_IDS.patient)

    // 3 practice favorites + this patient's 1; the other patient's is never counted.
    await page.getByRole('button', { name: 'Favorites (4)', exact: true }).click()
    const panel = page.getByTestId('favorites-panel')
    const groups = panel.locator('[data-testid^="favorite-group-"]')
    await expect(groups).toHaveCount(3)
    await expect(groups.nth(0)).toHaveAttribute('data-testid', /^favorite-group-For Test /)
    await expect(groups.nth(0)).toContainText('E2E For Test Patient')
    await expect(groups.nth(1)).toHaveAttribute('data-testid', 'favorite-group-Peptides')
    await expect(groups.nth(2)).toHaveAttribute('data-testid', 'favorite-group-Hormones')
    await expect(groups.nth(2).locator('[data-testid^="favorite-"] p.text-sm')).toHaveText(['Alpha Hormone', 'Beta Hormone'])
    await expect(panel.getByText('Other Patient Only')).toHaveCount(0)

    // "Mine" keeps working: every card here is the test provider's own.
    await panel.getByLabel('Mine').check()
    await expect(groups).toHaveCount(3)
  })
})

// ============================================================
// WO-96 fix — derived days supply + dispense (Gina Rooks, 2026-09-11)
// ============================================================
// Production rendered Days supply and Dispense as "—" for this exact
// scenario because the derivation needed a quantity nobody was made to
// pick. The E2E seed's GLP-1 analogue stands in for Semaglutide 5 mg/mL
// (same concentration, packages 5 mL / 2.5 mL vial). Nothing is typed
// into Quantity; the duration picked on the dose step drives both values.

test.describe('Clinic App — WO-96 fix: days supply and dispense are never "—" when a duration is set', () => {
  test.beforeAll(async () => {
    await seedStaticData()
  })

  test.afterEach(async () => {
    await cleanupTestOrders()
  })

  test("Gina's scenario: 10 units once weekly for 30 days → 30 days / 0.4 mL on the price step and the Review card", async ({ page }) => {
    await loginAs(page, TEST_USERS.provider)

    await page.goto('/new-prescription')
    await page.getByLabel('Search patients').fill('Test')
    await page.getByRole('button', { name: /Patient,\s*Test/i }).click()
    await pickProviderIfListed(page)
    await page.getByRole('button', { name: 'Continue to Pharmacy Search' }).click()
    await expect(page).toHaveURL(/\/new-prescription\/search/, { timeout: 10_000 })

    await page.getByLabel('Search medications').fill(TEST_CATALOG.glp1IngredientName)
    await page.getByRole('button', { name: new RegExp(TEST_CATALOG.glp1IngredientName, 'i') }).click()
    await page.getByRole('button', { name: new RegExp(TEST_CATALOG.glp1FormulationName, 'i') }).click()
    await page.getByLabel('Dose amount').fill('10')
    await page.getByLabel('Dose unit').selectOption('units')
    await page.getByLabel('Frequency').selectOption('QW')
    await page.getByLabel('Timing').selectOption('MORNING')
    await page.getByLabel('Duration').selectOption('30')
    await page.getByRole('button', { name: /Test Pharmacy Tier1/ }).click()

    // Quantity is defaulted, not "Select quantity": the smallest priced
    // package that covers 0.4 mL. WO-101b: Tier1 prices only its 5 mL vial
    // (its "2.5mL vial" is listed in available_quantities with no price, so
    // it is no longer offered).
    const quantity = page.getByLabel('Quantity')
    await expect(quantity).toHaveValue('5mL vial')
    await expect(quantity.locator('option')).toHaveCount(1)
    await expect(page.getByRole('option', { name: 'Select quantity' })).toHaveCount(0)
    await expect(page.getByTestId('quantity-default-hint')).toContainText('covers 30 days')

    await page.getByRole('button', { name: /Continue.*Set Retail Price/i }).click()
    await expect(page).toHaveURL(/\/new-prescription\/margin/, { timeout: 10_000 })

    // Price step: populated, not "—".
    await expect(page.getByTestId('days-supply-value')).toHaveText('30 days')
    await expect(page.getByTestId('dispense-value')).toHaveText('0.4 mL')
    await expect(page.getByText('Computed once a quantity is selected', { exact: false })).toHaveCount(0)

    await page.locator('#retail-price').fill('200.00')
    await page.getByRole('button', { name: /Review & Send/ }).click()
    await expect(page).toHaveURL(/\/new-prescription\/review/, { timeout: 10_000 })

    // Review card: the Rx details summary carries both values.
    const row = page.locator('[data-testid^="rx-details-"]').first()
    await expect(row).toBeVisible({ timeout: 15_000 })
    await expect(row.getByRole('button', { name: /Rx details/ })).toContainText('30-day supply · dispense 0.4 mL')
    await expect(row).toContainText('Days supply: 30 days')
    await expect(row).toContainText('Dispense: 0.4 mL')
    await expect(row.getByText('—', { exact: true })).toHaveCount(0)
  })
})

// ============================================================
// WO-101 — package / vial size (Gina Rooks, 2026-09-11, item 3)
// ============================================================
// "Injectable vials come in various sizes so you also need to select vial
// size and cost varies based on that. Having some kind of calculation
// built in to help auto select vial size based on inputted Rx would be
// nice."
//
// E2E stand-in for Strive Semaglutide 5 mg/mL: the GLP-1 analogue at
// Test Pharmacy Tier2 with 1 mL $95 / 2.5 mL $165 / 5 mL $285 vials
// (e2e/fixtures/seed.ts). Tier1 sells the same formulation in a single
// package. Nothing is typed but the dose; the vial and its price follow.

test.describe('Clinic App — WO-101: vial size is suggested from the Rx and priced per vial', () => {
  test.beforeAll(async () => {
    await seedStaticData()
  })

  test.afterEach(async () => {
    await cleanupTestOrders()
  })

  async function buildGlp1(page: Page, units: string, durationDays = '30') {
    await loginAs(page, TEST_USERS.provider)
    await page.goto('/new-prescription')
    await page.getByLabel('Search patients').fill('Test')
    await page.getByRole('button', { name: /Patient,\s*Test/i }).click()
    await pickProviderIfListed(page)
    await page.getByRole('button', { name: 'Continue to Pharmacy Search' }).click()
    await expect(page).toHaveURL(/\/new-prescription\/search/, { timeout: 10_000 })

    await page.getByLabel('Search medications').fill(TEST_CATALOG.glp1IngredientName)
    await page.getByRole('button', { name: new RegExp(TEST_CATALOG.glp1IngredientName, 'i') }).click()
    await page.getByRole('button', { name: new RegExp(TEST_CATALOG.glp1FormulationName, 'i') }).click()
    await page.getByLabel('Dose amount').fill(units)
    await page.getByLabel('Dose unit').selectOption('units')
    await page.getByLabel('Frequency').selectOption('QW')
    await page.getByLabel('Timing').selectOption('MORNING')
    await page.getByLabel('Duration').selectOption(durationDays)
  }

  async function latestDraft() {
    const supabase = createClient(process.env['E2E_SUPABASE_URL']!, process.env['E2E_SUPABASE_SERVICE_ROLE_KEY']!)
    const { data } = await supabase
      .from('orders')
      .select('package_id, package_label, package_count, wholesale_price_snapshot, retail_price_snapshot, medication_snapshot, days_supply, dispense_quantity')
      .eq('clinic_id', TEST_IDS.clinic)
      .eq('pharmacy_id', TEST_IDS.pharmacyTier2)
      .eq('formulation_id', TEST_IDS.glp1Formulation)
      .eq('status', 'DRAFT')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    return data
  }

  test('10 units weekly for 30 days → 1 mL vial at $95.00; switching to the 5 mL vial reprices and is what the order stores', async ({ page }) => {
    await buildGlp1(page, '10')

    // Pharmacy row: suggested vial and its price, every vial priced.
    const tier2 = page.getByRole('button', { name: /Test Pharmacy Tier2/ })
    await expect(tier2.getByTestId('pharmacy-suggested-package')).toHaveText('1 mL vial')
    await expect(tier2).toContainText('$95.00')
    await expect(tier2.getByTestId('pharmacy-package-prices')).toHaveText('1 mL vial $95.00 · 2.5 mL vial $165.00 · 5 mL vial $285.00')
    await tier2.click()

    // No interim Quantity dropdown for a priced-package pharmacy.
    await expect(page.getByLabel('Quantity')).toHaveCount(0)

    await page.getByRole('button', { name: /Continue.*Set Retail Price/i }).click()
    await expect(page).toHaveURL(/\/new-prescription\/margin/, { timeout: 10_000 })

    await expect(page.getByTestId('package-summary')).toHaveText('Package: 1 mL vial (suggested for 30 days) · $95.00')
    await expect(page.getByTestId('days-supply-value')).toHaveText('30 days')
    await expect(page.getByTestId('dispense-value')).toHaveText('0.4 mL')

    const retail = page.locator('#retail-price')
    const retailAt95 = Number(await retail.inputValue())
    expect(retailAt95).toBeGreaterThan(95)
    const summary = page.getByText('Margin Summary').locator('..')

    // a) the provider selects the vial size; b) cost changes with it.
    // exact: WO-101a added "Number of packages" beside this dropdown, and
    // getByLabel matches substrings by default.
    await page.getByLabel('Package', { exact: true }).selectOption({ label: '5 mL vial — $285.00' })
    await expect(page.getByTestId('package-summary')).toHaveText('Package: 5 mL vial (changed by provider) · $285.00')
    const retailAt285 = Math.round(retailAt95 * 285 / 95 * 100) / 100
    await expect(retail).toHaveValue(retailAt285.toFixed(2))
    // Same integer-cent rule as the form: 15% of the margin, rounded to the cent.
    const feeAt285 = Math.round((Math.round(retailAt285 * 100) - 28500) * 15 / 100) / 100
    await expect(summary).toContainText(`$${feeAt285.toFixed(2)}`)
    // Days supply / dispense still follow the Rx.
    await expect(page.getByTestId('dispense-value')).toHaveText('0.4 mL')

    await page.getByRole('button', { name: /Save as Draft/ }).click()
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 })

    await expect.poll(latestDraft, { timeout: 15_000 }).toEqual(expect.objectContaining({
      package_id:               packageId(TEST_IDS.glp1PackagedPharmacyFormulation, '5 mL vial'),
      package_label:            '5 mL vial',
      wholesale_price_snapshot: 285,
      retail_price_snapshot:    retailAt285,
      days_supply:              30,
      dispense_quantity:        0.4,
      medication_snapshot:      expect.objectContaining({ quantity_label: '5 mL vial', wholesale_price: 285 }),
    }))
  })

  test('40 units weekly for 30 days → suggests the 2.5 mL vial and the price is $165.00', async ({ page }) => {
    await buildGlp1(page, '40')

    const tier2 = page.getByRole('button', { name: /Test Pharmacy Tier2/ })
    await expect(tier2.getByTestId('pharmacy-suggested-package')).toHaveText('2.5 mL vial')
    await expect(tier2).toContainText('$165.00')
    await tier2.click()
    await page.getByRole('button', { name: /Continue.*Set Retail Price/i }).click()
    await expect(page).toHaveURL(/\/new-prescription\/margin/, { timeout: 10_000 })

    await expect(page.getByTestId('package-summary')).toHaveText('Package: 2.5 mL vial (suggested for 30 days) · $165.00')
    await expect(page.getByTestId('dispense-value')).toHaveText('1.6 mL')
    const retail = Number(await page.locator('#retail-price').inputValue())
    expect(retail).toBeGreaterThanOrEqual(165)

    await page.getByRole('button', { name: /Save as Draft/ }).click()
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 })
    await expect.poll(latestDraft, { timeout: 15_000 }).toEqual(expect.objectContaining({
      package_id:               packageId(TEST_IDS.glp1PackagedPharmacyFormulation, '2.5 mL vial'),
      package_label:            '2.5 mL vial',
      wholesale_price_snapshot: 165,
      medication_snapshot:      expect.objectContaining({ quantity_label: '2.5 mL vial' }),
    }))
  })

  // WO-101a: no single vial holds the Rx → how many of which vial.
  test('80 units weekly for 90 days → 2 × 5 mL vials at $570.00, and the draft stores package_count 2', async ({ page }) => {
    await buildGlp1(page, '80', '90')

    const tier2 = page.getByRole('button', { name: /Test Pharmacy Tier2/ })
    await expect(tier2.getByTestId('pharmacy-suggested-package')).toHaveText('2 × 5 mL vials')
    await expect(tier2).toContainText('$570.00')
    await tier2.click()
    await page.getByRole('button', { name: /Continue.*Set Retail Price/i }).click()
    await expect(page).toHaveURL(/\/new-prescription\/margin/, { timeout: 10_000 })

    // 12 weekly doses × 0.8 mL = 9.6 mL; the 5 mL vial needs the fewest units.
    await expect(page.getByTestId('dispense-value')).toHaveText('9.6 mL')
    await expect(page.getByTestId('package-summary')).toHaveText('Package: 2 × 5 mL vials (suggested for 90 days) · $570.00')
    await expect(page.getByLabel('Number of packages')).toHaveValue('2')
    await expect(page.getByTestId('package-price')).toHaveText('$570.00')
    const retail = Number(await page.locator('#retail-price').inputValue())
    expect(retail).toBeGreaterThanOrEqual(570)

    await page.getByRole('button', { name: /Save as Draft/ }).click()
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 })
    await expect.poll(latestDraft, { timeout: 15_000 }).toEqual(expect.objectContaining({
      package_id:               packageId(TEST_IDS.glp1PackagedPharmacyFormulation, '5 mL vial'),
      package_label:            '5 mL vial',
      package_count:            2,
      wholesale_price_snapshot: 570,
      retail_price_snapshot:    retail,
      days_supply:              90,
      dispense_quantity:        9.6,
      medication_snapshot:      expect.objectContaining({ wholesale_price: 570, package_count: 2 }),
    }))
  })

  test('a pharmacy with a single package shows no package control', async ({ page }) => {
    await buildGlp1(page, '40')
    const tier1 = page.getByRole('button', { name: /Test Pharmacy Tier1/ })
    await expect(tier1.getByTestId('pharmacy-suggested-package')).toHaveCount(0)
    await expect(tier1).toContainText('$95.00')
    await tier1.click()
    await expect(page.getByLabel('Quantity')).toBeVisible()
    await page.getByRole('button', { name: /Continue.*Set Retail Price/i }).click()
    await expect(page).toHaveURL(/\/new-prescription\/margin/, { timeout: 10_000 })
    await expect(page.getByTestId('package-control')).toHaveCount(0)
    await expect(page.getByLabel('Package', { exact: true })).toHaveCount(0)
    await expect(page.getByLabel('Number of packages')).toHaveCount(0)
  })
})

// ============================================================
// WO-102 — shipping (Gina Rooks, 2026-09-11)
// ============================================================
// "I don't see [shipping] listed anywhere with the med pricing or when you
// get to review and sign … you pay shipping more than once."
//
// E2E stand-ins (e2e/fixtures/seed.ts TEST_SHIPPING): Test Pharmacy Tier2
// = "Strive" ($9 standard / $22 cold chain), Test Pharmacy Tier4 = "Quick
// Rx" ($12 / $25). The GLP-1 analogue ships cold chain; the plain compound
// ships standard. Signing can't be driven in headless CI (see the coverage
// note near the top of this file), so the send path is exercised through
// Save as Draft, which creates the drafts and allocates shipping across
// them exactly as Sign & Send does before it signs.

test.describe('Clinic App — WO-102: shipping once per pharmacy per order', () => {
  test.beforeAll(async () => {
    await seedStaticData()
  })

  test.afterEach(async () => {
    await cleanupTestOrders()
  })

  const TIER2 = TEST_IDS.pharmacyTier2
  const TIER4 = TEST_IDS.pharmacyTier4

  async function startSession(page: Page) {
    await loginAs(page, TEST_USERS.clinicAdmin)
    await page.goto('/new-prescription')
    await page.getByLabel('Search patients').fill('Test')
    await page.getByRole('button', { name: /Patient,\s*Test/i }).click()
    await pickProviderIfListed(page)
    await page.getByRole('button', { name: 'Continue to Pharmacy Search' }).click()
    await expect(page).toHaveURL(/\/new-prescription\/search/, { timeout: 10_000 })
  }

  async function buildGlp1(page: Page, units: string, pharmacy: RegExp) {
    await page.getByLabel('Search medications').fill(TEST_CATALOG.glp1IngredientName)
    await page.getByRole('button', { name: new RegExp(TEST_CATALOG.glp1IngredientName, 'i') }).click()
    await page.getByRole('button', { name: new RegExp(TEST_CATALOG.glp1FormulationName, 'i') }).click()
    await page.getByLabel('Dose amount').fill(units)
    await page.getByLabel('Dose unit').selectOption('units')
    await page.getByLabel('Frequency').selectOption('QW')
    await page.getByLabel('Timing').selectOption('MORNING')
    await page.getByLabel('Duration').selectOption('30')
    await page.getByRole('button', { name: pharmacy }).click()
    await page.getByRole('button', { name: /Continue.*Set Retail Price/i }).click()
    await expect(page).toHaveURL(/\/new-prescription\/margin/, { timeout: 10_000 })
  }

  async function buildPlain(page: Page, pharmacy: RegExp) {
    await page.getByLabel('Search medications').fill(TEST_CATALOG.ingredientName)
    await page.getByRole('button', { name: new RegExp(TEST_CATALOG.ingredientName, 'i') }).click()
    await page.getByRole('button', { name: new RegExp(TEST_CATALOG.formulationName, 'i') }).click()
    await page.getByLabel('Dose amount').fill('10')
    await page.getByLabel('Dose unit').selectOption('mg')
    await page.getByLabel('Frequency').selectOption('QD')
    await page.getByLabel('Timing').selectOption({ index: 1 })
    await page.getByLabel('Duration').selectOption({ index: 1 })
    await page.getByRole('button', { name: pharmacy }).click()
    await page.getByRole('button', { name: /Continue.*Set Retail Price/i }).click()
    await expect(page).toHaveURL(/\/new-prescription\/margin/, { timeout: 10_000 })
  }

  /** GLP-1 at Tier4 ("Quick Rx", cold chain) + plain at Tier2 ("Strive", standard), on to Review. */
  async function splitSession(page: Page, glp1Units = '10') {
    await startSession(page)
    await buildGlp1(page, glp1Units, /Test Pharmacy Tier4/)
    await expect(page.getByTestId('shipping-line')).toContainText(`Shipping (cold chain): $${TEST_SHIPPING.tier4.coldChain}.00`)
    await page.locator('#retail-price').fill('190.00')
    await page.getByRole('button', { name: 'Add & Search Another' }).click()
    await expect(page).toHaveURL(/\/new-prescription\/search/, { timeout: 10_000 })

    await buildPlain(page, /Test Pharmacy Tier2/)
    await expect(page.getByTestId('shipping-line')).toContainText(`Shipping (standard): $${TEST_SHIPPING.tier2.standard}.00`)
    await expect(page.getByTestId('shipping-line')).toContainText('not part of the margin')
    await page.locator('#retail-price').fill('200.00')
    // One line is already in the session, so the banner carries a "Review & Send"
    // link too — click the form's submit.
    await page.getByRole('button', { name: 'Review & Send (2)' }).click()
    await expect(page).toHaveURL(/\/new-prescription\/review/, { timeout: 10_000 })
  }

  async function drafts() {
    const supabase = createClient(process.env['E2E_SUPABASE_URL']!, process.env['E2E_SUPABASE_SERVICE_ROLE_KEY']!)
    const { data } = await supabase
      .from('orders')
      .select('formulation_id, pharmacy_id, shipping_fee, wholesale_price_snapshot, package_label')
      .eq('clinic_id', TEST_IDS.clinic)
      .eq('patient_id', TEST_IDS.patient)
      .eq('status', 'DRAFT')
      .eq('is_active', true)
      .order('created_at', { ascending: true })
    return (data ?? []).map(r => ({ ...r, shipping_fee: Number(r.shipping_fee), wholesale_price_snapshot: Number(r.wholesale_price_snapshot) }))
  }

  test('GLP-1 via "Quick Rx" (cold) + plain via "Strive" (standard) → $25 + $9 on Review and on the saved orders', async ({ page }) => {
    await splitSession(page)

    await expect(page.getByTestId(`shipping-${TIER4}`)).toContainText('$25.00', { timeout: 15_000 })
    await expect(page.getByTestId(`shipping-${TIER4}`)).toContainText('Test Pharmacy Tier4 (cold chain)')
    await expect(page.getByTestId(`shipping-${TIER2}`)).toContainText('$9.00')
    await expect(page.getByTestId('review-subtotal')).toHaveText('$390.00')
    // 15% of the ($95 + $100) margin — shipping never carries the fee.
    await expect(page.getByTestId('review-platform-fee')).toHaveText('$29.25')
    await expect(page.getByTestId('review-patient-total')).toHaveText('$424.00')
    await expect(page.getByTestId('multi-pharmacy-message')).toHaveText(
      '2 pharmacies → 2 shipping charges ($34.00). Route all to Test Pharmacy Tier2 to save $12.00.',
    )

    await page.getByRole('button', { name: /Save as Draft/ }).click()
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 })
    await expect.poll(drafts, { timeout: 15_000 }).toEqual([
      expect.objectContaining({ formulation_id: TEST_IDS.glp1Formulation, pharmacy_id: TIER4, shipping_fee: 25 }),
      expect.objectContaining({ formulation_id: TEST_IDS.formulation,     pharmacy_id: TIER2, shipping_fee: 9 }),
    ])
  })

  test('re-route all to "Strive" → $22 once (cold chain covers both); the saved orders carry it once', async ({ page }) => {
    await splitSession(page)

    const reroute = page.getByRole('button', { name: 'Route all to Test Pharmacy Tier2' })
    await expect(reroute).toBeVisible({ timeout: 15_000 })
    await reroute.click()

    await expect(page.getByTestId(`shipping-${TIER2}`)).toContainText('$22.00')
    await expect(page.getByTestId(`shipping-${TIER2}`)).toContainText('cold chain, 2 items in one shipment')
    await expect(page.getByTestId(`shipping-${TIER4}`)).toHaveCount(0)
    await expect(page.getByTestId('multi-pharmacy-notice')).toHaveCount(0)
    await expect(page.getByTestId('review-patient-total')).toHaveText('$412.00')

    await page.getByRole('button', { name: /Save as Draft/ }).click()
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 })
    await expect.poll(drafts, { timeout: 15_000 }).toEqual([
      // Re-priced at Tier2: the 1 mL vial this dose needs, still $95.
      expect.objectContaining({ formulation_id: TEST_IDS.glp1Formulation, pharmacy_id: TIER2, shipping_fee: 22, wholesale_price_snapshot: 95, package_label: '1 mL vial' }),
      expect.objectContaining({ formulation_id: TEST_IDS.formulation,     pharmacy_id: TIER2, shipping_fee: 0 }),
    ])
  })

  test('when re-routing would change a medication price, the notice says so with the net and offers no losing re-route', async ({ page }) => {
    // 40 units weekly: at Tier2 the dose needs the 2.5 mL vial ($165); at
    // Tier4 the plain compound is $110. Neither saves overall.
    await splitSession(page, '40')

    await expect(page.getByTestId('multi-pharmacy-message')).toHaveText(
      '2 pharmacies → 2 shipping charges ($34.00). Routing all to Test Pharmacy Tier4 would save $9.00 on shipping, ' +
      `but medication prices would rise $20.00 (${TEST_CATALOG.formulationName} $200.00 → $220.00) — $11.00 more overall, so it is not suggested.`,
      { timeout: 15_000 },
    )
    await expect(page.getByRole('button', { name: /Route all to/ })).toHaveCount(0)
  })

  test('checkout shows Shipping as its own line and the amount due is subtotal + shipping', async ({ page }) => {
    const supabase = createClient(process.env['E2E_SUPABASE_URL']!, process.env['E2E_SUPABASE_SERVICE_ROLE_KEY']!)
    const { data: inserted, error } = await supabase
      .from('orders')
      .insert({
        patient_id:               TEST_IDS.patient,
        provider_id:              TEST_IDS.provider,
        formulation_id:           TEST_IDS.glp1Formulation,
        clinic_id:                TEST_IDS.clinic,
        pharmacy_id:              TIER4,
        status:                   'AWAITING_PAYMENT',
        quantity:                 1,
        wholesale_price_snapshot: 95.00,
        retail_price_snapshot:    190.00,
        shipping_type:            'cold_chain',
        shipping_fee:             25.00,
        sig_text:                 'WO-102 checkout shipping E2E sig text',
        locked_at:                new Date().toISOString(),
      })
      .select('order_id')
      .single()
    if (error || !inserted) throw new Error(`Failed to seed WO-102 checkout order: ${error?.message}`)

    const { generateCheckoutToken } = await import('../src/lib/auth/checkout-token')
    const token = await generateCheckoutToken(inserted.order_id, TEST_IDS.patient, TEST_IDS.clinic)
    await page.goto(`/checkout/${token}`)
    await expect(page.getByLabel('Amount due: $215.00')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('checkout-subtotal')).toHaveText('$190.00')
    await expect(page.getByTestId('checkout-shipping')).toHaveText('$25.00')
  })
})

// ============================================================
// WO-101b — a pharmacy option lists only the sizes it prices
// ============================================================
// Prod, dr.chen, Alex Demo, Semaglutide Injectable 5 mg/mL, 20 units once
// weekly for 90 days (2.4 mL): Quick Rx's card read "3 × 1 mL vials ·
// Available: 1 mL vial, 3 mL vial" while no 3 mL vial was priced.
// "Test Pharmacy QuickRx" reproduces it: available_quantities lists 1 mL
// and 3 mL, one package row prices the 1 mL vial at $95.

test.describe('Clinic App — WO-101b: pharmacy sizes come from priced packages only', () => {
  test.beforeAll(async () => {
    await seedStaticData()
  })

  test.afterEach(async () => {
    await cleanupTestOrders()
  })

  test('the QuickRx card never offers the unpriced 3 mL vial; it prices three 1 mL vials, and "Strive" its 2.5 mL vial', async ({ page }) => {
    await loginAs(page, TEST_USERS.provider)
    await page.goto('/new-prescription')
    await page.getByLabel('Search patients').fill('Test')
    await page.getByRole('button', { name: /Patient,\s*Test/i }).click()
    await pickProviderIfListed(page)
    await page.getByRole('button', { name: 'Continue to Pharmacy Search' }).click()
    await expect(page).toHaveURL(/\/new-prescription\/search/, { timeout: 10_000 })

    await page.getByLabel('Search medications').fill(TEST_CATALOG.glp1IngredientName)
    await page.getByRole('button', { name: new RegExp(TEST_CATALOG.glp1IngredientName, 'i') }).click()
    await page.getByRole('button', { name: new RegExp(TEST_CATALOG.glp1FormulationName, 'i') }).click()
    await page.getByLabel('Dose amount').fill('20')
    await page.getByLabel('Dose unit').selectOption('units')
    await page.getByLabel('Frequency').selectOption('QW')
    await page.getByLabel('Timing').selectOption('MORNING')
    await page.getByLabel('Duration').selectOption('90')

    const quickRx = page.getByRole('button', { name: /Test Pharmacy QuickRx/ })
    await expect(quickRx.getByTestId('pharmacy-suggested-package')).toHaveText('3 × 1 mL vials')
    await expect(quickRx).toContainText('$285.00')
    await expect(quickRx.getByTestId('pharmacy-sizes')).toHaveText('Available: 1 mL vial')
    await expect(quickRx).not.toContainText('3 mL vial')

    const strive = page.getByRole('button', { name: /Test Pharmacy Tier2/ })
    await expect(strive.getByTestId('pharmacy-suggested-package')).toHaveText('2.5 mL vial')
    await expect(strive).toContainText('$165.00')

    // On the price step the package dropdown offers only what QuickRx prices.
    await quickRx.click()
    await page.getByRole('button', { name: /Continue.*Set Retail Price/i }).click()
    await expect(page).toHaveURL(/\/new-prescription\/margin/, { timeout: 10_000 })
    await expect(page.getByTestId('package-summary')).toHaveText('Package: 3 × 1 mL vials (suggested for 90 days) · $285.00')
    const packageOptions = page.getByLabel('Package', { exact: true }).locator('option')
    await expect(packageOptions).toHaveCount(1)
    await expect(packageOptions).toHaveText(['1 mL vial — $95.00 (suggested)'])
    await expect(page.getByText(/3 mL vial/)).toHaveCount(0)
  })
})

// ── WO-106: Refill lands on Review ─────────────────────────────────────────
//
// On prod, "Refill N prescriptions" landed on /new-prescription step 1
// instead of Review. The picker builds the session and pushes to Review,
// whose "no session → step 1" redirect requires a patient AND a provider.
// /refill only resolved a provider for a provider login; for a clinic
// admin or MA it passed none, so the refilled session had no provider and
// Review sent it to step 1 — every time, not a race.
//
// Asserting the URL alone is not enough: it is /review for a moment
// before the redirect replaces it, so each test waits for Review's own
// content and checks the URL after.
test.describe('Clinic App — WO-106 refill navigation', () => {
  test.beforeAll(async () => {
    await seedStaticData()
  })

  test.afterEach(async () => {
    await cleanupTestOrders()
  })

  async function seedRefillSource(): Promise<string> {
    const supabase = createClient(
      process.env['E2E_SUPABASE_URL']!,
      process.env['E2E_SUPABASE_SERVICE_ROLE_KEY']!
    )
    const { data: source, error } = await supabase
      .from('orders')
      .insert({
        patient_id:               TEST_IDS.patient,
        provider_id:              TEST_IDS.provider,
        catalog_item_id:          null,
        formulation_id:           TEST_IDS.formulation,
        clinic_id:                TEST_IDS.clinic,
        pharmacy_id:              TEST_IDS.pharmacyTier1,
        status:                   'AWAITING_PAYMENT',
        quantity:                 1,
        wholesale_price_snapshot: 100.00,
        retail_price_snapshot:    200.00,
        medication_snapshot:      {
          formulation_id:  TEST_IDS.formulation,
          medication_name: TEST_CATALOG.formulationName,
          prescribed_dose: '10 mg',
          frequency_code:  'QD',
        },
        pharmacy_snapshot:        { pharmacy_id: TEST_IDS.pharmacyTier1, name: 'Test Pharmacy Tier1' },
        sig_text:                 'Inject 10 mg subcutaneous once daily for 30 days',
        refills:                  2,
        locked_at:                new Date().toISOString(),
      })
      .select('order_id')
      .single()
    if (error || !source) throw new Error(`Failed to seed refill source order: ${error?.message}`)
    return source.order_id as string
  }

  /**
   * Wait for Review to render, and if it does not, fail with what was
   * actually on screen. CI artifacts need auth to read, so the diagnosis
   * has to travel in the error message itself.
   */
  async function expectReviewRendered(page: Page) {
    const totals = page.getByTestId('review-totals')
    try {
      await expect(totals).toBeVisible({ timeout: 15_000 })
    } catch {
      const diag = await page.evaluate(() => {
        let session: string | null = null
        try { session = sessionStorage.getItem('compoundiq-rx-session') } catch { session = 'unreadable' }
        const parsed = session ? JSON.parse(session) as {
          patient?: { patient_id?: string }
          provider?: { provider_id?: string }
          prescriptions?: unknown[]
        } : null
        return {
          url:           location.pathname + location.search,
          hasPatient:    !!parsed?.patient?.patient_id,
          hasProvider:   !!parsed?.provider?.provider_id,
          lineCount:     parsed?.prescriptions?.length ?? -1,
          bodyText:      document.body.innerText.replace(/\s+/g, ' ').slice(0, 400),
        }
      })
      throw new Error(`Review did not render. ${JSON.stringify(diag)}`)
    }
  }

  async function refillLandsOnReview(page: Page, orderId: string) {
    await page.goto(`/refill?order=${orderId}`)
    await expect(page.getByTestId(`refill-order-${orderId}`)).toBeVisible({ timeout: 10_000 })

    await page.getByTestId('refill-start').click()

    await expect(page).toHaveURL(/\/new-prescription\/review/, { timeout: 15_000 })
    await expectReviewRendered(page)
    await expect(page.getByText(TEST_CATALOG.formulationName).first()).toBeVisible()
    await expect(page).toHaveURL(/\/new-prescription\/review/)
  }

  test('clinic admin: Refill lands on Review with the refilled line, not on step 1', async ({ page }) => {
    const orderId = await seedRefillSource()
    await loginAs(page, TEST_USERS.clinicAdmin)
    await refillLandsOnReview(page, orderId)
    // The session carries the prescribing provider of the source order.
    await expect(page.getByText(/Test Provider/).first()).toBeVisible()
  })

  test('provider: Refill lands on Review with the refilled line, not on step 1', async ({ page }) => {
    const orderId = await seedRefillSource()
    await loginAs(page, TEST_USERS.provider)
    await refillLandsOnReview(page, orderId)
  })

  // ── The same click, reached the way a provider actually reaches it ──
  //
  // Sam reproduced the bounce to step 1 on prod as a PROVIDER, with the
  // banner reading "Prescribing as Sarah Chen" and the session holding a
  // patient, a provider and one prescription — so the provider-null cause
  // fixed above is not what he saw. The remaining suspect is ordering:
  // the picker calls router.push while sessionStorage is still empty
  // (clearSession removed it; the refilled session is only written by the
  // persist effect of the provider being left), and Review mounts a
  // DIFFERENT provider instance that can only read storage. Whether the
  // write lands first depends on how long the push takes to commit.
  //
  // page.goto() is a full document load, so nothing is in the client
  // router cache and the push must fetch /new-prescription/review — the
  // slowest case, and the one the test above takes. These three take the
  // paths a real session takes: soft navigations, and in the last one a
  // wizard walk that puts /new-prescription/review in the router cache
  // first, so the push can commit with no fetch at all.

  async function startRefillFromPicker(page: Page, orderId: string) {
    await expect(page.getByTestId(`refill-order-${orderId}`)).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('refill-start').click()
    await expect(page).toHaveURL(/\/new-prescription\/review/, { timeout: 15_000 })
    await expectReviewRendered(page)
    await expect(page).toHaveURL(/\/new-prescription\/review/)
  }

  test('provider, soft navigation: dashboard row Refill link then Refill', async ({ page }) => {
    const orderId = await seedRefillSource()
    await loginAs(page, TEST_USERS.provider)

    await page.getByTestId(`row-refill-${orderId}`).click()
    await expect(page).toHaveURL(/\/refill/, { timeout: 15_000 })
    await startRefillFromPicker(page, orderId)
  })

  test('provider, soft navigation: drawer "Refill this prescription" then Refill', async ({ page }) => {
    const orderId = await seedRefillSource()
    await loginAs(page, TEST_USERS.provider)

    await page.locator(`[data-order-id="${orderId}"]`).click()
    await page.getByTestId('drawer-refill').click()
    await expect(page).toHaveURL(/\/refill/, { timeout: 15_000 })
    await startRefillFromPicker(page, orderId)
  })

  // ── A titration refills at its maintenance dose ────────────────────
  //
  // Gina Rooks asked for the refill to be fast rather than re-entered.
  // For a finished titration that means the maintenance dose — the final
  // step — as an ordinary standard line, not the schedule again. Verified
  // on prod: 10 → 20 → 40 units weekly refills as dose "40 units",
  // sigMode "standard", no steps, dispense 1.6 mL. The arithmetic: 40
  // units is 0.4 mL on a U-100 syringe, weekly over the final step's 4
  // weeks (28 days) is 4 doses, so 1.6 mL over a 28-day supply.
  test('a finished titration refills at its maintenance dose, as a standard line', async ({ page }) => {
    const supabase = createClient(
      process.env['E2E_SUPABASE_URL']!,
      process.env['E2E_SUPABASE_SERVICE_ROLE_KEY']!
    )
    const { data: source, error } = await supabase
      .from('orders')
      .insert({
        patient_id:               TEST_IDS.patient,
        provider_id:              TEST_IDS.provider,
        catalog_item_id:          null,
        formulation_id:           TEST_IDS.glp1Formulation,
        clinic_id:                TEST_IDS.clinic,
        pharmacy_id:              TEST_IDS.pharmacyTier1,
        status:                   'AWAITING_PAYMENT',
        quantity:                 1,
        wholesale_price_snapshot: 80.00,
        retail_price_snapshot:    190.00,
        medication_snapshot:      {
          formulation_id:      TEST_IDS.glp1Formulation,
          medication_name:     TEST_CATALOG.glp1FormulationName,
          prescribed_dose:     '10 units',
          frequency_code:      'QW',
          concentration_value: 5,
          concentration_unit:  'mg/mL',
          form:                'Injectable Solution',
        },
        pharmacy_snapshot:        { pharmacy_id: TEST_IDS.pharmacyTier1, name: 'Test Pharmacy Tier1' },
        sig_text:                 'Weeks 1-4: inject 10 units subcutaneous once weekly. Weeks 5-8: inject 20 units subcutaneous once weekly. Weeks 9-12: inject 40 units subcutaneous once weekly.',
        sig_mode:                 'titration',
        titration_steps:          [
          { dose: '10', unit: 'units', frequency: 'QW', weeks: 4 },
          { dose: '20', unit: 'units', frequency: 'QW', weeks: 4 },
          { dose: '40', unit: 'units', frequency: 'QW', weeks: 4 },
        ],
        days_supply:              84,
        refills:                  2,
        locked_at:                new Date().toISOString(),
      })
      .select('order_id')
      .single()
    if (error || !source) throw new Error(`Failed to seed titration source order: ${error?.message}`)
    const orderId = source.order_id as string

    await loginAs(page, TEST_USERS.provider)

    // The line the picker puts in the session, as the API builds it.
    const res = await page.request.post('/api/orders/refill', { data: { orderIds: [orderId] } })
    expect(res.status()).toBe(200)
    const body = await res.json() as {
      lines: { dose: string; frequencyCode: string; sigMode: string; titrationSteps: unknown[]
               rxDetails: { dispenseQuantity: number; dispenseUnit: string; daysSupply: number }
               maintenanceNote: string | null; priceNote: string | null }[]
    }
    expect(body.lines).toHaveLength(1)
    const line = body.lines[0]!
    expect(line.dose).toBe('40 units')
    expect(line.frequencyCode).toBe('QW')
    // A refill of a finished titration is an ordinary line, not the
    // schedule again — the patient is past the ramp.
    expect(line.sigMode).toBe('standard')
    expect(line.titrationSteps).toEqual([])
    expect(line.rxDetails.dispenseQuantity).toBe(1.6)
    expect(line.rxDetails.dispenseUnit).toBe('mL')
    expect(line.rxDetails.daysSupply).toBe(28)
    // The reasons are carried, so nothing is applied silently.
    expect(line.maintenanceNote).toContain('40 units')
    expect(line.priceNote).toContain('was $80.00')

    // And the same through the UI. The source was priced at $80 and the
    // pharmacy charges $95 today, so WO-108 stops the line at the price
    // step first; confirming the suggested price continues to Review.
    await page.goto(`/refill?order=${orderId}`)
    await expect(page.getByTestId(`refill-order-${orderId}`)).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('refill-start').click()
    await expect(page).toHaveURL(/\/new-prescription\/margin/, { timeout: 15_000 })
    await expect(page.getByTestId('reprice-notice')).toContainText('was $80.00')
    await page.getByRole('button', { name: /Save Changes — Back to Review/ }).click()
    await expectReviewRendered(page)
    await expect(page.getByText(/40 units/).first()).toBeVisible()
    await expect(page.getByText(/dispense 1\.6 mL/).first()).toBeVisible()

    // WO-106: both decisions the refill made for the provider are on the
    // card. A titration that drops to its maintenance dose without saying
    // so is exactly what Gina objected to.
    const notes = page.getByTestId(/^refill-notes-/).first()
    await expect(notes).toBeVisible()
    await expect(notes).toContainText('Refilling at the maintenance dose, 40 units once weekly.')
    await expect(notes).toContainText('was $80.00')
  })

  test('provider, with /new-prescription/review already in the router cache', async ({ page }) => {
    const orderId = await seedRefillSource()
    await loginAs(page, TEST_USERS.provider)

    // Walk the wizard once: this is an ordinary session's first act, and
    // it leaves Review's payload in the client router cache, so the
    // refill push can commit without waiting for a fetch.
    await navigateToReviewPage(page)

    // Back to the dashboard the way the app offers it — a soft
    // navigation, not a reload.
    await page.getByRole('link', { name: 'Dashboard' }).first().click()
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 })

    await page.getByTestId(`row-refill-${orderId}`).click()
    await expect(page).toHaveURL(/\/refill/, { timeout: 15_000 })
    await startRefillFromPicker(page, orderId)

    // The refill replaced the wizard's session; the line on screen is the
    // refilled one, not what the wizard left behind.
    await expect(page.getByText(TEST_CATALOG.formulationName).first()).toBeVisible()
  })
})

// ── A reload mid-session keeps the session ─────────────────────────────
//
// Same defect as the refill bounce, reached another way. Every
// /new-prescription/* page mounts the session provider, which starts
// empty and restores from sessionStorage in its own effect; React runs a
// child's effects before its parent's, so SessionBanner's and
// BatchReviewForm's "no session -> step 1" redirects used to fire on that
// first commit, before the restore. A provider who reloaded the Review
// page — or whose browser reloaded it — lost their way back to step 1
// with the session still sitting in storage. Fixed in #158 by gating
// both redirects on isRestored; pinned here so it cannot come back.
test.describe('Clinic App — WO-106 a reload does not lose the session', () => {
  test.beforeAll(async () => {
    await seedStaticData()
  })

  test.afterEach(async () => {
    await cleanupTestOrders()
  })

  test('provider: reloading Review keeps the patient, the provider and the line', async ({ page }) => {
    await loginAs(page, TEST_USERS.provider)
    await navigateToReviewPage(page)
    await expect(page.getByTestId('review-totals')).toBeVisible({ timeout: 15_000 })
    const totalBefore = await page.getByTestId('review-patient-total').innerText()

    // The reload a provider does themself, or that a phone does when it
    // comes back to a backgrounded tab.
    await page.reload()

    await expect(page).toHaveURL(/\/new-prescription\/review/, { timeout: 15_000 })
    await expect(page.getByTestId('review-totals')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('review-patient-total')).toHaveText(totalBefore)
    await expect(page.getByText(new RegExp(TEST_CATALOG.formulationName, 'i')).first()).toBeVisible()
    // Still on Review after the redirect would have had time to fire.
    await expect(page).toHaveURL(/\/new-prescription\/review/)
  })

  test('provider: reloading the price step keeps the session too', async ({ page }) => {
    await loginAs(page, TEST_USERS.provider)
    await walkBuilderToMargin(page, PLAIN)

    await page.reload()

    await expect(page).toHaveURL(/\/new-prescription\/margin/, { timeout: 15_000 })
    // The banner only renders with a session; without one it redirects.
    await expect(page.getByText(/Prescribing as Test Provider|Test Patient/).first()).toBeVisible({ timeout: 15_000 })
    await expect(page).toHaveURL(/\/new-prescription\/margin/)
  })
})

// ── A refill priced below today's wholesale ────────────────────────────
//
// Verified on prod at cdd0565: a refill carries the source order's retail
// forward while taking the pharmacy's CURRENT wholesale, so a package
// price that rose since the original fill prices the line below cost.
// The card rendered a negative margin and a negative payout and Sign &
// Send stayed enabled — while POST /api/orders refuses retail < wholesale
// (route.ts) and the DB CHECK from 20260319000006 refuses it again. So
// the provider signed and then met a 422, one line at a time.
//
// Repricing is WO-107. What is pinned here is the safety: the refusal is
// on screen BEFORE the signature, and the two places that state the
// clinic's loss agree. The line card used to compute the platform fee as
// 15% of a negative margin — a negative fee — so it read -$29.75 against
// totals of -$35.00, as if the platform rebated 15% of the loss.
test.describe("Clinic App — WO-106 a refill below today's wholesale", () => {
  test.beforeAll(async () => {
    await seedStaticData()
  })

  test.afterEach(async () => {
    await cleanupTestOrders()
  })

  test('cannot be sent, says why before the signature, and states one loss', async ({ page }) => {
    const supabase = createClient(
      process.env['E2E_SUPABASE_URL']!,
      process.env['E2E_SUPABASE_SERVICE_ROLE_KEY']!
    )
    // A source order can never be below its own cost: the DB CHECK
    // chk_orders_retail_gte_wholesale refuses it. So the only way a
    // below-cost line reaches Review is the one taken here — the
    // wholesale moved ($50 to $95) and the provider left the price step
    // by the banner's shortcut, which navigates without saving. That is
    // the deep-link case the backstop exists for.
    const { data: source, error } = await supabase
      .from('orders')
      .insert({
        patient_id:               TEST_IDS.patient,
        provider_id:              TEST_IDS.provider,
        catalog_item_id:          null,
        formulation_id:           TEST_IDS.glp1Formulation,
        clinic_id:                TEST_IDS.clinic,
        pharmacy_id:              TEST_IDS.pharmacyTier1,
        status:                   'AWAITING_PAYMENT',
        quantity:                 1,
        wholesale_price_snapshot: 50.00,
        retail_price_snapshot:    60.00,
        medication_snapshot:      {
          formulation_id:      TEST_IDS.glp1Formulation,
          medication_name:     TEST_CATALOG.glp1FormulationName,
          prescribed_dose:     '10 units',
          frequency_code:      'QW',
          concentration_value: 5,
          concentration_unit:  'mg/mL',
          form:                'Injectable Solution',
        },
        pharmacy_snapshot:        { pharmacy_id: TEST_IDS.pharmacyTier1, name: 'Test Pharmacy Tier1' },
        sig_text:                 'Inject 10 units subcutaneous once weekly for 28 days',
        days_supply:              28,
        refills:                  2,
        locked_at:                new Date().toISOString(),
      })
      .select('order_id')
      .single()
    if (error || !source) throw new Error(`Failed to seed below-cost source order: ${error?.message}`)
    const orderId = source.order_id as string

    await loginAs(page, TEST_USERS.provider)
    await page.goto(`/refill?order=${orderId}`)
    await expect(page.getByTestId(`refill-order-${orderId}`)).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('refill-start').click()

    // WO-108 stops it at the price step; leave by the banner shortcut,
    // without pricing it.
    await expect(page).toHaveURL(/\/new-prescription\/margin/, { timeout: 15_000 })
    await page.getByRole('button', { name: 'Review & Send' }).click()
    await expect(page.getByTestId('review-totals')).toBeVisible({ timeout: 15_000 })

    // The refusal is here, on the card, not a 422 after the signature.
    const belowCost = page.getByTestId(/^below-cost-/).first()
    await expect(belowCost).toBeVisible()
    await expect(belowCost).toContainText('$60.00')
    await expect(belowCost).toContainText('$95.00')

    await expect(page.getByRole('button', { name: /Sign & Send/ })).toBeDisabled()
    // The banner and the button hint both say to edit the price; assert
    // the hint under the disabled button, exactly.
    await expect(page.getByText('Edit the price on the flagged prescriptions above to enable sending.')).toBeVisible()
    await expect(page.getByTestId('review-below-cost-banner')).toContainText('priced below what the pharmacy charges today')

    // One loss, stated the same way in both places: retail $60 against
    // wholesale $95 is -$35.00, and the platform fee on a loss is $0.00.
    await expect(page.getByTestId('review-platform-fee')).toHaveText('$0.00')
    await expect(page.getByTestId('review-clinic-payout')).toHaveText('$-35.00')
    await expect(page.getByText(/Clinic margin: \$-35\.00/)).toBeVisible()
  })
})

// ── WO-108: a refill whose package price moved stops at the price step ──
//
// The refill carried the source order's retail forward while taking the
// pharmacy's current wholesale, so the clinic silently absorbed every
// price move — and when the move was large enough the line fell below
// cost (WO-106 blocks sending that; it does not price it).
//
// The interrupt fires on the WHOLESALE moving, either direction, any
// amount: that is the moment a choice exists between the clinic's margin
// and the patient's price. It stops at the price step that already
// exists, with the preserved-margin number pre-filled and the reason on
// screen. A line whose wholesale has not moved is not interrupted.
test.describe('Clinic App — WO-108 repricing a refill', () => {
  test.beforeAll(async () => {
    await seedStaticData()
  })

  test.afterEach(async () => {
    await cleanupTestOrders()
  })

  /** A refillable GLP-1 order at the given prices. Tier1 prices it at $95 today. */
  async function seedPricedSource(wholesale: number, retail: number): Promise<string> {
    const supabase = createClient(
      process.env['E2E_SUPABASE_URL']!,
      process.env['E2E_SUPABASE_SERVICE_ROLE_KEY']!
    )
    const { data, error } = await supabase
      .from('orders')
      .insert({
        patient_id:               TEST_IDS.patient,
        provider_id:              TEST_IDS.provider,
        catalog_item_id:          null,
        formulation_id:           TEST_IDS.glp1Formulation,
        clinic_id:                TEST_IDS.clinic,
        pharmacy_id:              TEST_IDS.pharmacyTier1,
        status:                   'AWAITING_PAYMENT',
        quantity:                 1,
        wholesale_price_snapshot: wholesale,
        retail_price_snapshot:    retail,
        medication_snapshot:      {
          formulation_id:      TEST_IDS.glp1Formulation,
          medication_name:     TEST_CATALOG.glp1FormulationName,
          prescribed_dose:     '10 units',
          frequency_code:      'QW',
          concentration_value: 5,
          concentration_unit:  'mg/mL',
          form:                'Injectable Solution',
        },
        pharmacy_snapshot:        { pharmacy_id: TEST_IDS.pharmacyTier1, name: 'Test Pharmacy Tier1' },
        sig_text:                 'Inject 10 units subcutaneous once weekly for 28 days',
        days_supply:              28,
        refills:                  2,
        locked_at:                new Date().toISOString(),
      })
      .select('order_id')
      .single()
    if (error || !data) throw new Error(`Failed to seed priced source order: ${error?.message}`)
    return data.order_id as string
  }

  test('wholesale moved: stops at the price step, preserved margin pre-filled, reason on screen', async ({ page }) => {
    // $50 wholesale then, $95 now, $60 retail then → $114 keeps the 20%.
    const orderId = await seedPricedSource(50.00, 60.00)
    await loginAs(page, TEST_USERS.provider)
    await page.goto(`/refill?order=${orderId}`)
    await expect(page.getByTestId(`refill-order-${orderId}`)).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('refill-start').click()

    await expect(page).toHaveURL(/\/new-prescription\/margin/, { timeout: 15_000 })
    await expect(page.locator('#retail-price')).toHaveValue('114.00')
    await expect(page.getByTestId('reprice-notice')).toContainText('was $50.00')

    // Accepting the suggestion lands on Review at the new price. The
    // price step's own submit reads "Save Changes — Back to Review" when
    // it is editing a session line; the banner's "Review & Send" is a
    // shortcut that does NOT save (pinned separately below).
    await page.getByRole('button', { name: /Save Changes — Back to Review/ }).click()
    await expect(page).toHaveURL(/\/new-prescription\/review/, { timeout: 15_000 })
    await expect(page.getByTestId('review-subtotal')).toHaveText('$114.00')
    await expect(page.getByTestId(/^below-cost-/)).toHaveCount(0)
  })

  test('skipping the price step by the banner shortcut leaves the line unsendable', async ({ page }) => {
    // The banner's "Review & Send" navigates without saving, so a
    // provider can reach Review with the price unconfirmed. The backstop
    // is what makes that safe rather than silent.
    const orderId = await seedPricedSource(50.00, 60.00)
    await loginAs(page, TEST_USERS.provider)
    await page.goto(`/refill?order=${orderId}`)
    await expect(page.getByTestId(`refill-order-${orderId}`)).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('refill-start').click()
    await expect(page).toHaveURL(/\/new-prescription\/margin/, { timeout: 15_000 })

    await page.getByRole('button', { name: 'Review & Send' }).click()
    await expect(page.getByTestId('review-totals')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: /Sign & Send/ })).toBeDisabled()
  })

  test('wholesale unchanged: straight to Review, no interruption', async ({ page }) => {
    // $95 then and now — nothing to decide.
    const orderId = await seedPricedSource(95.00, 190.00)
    await loginAs(page, TEST_USERS.provider)
    await page.goto(`/refill?order=${orderId}`)
    await expect(page.getByTestId(`refill-order-${orderId}`)).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('refill-start').click()

    await expect(page).toHaveURL(/\/new-prescription\/review/, { timeout: 15_000 })
    await expect(page.getByTestId('review-totals')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('review-subtotal')).toHaveText('$190.00')
  })
})
