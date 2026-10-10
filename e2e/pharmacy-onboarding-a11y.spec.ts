import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { createClient } from '@supabase/supabase-js'
import { TEST_USERS } from './fixtures/seed'
import { totpCode } from './fixtures/totp'
import { hashInviteToken, inviteExpiry, generateInviteToken } from '../src/lib/pharmacy-onboarding/invite-token'
import { ONBOARDING_STEPS } from '../src/lib/pharmacy-onboarding/steps'

// ============================================================
// Pharmacy onboarding: WCAG 2.1 AA in a real browser
// ============================================================
//
// The same checks as the clinic onboarding block in accessibility.spec.ts
// (axe with the WCAG 2.0/2.1 A and AA tags, contrast included, and reflow
// at 320px), on the invite-accept page, every wizard step, the ops
// pharmacies list and the ops application review page.
//
// The block seeds its own data (service role, E2E project only) and
// removes it afterwards: a pending invite, a pharmacy in onboarding with
// its application, and a pharmacy_admin login. A pharmacy_admin always
// signs in with MFA, so the login enrolls a TOTP factor first
// (e2e/fixtures/totp.ts, as mfa.spec.ts does). Nothing is submitted, so no
// append-only record (BAA acceptance, event) is written.

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

const PH_ID = 'aaaaaaaa-0000-0000-0000-0000000000b1'
const PH_APP_ID = 'aaaaaaaa-0000-0000-0000-0000000000b2'
const PH_NAME = 'A11y Onboarding Pharmacy'
const PH_ADMIN = { email: 'test-pharmacy-onboarding-admin@compoundiq.test', password: 'TestPassword123!' }
const PH_INVITEE = 'test-pharmacy-onboarding-invitee@compoundiq.test'
const PH_INVITED_NAME = 'A11y Invited Pharmacy'

function e2eService() {
  return createClient(process.env['E2E_SUPABASE_URL']!, process.env['E2E_SUPABASE_SERVICE_ROLE_KEY']!)
}

async function axeViolations(page: Page, scope?: string): Promise<string[]> {
  const builder = new AxeBuilder({ page }).withTags(WCAG_TAGS)
  const results = await (scope ? builder.include(scope) : builder).analyze()
  return results.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)
}

async function expectReflowsAt320(page: Page) {
  await page.setViewportSize({ width: 320, height: 640 })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 15_000 })
}

test.describe('Accessibility: pharmacy onboarding (WCAG 2.1 AA)', () => {
  const invite = generateInviteToken()
  let adminUserId: string | null = null

  async function removeFactors() {
    if (!adminUserId) return
    const supabase = e2eService()
    const factors = await supabase.auth.admin.mfa.listFactors({ userId: adminUserId })
    if (factors.error) throw new Error(`listFactors: ${factors.error.message}`)
    for (const f of factors.data.factors) {
      const { error } = await supabase.auth.admin.mfa.deleteFactor({ userId: adminUserId, id: f.id })
      if (error) throw new Error(`deleteFactor: ${error.message}`)
    }
  }

  test.beforeAll(async () => {
    const supabase = e2eService()

    // A pharmacy being onboarded (inactive, as the CHECK requires).
    const { error: phErr } = await supabase.from('pharmacies').upsert({
      pharmacy_id: PH_ID, name: PH_NAME, slug: 'a11y-onboarding-pharmacy', integration_tier: 'TIER_4_FAX',
      is_active: false, onboarding_status: 'onboarding', email: PH_ADMIN.email,
    }, { onConflict: 'pharmacy_id' })
    if (phErr) throw new Error(`onboarding pharmacy: ${phErr.message}`)

    // Its admin: role and pharmacy in app_metadata only.
    const { data: { users } } = await supabase.auth.admin.listUsers({ perPage: 1000 })
    const ops = users.find(u => u.email === TEST_USERS.opsAdmin.email)
    const appMetadata = { app_role: 'pharmacy_admin', clinic_id: null, pharmacy_id: PH_ID }
    const existing = users.find(u => u.email === PH_ADMIN.email)
    if (existing) {
      const { error } = await supabase.auth.admin.updateUserById(existing.id, { password: PH_ADMIN.password, app_metadata: appMetadata })
      if (error) throw new Error(`pharmacy admin: ${error.message}`)
      adminUserId = existing.id
    } else {
      const { data, error } = await supabase.auth.admin.createUser({ email: PH_ADMIN.email, password: PH_ADMIN.password, email_confirm: true, app_metadata: appMetadata })
      if (error || !data.user) throw new Error(`pharmacy admin: ${error?.message}`)
      adminUserId = data.user.id
    }
    await removeFactors()

    const { error: appErr } = await supabase.from('pharmacy_onboarding_applications').upsert({
      application_id: PH_APP_ID, pharmacy_id: PH_ID, admin_user_id: adminUserId, status: 'in_progress', steps_completed: [],
    }, { onConflict: 'application_id' })
    if (appErr) throw new Error(`onboarding application: ${appErr.message}`)

    // A pending invite for the accept page (no pharmacy until it is accepted).
    await supabase.from('pharmacy_invites').delete().eq('admin_email', PH_INVITEE)
    const { error: inviteErr } = await supabase.from('pharmacy_invites').insert({
      pharmacy_name: PH_INVITED_NAME, admin_email: PH_INVITEE, token_hash: hashInviteToken(invite.token),
      expires_at: inviteExpiry(), created_by: ops?.id ?? adminUserId,
    })
    if (inviteErr) throw new Error(`pharmacy invite: ${inviteErr.message}`)
  })

  test.afterAll(async () => {
    const supabase = e2eService()
    await supabase.from('pharmacy_invites').delete().eq('admin_email', PH_INVITEE)
    await supabase.from('pharmacy_onboarding_applications').delete().eq('application_id', PH_APP_ID)
    if (adminUserId) {
      await removeFactors()
      await supabase.auth.admin.deleteUser(adminUserId)
    }
    await supabase.from('pharmacies').delete().eq('pharmacy_id', PH_ID)
  })

  test('invite-accept page, pending: no violations; focus ring on the submit; reflows at 320px', async ({ page }) => {
    await page.goto(`/onboard/pharmacy/${invite.token}`)
    await expect(page.getByRole('heading', { level: 1, name: 'Set up your pharmacy' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByLabel('Full name')).toBeVisible()
    await expect(page.getByLabel('Confirm password')).toBeVisible()
    expect(await axeViolations(page)).toEqual([])
    const submit = page.getByRole('button', { name: 'Create account' })
    await submit.focus()
    expect(await submit.evaluate(el => getComputedStyle(el).boxShadow)).not.toBe('none')
    await expectReflowsAt320(page)
  })

  test('invite-accept page, invalid link: no violations; reflows at 320px', async ({ page }) => {
    await page.goto('/onboard/pharmacy/not-a-real-invite-token-0000000000')
    await expect(page.getByRole('heading', { level: 1, name: 'This link is not valid' })).toBeVisible({ timeout: 15_000 })
    expect(await axeViolations(page)).toEqual([])
    await expectReflowsAt320(page)
  })

  test('wizard: every step has no violations and reflows at 320px', async ({ page }) => {
    // First sign-in of a pharmacy_admin: enroll TOTP, then land on the wizard.
    await signIn(page, PH_ADMIN.email, PH_ADMIN.password)
    await expect(page).toHaveURL(/\/mfa\/enroll/, { timeout: 15_000 })
    const secret = (await page.getByTestId('mfa-manual-key').innerText()).replace(/\s+/g, '')
    await page.getByLabel('6-digit code').fill(totpCode(secret))
    await page.getByRole('button', { name: /Verify/ }).click()
    await expect(page).toHaveURL(/\/pharmacy\/onboarding/, { timeout: 15_000 })

    await expect(page.getByRole('heading', { level: 1, name: 'Set up your pharmacy' })).toBeVisible({ timeout: 15_000 })
    const nav = page.getByRole('navigation', { name: 'Onboarding steps' })
    for (const { label } of ONBOARDING_STEPS) {
      await page.setViewportSize({ width: 1280, height: 900 })
      await nav.getByRole('button', { name: new RegExp(`^\\d*\\s*${label}`) }).click()
      await expect(page.locator('#step-heading')).toHaveText(label)
      expect({ step: label, violations: await axeViolations(page) }).toEqual({ step: label, violations: [] })
      await expectReflowsAt320(page)
    }
  })

  test('ops pharmacies list: the page content has no violations', async ({ page }) => {
    await signIn(page, TEST_USERS.opsAdmin.email, TEST_USERS.opsAdmin.password)
    await page.goto('/ops/onboarding/pharmacies')
    await expect(page.getByRole('heading', { level: 1, name: 'Pharmacy onboarding' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('heading', { level: 2, name: 'Invite a pharmacy' })).toBeVisible()
    expect(await axeViolations(page, 'main')).toEqual([])
  })

  test('ops application review: the page content has no violations', async ({ page }) => {
    await signIn(page, TEST_USERS.opsAdmin.email, TEST_USERS.opsAdmin.password)
    await page.goto(`/ops/onboarding/pharmacies/${PH_APP_ID}`)
    await expect(page.getByRole('heading', { level: 1, name: PH_NAME })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('heading', { level: 2, name: 'State licenses' })).toBeVisible()
    expect(await axeViolations(page, 'main')).toEqual([])
  })
})
