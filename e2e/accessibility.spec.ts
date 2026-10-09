import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { createClient } from '@supabase/supabase-js'
import { generateCheckoutToken } from '../src/lib/auth/checkout-token'
import { cleanupTestOrders, TEST_IDS } from './fixtures/seed'

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
