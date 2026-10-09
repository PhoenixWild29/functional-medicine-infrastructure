import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { createClient } from '@supabase/supabase-js'
import { generateCheckoutToken } from '../src/lib/auth/checkout-token'
import { cleanupTestOrders, TEST_IDS, TEST_USERS } from './fixtures/seed'
import { hashInviteToken, inviteExpiresAt, newInviteToken } from '../src/lib/onboarding/tokens'

// ============================================================
// Compliance C10: WCAG 2.1 AA, patient-facing pages, real browser
// ============================================================
//
// src/__tests__/a11y/patient-pages-axe.test.tsx runs axe in jsdom, which
// cannot measure colour contrast or layout. This runs axe in Chromium
// (contrast included) on every checkout state, the success and expired
// pages and login, and checks reflow at 320 CSS px (the 400% / 200%
// zoom criterion, WCAG 1.4.10) and the keyboard order.
//
// Stripe's Payment Element is a cross-origin iframe Stripe owns; it is
// excluded from the scan. Our side of it (the named fieldset around it)
// is checked here and in the jest test.

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']
const STRIPE_FRAMES = 'iframe[name^="__privateStripeFrame"], iframe[src*="js.stripe.com"]'

async function axeViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).exclude(STRIPE_FRAMES).analyze()
  return results.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)
}

async function expectReflowsAt320(page: Page) {
  await page.setViewportSize({ width: 320, height: 640 })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
}

async function insertOrder(status: string): Promise<string> {
  const supabase = createClient(process.env['E2E_SUPABASE_URL']!, process.env['E2E_SUPABASE_SERVICE_ROLE_KEY']!)
  const { data, error } = await supabase
    .from('orders')
    .insert({
      patient_id: TEST_IDS.patient, provider_id: TEST_IDS.provider, catalog_item_id: TEST_IDS.catalogItem,
      clinic_id: TEST_IDS.clinic, pharmacy_id: TEST_IDS.pharmacyTier1, status, quantity: 1,
      wholesale_price_snapshot: 100.00, retail_price_snapshot: 200.00,
      sig_text: 'Test sig for E2E accessibility test, at least 10 chars', locked_at: new Date().toISOString(),
    })
    .select('order_id')
    .single()
  if (error || !data) throw new Error(`Failed to create test order: ${error?.message}`)
  return data.order_id
}

test.describe('Accessibility: WCAG 2.1 AA (C10)', () => {
  const tokens: Record<'open' | 'paid' | 'cancelled', string> = { open: '', paid: '', cancelled: '' }

  test.beforeAll(async () => {
    for (const [state, status] of [['open', 'AWAITING_PAYMENT'], ['paid', 'PAID_PROCESSING'], ['cancelled', 'CANCELLED']] as const) {
      const orderId = await insertOrder(status)
      tokens[state] = await generateCheckoutToken(orderId, TEST_IDS.patient, TEST_IDS.clinic)
    }
  })

  test.afterAll(async () => {
    await cleanupTestOrders()
  })

  test('checkout, open: no violations; the payment region is named; reflows at 320px', async ({ page }) => {
    await page.goto(`/checkout/${tokens.open}`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(page.getByLabel('Email (optional)')).toBeVisible({ timeout: 15_000 })
    // The fieldset renders once the payment intent loads; Stripe may not
    // load in headless CI, in which case the page shows its own alert.
    // Scoped to <main>: Next.js renders its own hidden role="alert" route
    // announcer, which a page-wide getByRole('alert') also matches.
    await expect(page.getByRole('group', { name: 'Payment details' }).or(page.getByRole('main').getByRole('alert')).first()).toBeVisible({ timeout: 15_000 })
    expect(await axeViolations(page)).toEqual([])
    await expectReflowsAt320(page)
  })

  test('checkout, open: the email field is the first stop on the keyboard and shows focus', async ({ page }) => {
    await page.goto(`/checkout/${tokens.open}`)
    const email = page.getByLabel('Email (optional)')
    await expect(email).toBeVisible({ timeout: 15_000 })
    await page.keyboard.press('Tab')
    await expect(email).toBeFocused()
    const ring = await email.evaluate(el => getComputedStyle(el).boxShadow)
    expect(ring).not.toBe('none')
  })

  test('checkout, paid: no violations; reflows at 320px', async ({ page }) => {
    await page.goto(`/checkout/${tokens.paid}`)
    await expect(page.getByText('Payment Already Processed')).toBeVisible({ timeout: 15_000 })
    expect(await axeViolations(page)).toEqual([])
    await expectReflowsAt320(page)
  })

  test('checkout, cancelled: no violations; reflows at 320px', async ({ page }) => {
    await page.goto(`/checkout/${tokens.cancelled}`)
    await expect(page.getByText('Order No Longer Active')).toBeVisible({ timeout: 15_000 })
    expect(await axeViolations(page)).toEqual([])
    await expectReflowsAt320(page)
  })

  test('checkout, expired link: no violations; reflows at 320px', async ({ page }) => {
    await page.goto('/checkout/invalid-token-that-does-not-exist')
    await expect(page.getByRole('heading', { name: /link has expired/i })).toBeVisible({ timeout: 15_000 })
    await expect(page).toHaveTitle('Payment link expired')
    expect(await axeViolations(page)).toEqual([])
    await expectReflowsAt320(page)
  })

  test('success, pending confirmation: no violations; reflows at 320px', async ({ page }) => {
    await page.goto('/checkout/success?payment_intent=pi_e2e_unknown&redirect_status=succeeded')
    await expect(page.getByRole('heading', { name: 'Payment Received' })).toBeVisible({ timeout: 15_000 })
    await expect(page).toHaveTitle('Payment confirmation')
    expect(await axeViolations(page)).toEqual([])
    await expectReflowsAt320(page)
  })

  test('success, payment unsuccessful: no violations; reflows at 320px', async ({ page }) => {
    await page.goto('/checkout/success?payment_intent=pi_e2e_unknown&redirect_status=failed')
    await expect(page.getByRole('heading', { name: 'Payment Unsuccessful' })).toBeVisible({ timeout: 15_000 })
    expect(await axeViolations(page)).toEqual([])
    await expectReflowsAt320(page)
  })

  test('login: no violations, error included; keyboard order; reflows at 320px', async ({ page }) => {
    await page.goto('/login?error=auth_callback_failed')
    // #login-error, not getByRole('alert'): Next.js's route announcer is also an alert.
    await expect(page.locator('#login-error')).toBeVisible({ timeout: 15_000 })
    await expect(page).toHaveTitle('Sign in')
    expect(await axeViolations(page)).toEqual([])

    await page.getByLabel('Email address').focus()
    await page.keyboard.press('Tab')
    await expect(page.getByLabel('Password')).toBeFocused()
    await page.getByLabel('Email address').fill('a11y@example.test')
    await page.getByLabel('Password').fill('not-a-real-password')
    await page.getByLabel('Password').focus()
    await page.keyboard.press('Tab')
    const signIn = page.getByRole('button', { name: 'Sign in' })
    await expect(signIn).toBeFocused()
    const ring = await signIn.evaluate(el => getComputedStyle(el).boxShadow)
    expect(ring).not.toBe('none')

    await expectReflowsAt320(page)
  })
})

// ============================================================
// Clinic onboarding: invite pages, every wizard step, ops screen
// ============================================================
//
// Same checks in a real browser (contrast included). The block seeds its
// own clinic in onboarding, a pending invite and a clinic admin login
// (service role, E2E project only), and removes them afterwards. Payout
// setup is not live, so no Stripe is involved.

const ONB_CLINIC = 'aaaaaaaa-0000-0000-0000-0000000000a1'
const ONB_ADMIN = { email: 'test-onboarding-admin@compoundiq.test', password: 'TestPassword123!' }
const ONB_INVITEE = 'test-onboarding-invitee@compoundiq.test'
const WIZARD_STEPS = ['Practice details', 'Providers', 'Staff', 'BAA', 'Terms of service', 'Payouts', 'Review and submit']

function e2eService() {
  return createClient(process.env['E2E_SUPABASE_URL']!, process.env['E2E_SUPABASE_SERVICE_ROLE_KEY']!)
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 15_000 })
}

test.describe('Accessibility: clinic onboarding (WCAG 2.1 AA)', () => {
  const inviteToken = newInviteToken()
  let adminUserId: string | null = null

  test.beforeAll(async () => {
    const supabase = e2eService()
    const { error: clinicErr } = await supabase.from('clinics').upsert({
      clinic_id: ONB_CLINIC, name: 'A11y Onboarding Clinic', is_active: false, onboarding_status: 'in_progress',
    }, { onConflict: 'clinic_id' })
    if (clinicErr) throw new Error(`onboarding clinic: ${clinicErr.message}`)

    const { data: { users } } = await supabase.auth.admin.listUsers({ perPage: 1000 })
    const ops = users.find(u => u.email === TEST_USERS.opsAdmin.email)
    const appMetadata = { app_role: 'clinic_admin', clinic_id: ONB_CLINIC }
    const existing = users.find(u => u.email === ONB_ADMIN.email)
    if (existing) {
      const { error } = await supabase.auth.admin.updateUserById(existing.id, { password: ONB_ADMIN.password, app_metadata: appMetadata })
      if (error) throw new Error(`onboarding admin: ${error.message}`)
      adminUserId = existing.id
    } else {
      const { data, error } = await supabase.auth.admin.createUser({ email: ONB_ADMIN.email, password: ONB_ADMIN.password, email_confirm: true, app_metadata: appMetadata })
      if (error || !data.user) throw new Error(`onboarding admin: ${error?.message}`)
      adminUserId = data.user.id
    }

    await supabase.from('onboarding_invites').delete().eq('clinic_id', ONB_CLINIC)
    const { error: inviteErr } = await supabase.from('onboarding_invites').insert({
      kind: 'clinic_admin', clinic_id: ONB_CLINIC, email: ONB_INVITEE, token_hash: hashInviteToken(inviteToken),
      expires_at: inviteExpiresAt().toISOString(), created_by: ops?.id ?? adminUserId!,
    })
    if (inviteErr) throw new Error(`onboarding invite: ${inviteErr.message}`)
  })

  test.afterAll(async () => {
    const supabase = e2eService()
    await supabase.from('onboarding_invites').delete().eq('clinic_id', ONB_CLINIC)
    await supabase.from('clinic_onboarding_steps').delete().eq('clinic_id', ONB_CLINIC)
    if (adminUserId) await supabase.auth.admin.deleteUser(adminUserId)
    await supabase.from('clinics').delete().eq('clinic_id', ONB_CLINIC)
  })

  test('invite page, pending: no violations; focus ring on the submit; reflows at 320px', async ({ page }) => {
    await page.goto(`/onboard/clinic/${inviteToken}`)
    await expect(page.getByRole('heading', { level: 1, name: /A11y Onboarding Clinic/ })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByLabel('Full name')).toBeVisible()
    expect(await axeViolations(page)).toEqual([])
    const submit = page.getByRole('button', { name: 'Create account' })
    await submit.focus()
    expect(await submit.evaluate(el => getComputedStyle(el).boxShadow)).not.toBe('none')
    await expectReflowsAt320(page)
  })

  test('invite page, invalid link: no violations; reflows at 320px', async ({ page }) => {
    await page.goto('/onboard/join/not-a-real-invite-token-0000000000')
    await expect(page.getByRole('heading', { level: 1, name: /not valid/i })).toBeVisible({ timeout: 15_000 })
    expect(await axeViolations(page)).toEqual([])
    await expectReflowsAt320(page)
  })

  test('wizard: every step has no violations and reflows at 320px', async ({ page }) => {
    await signIn(page, ONB_ADMIN.email, ONB_ADMIN.password)
    await page.goto('/onboarding')
    await expect(page.getByRole('heading', { level: 1, name: /Set up A11y Onboarding Clinic/ })).toBeVisible({ timeout: 15_000 })
    const nav = page.getByRole('navigation', { name: 'Onboarding steps' })
    for (const label of WIZARD_STEPS) {
      await page.setViewportSize({ width: 1280, height: 900 })
      await nav.getByRole('button', { name: new RegExp(label) }).click()
      await expect(page.getByRole('heading', { level: 2, name: label })).toBeVisible()
      expect({ step: label, violations: await axeViolations(page) }).toEqual({ step: label, violations: [] })
      await expectReflowsAt320(page)
    }
  })

  test('ops onboarding: the page content has no violations', async ({ page }) => {
    await signIn(page, TEST_USERS.opsAdmin.email, TEST_USERS.opsAdmin.password)
    await page.goto('/ops/onboarding')
    await expect(page.getByRole('heading', { level: 1, name: 'Clinic onboarding' })).toBeVisible({ timeout: 15_000 })
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).include('main').analyze()
    expect(results.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)).toEqual([])
  })
})
