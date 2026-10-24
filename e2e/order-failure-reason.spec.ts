import { test, expect, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { seedStaticData, TEST_IDS, TEST_USERS } from './fixtures/seed'

// ============================================================
// #251: the clinic order drawer says why sending to the pharmacy failed
// ============================================================
//
// For an order in a failed submission state, the drawer shows one line:
// where it was going, why it failed (the latest failed adapter_submissions
// row's error_code, in plain words) and what happens next. The reason is
// read with the clinic user's own session (GET /api/orders/[id]/failure-
// reason, RLS applies), so this is the first check of that read against a
// real database. No failed submission row: the generic reason. An order
// that has not failed: no line and no request.
//
// Data (service role, E2E project only): three test-clinic orders and one
// adapter_submissions row, seeded in beforeAll; afterAll deletes the
// submission row and soft-deletes the orders, as cleanupTestOrders does.

const PHARMACY_NAME = 'Test Pharmacy Tier1'
const NEXT_STEP = 'CompoundIQ ops has been alerted and will re-route or retry.'

function e2eService() {
  return createClient(process.env['E2E_SUPABASE_URL']!, process.env['E2E_SUPABASE_SERVICE_ROLE_KEY']!)
}

function order(status: string, sig: string) {
  return {
    patient_id:               TEST_IDS.patient,
    provider_id:              TEST_IDS.provider,
    catalog_item_id:          TEST_IDS.catalogItem,
    clinic_id:                TEST_IDS.clinic,
    pharmacy_id:              TEST_IDS.pharmacyTier1,
    pharmacy_snapshot:        { pharmacy_id: TEST_IDS.pharmacyTier1, name: PHARMACY_NAME },
    status,
    quantity:                 1,
    wholesale_price_snapshot: 100.00,
    retail_price_snapshot:    200.00,
    sig_text:                 sig,
    locked_at:                new Date().toISOString(),
  }
}

async function signInAsClinicAdmin(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(TEST_USERS.clinicAdmin.email)
  await page.getByLabel('Password').fill(TEST_USERS.clinicAdmin.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/practice$/, { timeout: 15_000 })
}

/** Opens the order's drawer through the dashboard's ?order= link. */
async function openDrawer(page: Page, orderId: string) {
  await page.goto(`/dashboard?order=${orderId}`)
  const drawer = page.getByRole('dialog', { name: `Order details: ${orderId.slice(0, 4)}…${orderId.slice(-4)}` })
  await expect(drawer).toBeVisible({ timeout: 15_000 })
  return drawer
}

test.describe('#251 clinic order drawer: why sending to the pharmacy failed', () => {
  const ids = { declined: '', noSubmission: '', notFailed: '' }

  test.beforeAll(async () => {
    await seedStaticData()
    const db = e2eService()
    const { data, error } = await db.from('orders').insert([
      order('SUBMISSION_FAILED', 'E2E failure reason: declined'),
      order('SUBMISSION_FAILED', 'E2E failure reason: no submission row'),
      order('PAID_PROCESSING', 'E2E failure reason: not failed'),
    ]).select('order_id, sig_text')
    if (error || !data) throw new Error(`orders: ${error?.message}`)
    const bySig = (s: string) => data.find(o => o.sig_text === s)!.order_id as string
    ids.declined     = bySig('E2E failure reason: declined')
    ids.noSubmission = bySig('E2E failure reason: no submission row')
    ids.notFailed    = bySig('E2E failure reason: not failed')

    const { error: subError } = await db.from('adapter_submissions').insert({
      order_id: ids.declined, pharmacy_id: TEST_IDS.pharmacyTier1, tier: 'TIER_1_API', status: 'REJECTED',
      error_code: 'REJECTED', error_message: 'E2E raw adapter message: must never be shown',
      completed_at: new Date().toISOString(),
    })
    if (subError) throw new Error(`adapter_submissions: ${subError.message}`)
  })

  test.afterAll(async () => {
    const db = e2eService()
    const orderIds = Object.values(ids).filter(Boolean)
    if (!orderIds.length) return
    await db.from('adapter_submissions').delete().in('order_id', orderIds)
    await db.from('orders').update({ is_active: false, deleted_at: new Date().toISOString() }).in('order_id', orderIds)
  })

  test('a declined submission: where, why in plain words, and what happens next', async ({ page }) => {
    await signInAsClinicAdmin(page)
    const drawer = await openDrawer(page, ids.declined)
    const line = drawer.getByTestId('submission-failure')
    await expect(line).toHaveText(
      `Sending to ${PHARMACY_NAME} failed: the pharmacy declined the order. ${NEXT_STEP}`,
      { timeout: 15_000 },
    )
    await expect(line).toHaveAttribute('role', 'status')
    // Never the adapter's code or message.
    await expect(drawer).not.toContainText('E2E raw adapter message')
    await expect(line).not.toContainText('REJECTED')
  })

  test('no failed submission row: the generic reason, still where and what next', async ({ page }) => {
    await signInAsClinicAdmin(page)
    const drawer = await openDrawer(page, ids.noSubmission)
    await expect(drawer.getByTestId('submission-failure')).toHaveText(
      `Sending to ${PHARMACY_NAME} failed: the order could not be delivered to the pharmacy. ${NEXT_STEP}`,
      { timeout: 15_000 },
    )
  })

  test('an order that has not failed: no line, and no failure-reason request', async ({ page }) => {
    await signInAsClinicAdmin(page)
    const requests: string[] = []
    page.on('request', r => { if (r.url().includes('/failure-reason')) requests.push(r.url()) })

    // Open a failed order first, so the line is known to render on this
    // page; then the order that has not failed.
    const failed = await openDrawer(page, ids.declined)
    await expect(failed.getByTestId('submission-failure')).toBeVisible({ timeout: 15_000 })
    requests.length = 0

    const drawer = await openDrawer(page, ids.notFailed)
    await expect(drawer.getByRole('heading', { level: 2, name: ids.notFailed })).toBeVisible({ timeout: 15_000 })
    await expect(drawer.getByTestId('submission-failure')).toHaveCount(0)
    expect(requests).toEqual([])
  })
})
