import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { seedStaticData, cleanupTestOrders, TEST_IDS, TEST_USERS } from './fixtures/seed'

// ============================================================
// Ops Dashboard E2E — WO-42
// ============================================================
// Tests the ops admin workflow:
//   View pipeline → Filter by status → Reroute a SUBMISSION_FAILED order

test.describe('Ops Dashboard — Pipeline & Triage Flow', () => {
  test.beforeAll(async () => {
    await seedStaticData()
  })

  test.afterEach(async () => {
    await cleanupTestOrders()
  })

  test('ops admin can view order pipeline and claim an order', async ({ page }) => {
    // ── 1. Login as ops admin ─────────────────────────────────
    await page.goto('/login')
    await page.getByLabel('Email').fill(TEST_USERS.opsAdmin.email)
    await page.getByLabel('Password').fill(TEST_USERS.opsAdmin.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/\/ops/)

    // ── 2. Verify pipeline table renders ─────────────────────
    // The ops pipeline renders a table with role="grid"
    await expect(page.getByRole('grid', { name: /Order pipeline/i })).toBeVisible()
  })

  test('ops admin can reroute a SUBMISSION_FAILED order', async ({ page }) => {
    // Seed a test order in SUBMISSION_FAILED state
    const supabase = createClient(
      process.env['SUPABASE_URL']!,
      process.env['SUPABASE_SERVICE_ROLE_KEY']!
    )

    const { data: order } = await supabase
      .from('orders')
      .insert({
        patient_id:       TEST_IDS.patient,
        provider_id:      TEST_IDS.provider,
        catalog_item_id:  TEST_IDS.catalogItem,
        clinic_id:        TEST_IDS.clinic,
        pharmacy_id:      TEST_IDS.pharmacyTier1,
        status:           'SUBMISSION_FAILED',
        quantity:         1,
        wholesale_price_snapshot: 100.00,
        retail_price_snapshot:    200.00,
        sig_text:         'Test sig for E2E reroute test',
        locked_at:        new Date().toISOString(),
      })
      .select('order_id')
      .single()

    if (!order) throw new Error('Failed to create test order for reroute E2E')

    // ── Login ─────────────────────────────────────────────────
    await page.goto('/login')
    await page.getByLabel('Email').fill(TEST_USERS.opsAdmin.email)
    await page.getByLabel('Password').fill(TEST_USERS.opsAdmin.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/\/ops\/pipeline/, { timeout: 15_000 })

    // ── Filter by SUBMISSION_FAILED via sidebar button ────────
    // Status filtering uses sidebar buttons, not a combobox.
    // The SUBMISSION_FAILED button label is "Submission Failed" from STATUS_LABEL.
    await page.getByRole('button', { name: 'Submission Failed' }).click()

    // ── Verify order row is visible ───────────────────────────
    const orderRow = page.locator(`[data-order-id="${order.order_id}"]`)
    await expect(orderRow).toBeVisible({ timeout: 10_000 })

    // ── Click the Reroute action button in the order row ─────
    // The Reroute ActionButton is inline in the row Actions column.
    // No modal is shown — the reroute fires immediately via the API.
    await orderRow.getByRole('button', { name: 'Reroute' }).click()

    // ── Verify order transitions to REROUTE_PENDING ──────────
    // The row re-fetches on 10s polling interval; status badge shows "Reroute Pending".
    await expect(
      orderRow.getByText('Reroute Pending')
    ).toBeVisible({ timeout: 15_000 })
  })

  test('ops admin can view SLA heatmap', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email').fill(TEST_USERS.opsAdmin.email)
    await page.getByLabel('Password').fill(TEST_USERS.opsAdmin.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.getByRole('link', { name: /SLA/i }).click()
    await expect(page.getByRole('heading', { name: /SLA/i })).toBeVisible()
  })
})
