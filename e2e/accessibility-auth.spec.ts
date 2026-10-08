import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { createClient } from '@supabase/supabase-js'
import { TEST_USERS } from './fixtures/seed'
import { totpCode } from './fixtures/totp'

// ============================================================
// WCAG 2.1 AA: /mfa/enroll, /mfa/challenge, /unauthorized, real browser
// ============================================================
//
// src/__tests__/a11y/mfa-unauthorized-axe.test.tsx runs axe in jsdom,
// which cannot measure colour contrast or layout. This runs axe in
// Chromium (contrast included), checks reflow at 320 CSS px (WCAG 1.4.10)
// and that keyboard focus is visible.
//
// The MFA pages use the E2E MFA account (MFA_ENFORCED_EMAILS in ci.yml),
// its factors reset through the admin API on the E2E project only, as in
// e2e/mfa.spec.ts.

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']
const MFA_USER = TEST_USERS.mfaClinicAdmin

async function axeViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
  return results.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)
}

async function expectReflowsAt320(page: Page) {
  await page.setViewportSize({ width: 320, height: 640 })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
}

async function signIn(page: Page, user: { email: string; password: string }) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(user.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

async function resetMfaFactors(): Promise<void> {
  const supabase = createClient(process.env['E2E_SUPABASE_URL']!, process.env['E2E_SUPABASE_SERVICE_ROLE_KEY']!)
  const { data, error } = await supabase.auth.admin.listUsers()
  if (error) throw new Error(`listUsers failed: ${error.message}`)
  const user = data.users.find(u => u.email === MFA_USER.email)
  if (!user) throw new Error(`E2E MFA user ${MFA_USER.email} not found; global setup creates it`)
  const factors = await supabase.auth.admin.mfa.listFactors({ userId: user.id })
  if (factors.error) throw new Error(`listFactors failed: ${factors.error.message}`)
  for (const f of factors.data.factors) {
    const { error: delError } = await supabase.auth.admin.mfa.deleteFactor({ userId: user.id, id: f.id })
    if (delError) throw new Error(`deleteFactor failed: ${delError.message}`)
  }
}

async function wrongCode(page: Page, secret: string | null) {
  // A code from ten minutes ago never matches; without a secret, any six digits.
  await page.getByLabel('6-digit code').fill(secret ? totpCode(secret, Date.now() - 10 * 60_000) : '000000')
  await page.getByRole('button', { name: /Verify/ }).click()
  await expect(page.getByRole('alert')).toContainText('did not match', { timeout: 15_000 })
  await expect(page.getByLabel('6-digit code')).toHaveAttribute('aria-invalid', 'true')
}

test.describe('Accessibility: WCAG 2.1 AA, MFA and /unauthorized', () => {
  test('/unauthorized: no violations; title; visible focus; reflows at 320px', async ({ page }) => {
    await signIn(page, TEST_USERS.clinicAdmin)
    await expect(page).toHaveURL(/\/practice$/, { timeout: 15_000 })
    await page.goto('/ops/pipeline')
    await expect(page).toHaveURL(/\/unauthorized/, { timeout: 10_000 })
    await expect(page.getByRole('heading', { level: 1, name: 'Access Denied' })).toBeVisible()
    await expect(page).toHaveTitle(/Access Denied/)
    expect(await axeViolations(page)).toEqual([])

    const signOut = page.getByRole('button', { name: 'Sign out' })
    await page.keyboard.press('Tab')
    await expect(signOut).toBeFocused()
    expect(await signOut.evaluate(el => getComputedStyle(el).boxShadow)).not.toBe('none')

    await expectReflowsAt320(page)
  })

  test.describe('MFA pages (E2E MFA account)', () => {
    test.beforeEach(async () => { await resetMfaFactors() })
    test.afterAll(async () => { await resetMfaFactors() })

    test('/mfa/enroll and /mfa/challenge: no violations, wrong code included; visible focus; reflow', async ({ page }) => {
      // ── Enroll ──
      await signIn(page, MFA_USER)
      await expect(page).toHaveURL(/\/mfa\/enroll/, { timeout: 15_000 })
      await expect(page).toHaveTitle('Set up two-step sign-in')
      await expect(page.getByAltText('QR code for your authenticator app')).toBeVisible({ timeout: 15_000 })
      expect(await axeViolations(page)).toEqual([])

      const secret = (await page.getByTestId('mfa-manual-key').innerText()).replace(/\s+/g, '')
      await wrongCode(page, secret)
      expect(await axeViolations(page)).toEqual([])

      // Keyboard focus on the sign-out control is visible.
      const signOut = page.getByRole('button', { name: 'Sign out' })
      await page.getByRole('button', { name: /Verify/ }).focus()
      await page.keyboard.press('Tab')
      await expect(signOut).toBeFocused()
      expect(await signOut.evaluate(el => getComputedStyle(el).boxShadow)).not.toBe('none')

      await expectReflowsAt320(page)
      await page.setViewportSize({ width: 1280, height: 720 })

      await page.getByLabel('6-digit code').fill(totpCode(secret))
      await page.getByRole('button', { name: /Verify/ }).click()
      await expect(page).toHaveURL(/\/practice/, { timeout: 15_000 })

      // ── Challenge, on a new sign-in ──
      await page.context().clearCookies()
      await signIn(page, MFA_USER)
      await expect(page).toHaveURL(/\/mfa\/challenge/, { timeout: 15_000 })
      await expect(page).toHaveTitle('Two-step sign-in')
      await expect(page.getByLabel('6-digit code')).toBeVisible({ timeout: 15_000 })
      expect(await axeViolations(page)).toEqual([])

      await wrongCode(page, secret)
      expect(await axeViolations(page)).toEqual([])
      await expectReflowsAt320(page)
    })
  })
})
