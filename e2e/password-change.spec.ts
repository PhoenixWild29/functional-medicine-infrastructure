/**
 * B11 (technical-safeguards-evidence-2026-10-25.md): change password in
 * Settings > Account, end to end, and the "Forgot password?" link.
 *
 * A throwaway medical assistant login in the shared test clinic is made in
 * beforeAll and removed in afterAll, so no shared login's password changes.
 * The forgot-password form is not submitted: that would ask Supabase to
 * send a real email.
 */

import { test, expect, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { TEST_IDS } from './fixtures/seed'

const EMAIL = `test-password-change-${process.env['TEST_SHARD'] ?? '1'}@compoundiq.test`
const OLD = 'TestPassword123!-old'
const NEW = 'violet harbor 42 lantern'

function service() {
  return createClient(process.env['E2E_SUPABASE_URL']!, process.env['E2E_SUPABASE_SERVICE_ROLE_KEY']!)
}

async function signIn(page: Page, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(EMAIL)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

test.describe('Password: change in Settings > Account (B11)', () => {
  // The tests run in order on one login: the third signs in with the password the second set.
  test.describe.configure({ mode: 'serial' })

  let userId: string | null = null

  test.beforeAll(async () => {
    const db = service()
    const { data: { users } } = await db.auth.admin.listUsers({ perPage: 1000 })
    const existing = users.find(u => u.email === EMAIL)
    if (existing) await db.auth.admin.deleteUser(existing.id)
    const { data, error } = await db.auth.admin.createUser({
      email: EMAIL, password: OLD, email_confirm: true,
      app_metadata: { app_role: 'medical_assistant', clinic_id: TEST_IDS.clinic },
    })
    if (error || !data.user) throw new Error(`password-change user: ${error?.message}`)
    userId = data.user.id
  })

  test.afterAll(async () => {
    if (userId) await service().auth.admin.deleteUser(userId)
  })

  test('login links to "Forgot password?", which explains the reset', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('link', { name: 'Forgot password?' }).click()
    await expect(page).toHaveURL(/\/forgot-password$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Reset your password' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Send reset link' })).toBeDisabled()
  })

  test('changes the password; the old one stops working, the new one signs in', async ({ page }) => {
    await signIn(page, OLD)
    await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 15_000 })

    await page.goto('/settings#account')
    const account = page.getByTestId('settings-account')
    await account.getByLabel('Current password').fill(OLD)
    await account.getByLabel('New password', { exact: true }).fill(NEW)
    await account.getByLabel('Confirm new password').fill(NEW)
    await account.getByRole('button', { name: 'Change password' }).click()
    await expect(account.getByTestId('change-password-done')).toHaveText('Your password was changed. You were signed out on your other devices.', { timeout: 15_000 })

    await page.getByRole('button', { name: 'Sign out' }).first().click()
    await page.waitForURL(/\/login/, { timeout: 15_000 })

    await signIn(page, OLD)
    await expect(page.locator('#login-error')).toHaveText('Invalid email or password. Please try again.', { timeout: 15_000 })

    await signIn(page, NEW)
    await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 15_000 })
  })

  test('a common new password is refused with the policy message', async ({ page }) => {
    await signIn(page, NEW)
    await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 15_000 })
    await page.goto('/settings#account')
    const account = page.getByTestId('settings-account')
    await account.getByLabel('Current password').fill(NEW)
    await account.getByLabel('New password', { exact: true }).fill('Password1234')
    await account.getByLabel('Confirm new password').fill('Password1234')
    await account.getByRole('button', { name: 'Change password' }).click()
    await expect(account.getByTestId('change-password-error')).toHaveText('That password is too common. Choose one that is harder to guess.', { timeout: 15_000 })
  })
})
