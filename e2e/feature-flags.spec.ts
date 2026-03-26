import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { seedStaticData, cleanupTestOrders, TEST_IDS, TEST_USERS } from './fixtures/seed'
import { generateCheckoutToken } from '../src/lib/auth/checkout-token'

// ============================================================
// Feature Flag E2E — WO-69
// ============================================================
// Verifies that TWILIO_ENABLED=false and DOCUMO_ENABLED=false
// correctly suppress external service calls in CI / POC environments.
//
// Twilio test:
//   Goes through the full order creation wizard, signs & sends.
//   Asserts NO sms_log row is created for the order — the sender
//   returns early before any DB insert when TWILIO_ENABLED=false.
//
// Documo test (STRIPE_WEBHOOK_FORWARDING required):
//   Creates a Tier 4 (fax) order via DB, completes Stripe checkout,
//   polls orders.documo_fax_id for the synthetic
//   poc-disabled-fax-{orderId[0..7]}-attempt{N} value written by the
//   tier4-fax adapter when DOCUMO_ENABLED=false.
//
// Required env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — all tests
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
  test('TWILIO_ENABLED=false: no sms_log row created when payment link is sent', async ({ page }) => {
    const supabase = createClient(
      process.env['SUPABASE_URL']!,
      process.env['SUPABASE_SERVICE_ROLE_KEY']!
    )

    // ── 1. Login as clinic admin ────────────────────────────────
    await page.goto('/login')
    await page.getByLabel('Email').fill(TEST_USERS.clinicAdmin.email)
    await page.getByLabel('Password').fill(TEST_USERS.clinicAdmin.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 })

    // ── 2. Navigate the 3-step new prescription wizard ──────────
    // Step 1: /new-prescription — medication + state + pharmacy
    await page.goto('/new-prescription')
    await page.locator('#medication-search').fill('Test Compound')
    await expect(page.getByRole('option', { name: /Test Compound Injectable/i })).toBeVisible({ timeout: 10_000 })
    await page.getByRole('option', { name: /Test Compound Injectable/i }).click()
    await page.locator('#patient-state').selectOption('TX')
    await page.getByRole('button', { name: 'Search Pharmacies' }).click()
    await expect(page.getByRole('button', { name: /Test Pharmacy Tier1/ })).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: /Test Pharmacy Tier1/ }).click()

    // Step 2: /new-prescription/margin — retail price + sig text
    await expect(page).toHaveURL(/\/new-prescription\/margin/, { timeout: 10_000 })
    await page.locator('#retail-price').fill('200.00')
    await page.locator('#sig-text').fill('Feature flag E2E — Twilio suppression check')
    await page.getByRole('button', { name: 'Continue to Review' }).click()

    // Step 3: /new-prescription/review — patient + provider + compliance
    await expect(page).toHaveURL(/\/new-prescription\/review/, { timeout: 10_000 })
    await page.locator('#patient-select').selectOption(TEST_IDS.patient)
    await page.locator('#provider-select').selectOption(TEST_IDS.provider)
    await expect(page.getByText('Pre-Dispatch Compliance Checks')).toBeVisible()
    await expect(page.getByText('Running compliance checks…')).not.toBeVisible({ timeout: 15_000 })

    // ── 3. Draw signature and send payment link ─────────────────
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
    await expect(page.getByText('✓ Signature captured')).toBeVisible()

    await page.getByRole('button', { name: 'Sign & Send Payment Link' }).click()
    await expect(page.getByRole('dialog', { name: /Confirm & Send/i })).toBeVisible()
    await page.getByRole('button', { name: 'Confirm & Send' }).click()
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 })

    // ── 4. Retrieve the created order ID ────────────────────────
    // Filter on is_active=true to avoid matching soft-deleted stale rows
    // from prior test runs that cleanupTestOrders may have left behind.
    const { data: recent } = await supabase
      .from('orders')
      .select('order_id')
      .eq('clinic_id', TEST_IDS.clinic)
      .eq('status', 'AWAITING_PAYMENT')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (!recent) throw new Error('Feature flag test: could not find created order in DB')

    // ── 5. Assert no sms_log row exists for this order ──────────
    // When TWILIO_ENABLED=false, sendSms() returns early before writing to sms_log.
    // A count of 0 confirms the SMS was suppressed (not just delayed).
    const { count, error: smsCountError } = await supabase
      .from('sms_log')
      .select('*', { count: 'exact', head: true })
      .eq('order_id', recent.order_id)

    if (smsCountError) throw new Error(`sms_log count query failed: ${smsCountError.message}`)
    expect(count).toBe(0)
  })

  // ── Documo: DOCUMO_ENABLED=false ─────────────────────────────
  test('DOCUMO_ENABLED=false: synthetic fax ID written to orders.documo_fax_id', async ({ page }) => {
    if (!process.env['STRIPE_WEBHOOK_FORWARDING']) {
      test.skip(true, 'STRIPE_WEBHOOK_FORWARDING not set — Stripe CLI webhook forwarding required for this test')
    }

    // Documo polling (up to 60 s) + Stripe iframe interaction — extend timeout
    test.setTimeout(90_000)

    const supabase = createClient(
      process.env['SUPABASE_URL']!,
      process.env['SUPABASE_SERVICE_ROLE_KEY']!
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
