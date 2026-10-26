import { test, expect, type Locator, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { createHmac, randomUUID } from 'node:crypto'
import { seedStaticData, cleanupTestOrders, TEST_IDS, TEST_USERS } from './fixtures/seed'

// ============================================================
// HIPAA technical safeguards, end to end (B-2026-10-26-06)
// ============================================================
//
// The safeguards bundle-hipaa adds, checked in the browser:
//   1. Forgot password answers the same for a seeded and an unknown email.
//   2. Change password: covered by e2e/password-change.spec.ts (a throwaway
//      login is changed, signed out, signed in with the new one), so not
//      repeated here.
//   3. POST /api/auth/password from an ordinary (not recovery) session: 403.
//   4. Five failed sign-ins for one address alert ops on /ops/security,
//      which shows the account as a keyed-hash prefix, never the email.
//   5. /ops/access-review: ops reads it and filters by date; a clinic user
//      is refused, page and API.
//   6. Ops opening an order is asked for a reason first; closing the
//      prompt opens nothing (no detail request is made).
//   7. /help: reachable, and its topics work with the keyboard.
// Seeded users and the shared test clinic only. Step 6 makes one order
// row, as ops-dashboard.spec.ts does, and removes it. No card is entered,
// and no email is delivered: Supabase's built-in mail only reaches project
// members, and the route answers the same whatever it says.

const svc = () => createClient(process.env['E2E_SUPABASE_URL']!, process.env['E2E_SUPABASE_SERVICE_ROLE_KEY']!)

async function signIn(page: Page, email: string, password: string, landing: RegExp) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(landing, { timeout: 15_000 })
}

const isFocused = (l: Locator) => l.evaluate(el => el === document.activeElement)

/** Tab (forwards) until `target` has focus; fails if it never does. */
async function tabTo(page: Page, target: Locator, max = 120) {
  await expect(target).toBeVisible({ timeout: 15_000 })
  for (let i = 0; i < max; i++) {
    if (await isFocused(target)) return
    await page.keyboard.press('Tab')
  }
  expect(await isFocused(target), 'reachable with Tab').toBe(true)
}

test.describe('HIPAA safeguards', () => {
  test.beforeAll(async () => {
    await seedStaticData()
  })

  test('1. forgot password: the same answer for a seeded and an unknown email', async ({ page }) => {
    const answers: string[] = []
    for (const email of [TEST_USERS.clinicAdmin.email, `nobody-${randomUUID()}@compoundiq.test`]) {
      await page.goto('/forgot-password')
      await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible()
      await page.getByLabel('Email address').fill(email)
      await page.getByRole('button', { name: 'Send reset link' }).click()
      const sent = page.getByText('If an account uses that email, we sent it a link to set a new password.')
      await expect(sent).toBeVisible({ timeout: 15_000 })
      answers.push((await sent.textContent()) ?? '')
    }
    expect(answers[0]).toBe(answers[1])
  })

  test('3. an ordinary signed-in session cannot set a password through the reset endpoint (403)', async ({ page }) => {
    await signIn(page, TEST_USERS.clinicAdmin.email, TEST_USERS.clinicAdmin.password, /\/(practice|dashboard)/)
    // e2e-literal-password-ok: a random new password the endpoint must refuse (403), set on no account.
    const res = await page.request.post('/api/auth/password', { data: { password: `violet harbor ${randomUUID()}` } })
    expect(res.status()).toBe(403)
    expect((await res.json() as { error?: string }).error).toMatch(/sets a new password from a reset link/)
    // The page itself offers no form to this session either.
    await page.goto('/reset-password')
    await expect(page.getByRole('link', { name: 'Go to Settings' })).toBeVisible()
    await expect(page.getByLabel('New password')).toHaveCount(0)
  })

  test('4. five failed sign-ins for one address alert ops on /ops/security, with no raw email', async ({ page }) => {
    const secret = process.env['PHI_ACCESS_LOG_HASH_SECRET']
    // Without the audit hash secret no failure is counted per account (the
    // email is only ever stored as its keyed hash), so the 5-per-account
    // rule cannot fire. CI sets an E2E placeholder (ci.yml).
    test.skip(!secret, 'PHI_ACCESS_LOG_HASH_SECRET is not set, so the per-account rule cannot count')

    // An address with no account: nobody is throttled by these failures.
    const email = `hipaa-e2e-${randomUUID()}@compoundiq.test`
    for (let i = 0; i < 5; i++) {
      // e2e-literal-password-ok: a wrong password, sent on purpose to an address with no account.
      const res = await page.request.post('/api/sign-in', { data: { email, password: 'not the password 123' } })
      expect(res.status()).toBe(401)
    }
    const accountRef = createHmac('sha256', secret!).update(email).digest('hex').slice(0, 12)

    await signIn(page, TEST_USERS.opsAdmin.email, TEST_USERS.opsAdmin.password, /\/ops\/pipeline/)
    await page.goto('/ops/security')
    await expect(page.getByRole('heading', { name: 'Security', level: 1 })).toBeVisible()
    const row = page.getByRole('row').filter({ hasText: accountRef }).filter({ hasText: 'failures on one account' })
    await expect(row).toHaveCount(1, { timeout: 15_000 })
    await expect(page.getByTestId('failures-24h')).toBeVisible()
    // The address itself never reaches the page.
    expect(await page.content()).not.toContain(email)
  })

  test('5. /ops/access-review: ops filters by date and sees rows; a clinic user is refused', async ({ page, browser }) => {
    // A row for today: the clinic admin's dashboard view is logged.
    const clinic = await browser.newPage()
    await signIn(clinic, TEST_USERS.clinicAdmin.email, TEST_USERS.clinicAdmin.password, /\/(practice|dashboard)/)
    await clinic.goto('/dashboard')
    await expect(clinic.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 15_000 })

    // The clinic user is refused the page and the API.
    await clinic.goto('/ops/access-review')
    await expect(clinic).toHaveURL(/\/unauthorized/)
    const api = await clinic.request.get('/api/ops/access-review')
    expect([401, 403]).toContain(api.status())
    await clinic.close()

    await signIn(page, TEST_USERS.opsAdmin.email, TEST_USERS.opsAdmin.password, /\/ops\/pipeline/)
    await page.goto('/ops/access-review')
    await expect(page.getByRole('heading', { name: 'Access review', level: 1 })).toBeVisible()
    // Narrow the range to the last day shown ("To" defaults to today).
    const to = page.getByLabel('To', { exact: true })
    const today = await to.inputValue()
    await page.getByLabel('From', { exact: true }).fill(today)
    await page.getByRole('button', { name: 'Apply filters' }).click()
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/No access in this range/)).toHaveCount(0)
  })

  test('6. ops opening an order is asked for a reason; closing the prompt opens nothing', async ({ page }) => {
    const { data: order, error } = await svc().from('orders').insert({
      patient_id: TEST_IDS.patient, provider_id: TEST_IDS.provider, catalog_item_id: TEST_IDS.catalogItem,
      clinic_id: TEST_IDS.clinic, pharmacy_id: TEST_IDS.pharmacyTier1, status: 'SUBMISSION_FAILED', quantity: 1,
      wholesale_price_snapshot: 100.00, retail_price_snapshot: 200.00, sig_text: 'E2E access reason prompt',
      locked_at: new Date().toISOString(),
    }).select('order_id, order_number').single()
    if (error || !order) throw new Error(`could not create the test order: ${error?.message}`)

    try {
      const detailCalls: string[] = []
      page.on('request', r => { if (/\/api\/ops\/orders\/[^/]+\/detail/.test(r.url())) detailCalls.push(r.url()) })

      await signIn(page, TEST_USERS.opsAdmin.email, TEST_USERS.opsAdmin.password, /\/ops\/pipeline/)
      await page.getByRole('button', { name: 'Submission Failed' }).click()
      const row = page.locator(`[data-order-id="${order.order_id}"]`)
      await expect(row).toBeVisible({ timeout: 15_000 })
      // The order number (or the id's first 8 characters) opens the drawer.
      const label = (order.order_number as string | null) ?? (order.order_id as string).slice(0, 8)
      await row.getByRole('button', { name: label, exact: true }).click()

      const drawer = page.getByRole('dialog', { name: /^Order detail:/ })
      await expect(drawer.getByText('Why are you opening this order?')).toBeVisible()
      await expect(drawer.getByRole('button', { name: 'Open order' })).toBeDisabled()
      await drawer.getByRole('radio', { name: /^Emergency access/ }).check()
      await expect(drawer.getByText(/Emergency access is reviewed within 24 hours/)).toBeVisible()

      // Cancel: close the drawer without opening the order.
      await drawer.getByRole('button', { name: 'Close detail' }).click()
      await expect(drawer).toHaveCount(0)
      expect(detailCalls).toEqual([])
    } finally {
      await cleanupTestOrders()
    }
  })

  test('7. /help: open from the sidebar, topics and the way back work with the keyboard', async ({ page }) => {
    await signIn(page, TEST_USERS.clinicAdmin.email, TEST_USERS.clinicAdmin.password, /\/(practice|dashboard)/)
    // The sidebar's Help (pages also carry "Help" links to single topics).
    await tabTo(page, page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Help', exact: true }))
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/help$/)
    await expect(page.getByRole('heading', { name: 'Help', level: 1 })).toBeVisible()

    const topics = page.getByRole('list', { name: 'Help topics' })
    await expect(topics.getByRole('link')).toHaveCount(9)
    await tabTo(page, topics.getByRole('link', { name: /Add a patient/ }))
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/help\/add-a-patient$/)
    await expect(page.getByRole('heading', { name: 'Add a patient', level: 1 })).toBeVisible()

    await tabTo(page, page.getByRole('link', { name: 'All help topics' }))
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/help$/)
    await tabTo(page, topics.getByRole('link', { name: /Who to contact/ }))
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/help\/contact$/)
  })
})
