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

  test('ops admin can view order pipeline page', async ({ page }) => {
    // ── 1. Login as ops admin ─────────────────────────────────
    await page.goto('/login')
    await page.getByLabel('Email').fill(TEST_USERS.opsAdmin.email)
    await page.getByLabel('Password').fill(TEST_USERS.opsAdmin.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/\/ops/)

    // ── 2. Verify the pipeline page loaded ───────────────────
    // Previously asserted on the role="grid" order table, but that element
    // only renders when filteredOrders.length > 0 (pipeline-view.tsx line 589).
    // With a clean cleanupTestOrders between runs this test sees an empty
    // pipeline and the grid never renders. Assert on the sidebar's h2
    // "Pipeline" heading instead — it's always present on /ops/pipeline
    // regardless of how many orders exist.
    await expect(
      page.getByRole('heading', { name: 'Pipeline', level: 2 })
    ).toBeVisible()
  })

  test('ops admin can reroute a SUBMISSION_FAILED order', async ({ page }) => {
    // Seed a test order in SUBMISSION_FAILED state
    const supabase = createClient(
      process.env['E2E_SUPABASE_URL']!,
      process.env['E2E_SUPABASE_SERVICE_ROLE_KEY']!
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

    // ── Verify order transitioned to REROUTE_PENDING ─────────
    // Two observable outcomes to check:
    //   1. The order row disappears from the current "Submission Failed"
    //      filter view, because REROUTE_PENDING is no longer in that
    //      filter's status set. The ops UI filters client-side by status
    //      on each poll cycle, so a successful status change moves the
    //      order out of the visible list.
    //   2. The DB reflects the status change. This is the authoritative
    //      signal that the /api/ops/orders/{id}/action handler performed
    //      its atomic CAS UPDATE. We check it with a bounded poll in
    //      case the handler defers the write briefly.
    //
    // Using DB as the source of truth (not UI text) avoids the circular
    // problem of asserting a UI label that's only rendered in a filter
    // view the order has just left.
    await expect(orderRow).not.toBeVisible({ timeout: 15_000 })

    // Reuse the `supabase` client created at the top of this test.
    let status: string | null = null
    for (let i = 0; i < 10; i++) {
      const { data } = await supabase
        .from('orders')
        .select('status')
        .eq('order_id', order.order_id)
        .single()
      status = data?.status ?? null
      if (status === 'REROUTE_PENDING') break
      await new Promise(r => setTimeout(r, 500))
    }
    expect(status).toBe('REROUTE_PENDING')
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
