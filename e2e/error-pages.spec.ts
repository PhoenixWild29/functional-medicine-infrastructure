import { randomBytes } from 'node:crypto'
import { test, expect } from '@playwright/test'
import { TEST_USERS } from './fixtures/seed'

// ============================================================
// Friendly error and not-found pages (B-2026-10-25-05)
// ============================================================
//
// A signed-in clinic user on a clinic URL that does not exist sees the
// staff not-found page with a way back to the dashboard (404, no stack, no
// framework text). A patient with a bad plan or intake link sees the
// patient copy, with no token, id or internal detail on the page.
//
// Locators are test ids and headings inside <main>: getByRole('alert')
// would also match Next's route announcer.

test.describe('error pages', () => {
  test('a clinic URL that does not exist: the staff not-found page, and back to the dashboard', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email address').fill(TEST_USERS.clinicAdmin.email)
    await page.getByLabel('Password', { exact: true }).fill(TEST_USERS.clinicAdmin.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    // A clinic admin lands on /practice (lib/auth/landing-route); any signed-in clinic page will do.
    await expect(page).toHaveURL(/\/(practice|dashboard)/, { timeout: 15_000 })

    const res = await page.goto('/settings/no-such-page')
    expect(res?.status()).toBe(404)
    const screen = page.getByTestId('not-found-staff')
    await expect(screen).toBeVisible({ timeout: 15_000 })
    await expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible()
    await expect(page.getByRole('main')).toHaveCount(1)
    const body = await page.locator('body').innerText()
    expect(body).not.toMatch(/404: This page could not be found|Unhandled Runtime Error|at [\w.]+ \(/)

    await screen.getByRole('link', { name: 'Back to dashboard' }).click()
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 })
  })

  test('a bad plan link and a bad intake link: the patient pages, with nothing internal on them', async ({ page }) => {
    const token = randomBytes(32).toString('base64url')

    await page.goto(`/plan/${token}`)
    const plan = page.getByRole('main')
    await expect(plan.getByRole('heading', { level: 1, name: 'This link is no longer active' })).toBeVisible({ timeout: 15_000 })
    await expect(plan.getByText('contact your clinic', { exact: false })).toBeVisible()
    let text = await page.locator('body').innerText()
    expect(text).not.toContain(token)
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
    expect(text).not.toMatch(/Something went wrong|Error:|stack/i)

    await page.goto(`/intake/${token}`)
    const intake = page.getByRole('main')
    await expect(intake.getByRole('heading', { level: 1, name: 'This link is no longer active' })).toBeVisible({ timeout: 15_000 })
    text = await page.locator('body').innerText()
    expect(text).not.toContain(token)
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
  })
})
