// ============================================================
// Compliance C3: multi-factor sign-in, end to end
// ============================================================
//
// Runs with MFA enforced for one account only (MFA_ENFORCED_EMAILS in
// ci.yml): test-mfa-admin@compoundiq.test. Every other spec signs in with
// a password as before, which is itself the "enforcement off is
// unchanged" check across the whole suite.
//
// The TOTP codes are computed here from the manual key the page shows
// (e2e/fixtures/totp.ts, independent of the libraries the app uses).
// Each run starts from no factor: the account's factors are deleted
// through the admin API, on the E2E project only.

import { test, expect, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { TEST_USERS } from './fixtures/seed'
import { totpCode } from './fixtures/totp'

const USER = TEST_USERS.mfaClinicAdmin

function admin() {
  return createClient(process.env['E2E_SUPABASE_URL']!, process.env['E2E_SUPABASE_SERVICE_ROLE_KEY']!)
}

async function resetFactors(): Promise<void> {
  const supabase = admin()
  const { data, error } = await supabase.auth.admin.listUsers()
  if (error) throw new Error(`listUsers failed: ${error.message}`)
  const user = data.users.find(u => u.email === USER.email)
  if (!user) throw new Error(`E2E MFA user ${USER.email} not found; global setup creates it`)
  const factors = await supabase.auth.admin.mfa.listFactors({ userId: user.id })
  if (factors.error) throw new Error(`listFactors failed: ${factors.error.message}`)
  for (const f of factors.data.factors) {
    const { error: delError } = await supabase.auth.admin.mfa.deleteFactor({ userId: user.id, id: f.id })
    if (delError) throw new Error(`deleteFactor failed: ${delError.message}`)
  }
}

async function signIn(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(USER.email)
  await page.getByLabel('Password').fill(USER.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

/** Wait until the 30 s TOTP window rolls over, so a code is never reused. */
async function nextTotpWindow(page: Page) {
  const msLeft = 30_000 - (Date.now() % 30_000)
  await page.waitForTimeout(msLeft + 1_000)
}

test.describe('Compliance C3: multi-factor sign-in (enforced for the E2E MFA user)', () => {
  test.beforeEach(async () => {
    await resetFactors()
  })

  test.afterAll(async () => {
    await resetFactors()
  })

  test('first sign-in enrolls a TOTP factor; every new sign-in is challenged', async ({ page }) => {
    // ── First sign-in: AAL1, no factor → enroll ──
    await signIn(page)
    await expect(page).toHaveURL(/\/mfa\/enroll/, { timeout: 15_000 })

    // At AAL1 the APIs refuse with a code a client can act on.
    const blocked = await page.request.get('/api/favorites')
    expect(blocked.status()).toBe(401)
    expect(await blocked.json()).toEqual(expect.objectContaining({ code: 'MFA_ENROLLMENT_REQUIRED' }))

    await expect(page.getByAltText('QR code for your authenticator app')).toBeVisible()
    const secret = (await page.getByTestId('mfa-manual-key').innerText()).replace(/\s+/g, '')
    expect(secret).toMatch(/^[A-Z2-7]+$/)

    await page.getByLabel('6-digit code').fill(totpCode(secret))
    await page.getByRole('button', { name: /Verify/ }).click()
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 })
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

    // ── AAL2: the APIs answer ──
    const allowed = await page.request.get('/api/favorites')
    expect(allowed.status()).not.toBe(401)

    // ── A new sign-in is challenged ──
    await page.context().clearCookies()
    await signIn(page)
    await expect(page).toHaveURL(/\/mfa\/challenge/, { timeout: 15_000 })
    const challenged = await page.request.get('/api/favorites')
    expect(challenged.status()).toBe(401)
    expect(await challenged.json()).toEqual(expect.objectContaining({ code: 'MFA_REQUIRED' }))

    // A wrong code is refused and stays on the challenge.
    await page.getByLabel('6-digit code').fill(totpCode(secret, Date.now() - 10 * 60_000))
    await page.getByRole('button', { name: /Verify/ }).click()
    await expect(page.getByRole('alert')).toContainText('did not match')
    await expect(page).toHaveURL(/\/mfa\/challenge/)

    await nextTotpWindow(page)
    await page.getByLabel('6-digit code').fill(totpCode(secret))
    await page.getByRole('button', { name: /Verify/ }).click()
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 })
  })

  test('a page reached at AAL1 goes to the challenge and comes back after it', async ({ page }) => {
    // Enroll first (the first test's flow), then start a fresh session.
    await signIn(page)
    await expect(page).toHaveURL(/\/mfa\/enroll/, { timeout: 15_000 })
    const secret = (await page.getByTestId('mfa-manual-key').innerText()).replace(/\s+/g, '')
    await page.getByLabel('6-digit code').fill(totpCode(secret))
    await page.getByRole('button', { name: /Verify/ }).click()
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 })

    await page.context().clearCookies()
    await signIn(page)
    await expect(page).toHaveURL(/\/mfa\/challenge/, { timeout: 15_000 })
    await page.goto('/settings')
    await expect(page).toHaveURL(/\/mfa\/challenge\?redirectTo=%2Fsettings/)

    await nextTotpWindow(page)
    await page.getByLabel('6-digit code').fill(totpCode(secret))
    await page.getByRole('button', { name: /Verify/ }).click()
    await expect(page).toHaveURL(/\/settings/, { timeout: 15_000 })
    await expect(page.getByTestId('sign-in-security')).toContainText('Two-step sign-in is on')
  })
})
