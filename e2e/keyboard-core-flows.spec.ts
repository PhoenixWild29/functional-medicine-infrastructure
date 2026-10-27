import { test, expect, type Locator, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { seedStaticData, cleanupTestOrders, cleanupTestFavorites, insertRecentOrder, TEST_IDS, TEST_USERS, TEST_CATALOG } from './fixtures/seed'

// ============================================================
// Keyboard-only core flows (B-2026-10-25-11)
// ============================================================
//
// axe checks markup; this checks that the flows can be finished without
// a mouse. Every control is reached with Tab (tabTo presses Tab until it
// has focus, so an unreachable control fails here) and operated with
// Enter, Space, typing and the arrow keys. No click, no fill, no
// selectOption.
//   1. Sign in, choose the patient, build a prescription in the builder
//      (search, formulation, dose step dropdowns, pharmacy), set the
//      price, on to Review.
//   2. Favorites, Frequently used, Make favorite: the dialog takes focus,
//      Tab stays inside it, Escape closes it and focus returns to the
//      Make favorite button; reopened with Space, "Only for <patient>"
//      chosen with the arrow keys, saved with Enter.
// Native selects are changed with ArrowDown on the focused, closed select
// (Chromium on Linux, which CI runs, changes the value in place).
// Locators are labels, roles and test ids; never getByRole('alert').

const svc = () => createClient(process.env['E2E_SUPABASE_URL']!, process.env['E2E_SUPABASE_SERVICE_ROLE_KEY']!)

const isFocused = (l: Locator) => l.evaluate(el => el === document.activeElement)

/** Tab (forwards) until `target` has focus; fails if it never does. */
async function tabTo(page: Page, target: Locator, max = 150) {
  await expect(target).toBeVisible({ timeout: 15_000 })
  for (let i = 0; i < max; i++) {
    if (await isFocused(target)) return
    await page.keyboard.press('Tab')
  }
  expect(await isFocused(target), 'reachable with Tab').toBe(true)
}

/** ArrowDown on a focused <select> until it holds `value` (or any value when `value` is null). */
async function arrowTo(page: Page, select: Locator, value: string | null, max = 40) {
  await tabTo(page, select)
  for (const key of ['ArrowDown', 'ArrowUp']) {
    for (let i = 0; i < max; i++) {
      const v = await select.inputValue()
      if (value === null ? v !== '' : v === value) return
      await page.keyboard.press(key)
    }
  }
  expect(await select.inputValue()).toBe(value)
}

/** The page never drops focus to <body> at this point. */
async function expectFocusInside(page: Page) {
  expect(await page.evaluate(() => document.activeElement !== null && document.activeElement !== document.body)).toBe(true)
}

async function signInAsProvider(page: Page) {
  await page.goto('/login')
  await tabTo(page, page.getByLabel('Email'))
  await page.keyboard.type(TEST_USERS.provider.email)
  await tabTo(page, page.getByLabel('Password'))
  await page.keyboard.type(TEST_USERS.provider.password)
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 })
}

/** Step 0 for "Patient, Test" (a provider login has no provider list), on to the builder. */
async function startSession(page: Page) {
  await page.goto('/new-prescription')
  await tabTo(page, page.getByLabel('Search patients'))
  await page.keyboard.type('Test')
  await tabTo(page, page.getByRole('button', { name: /Patient,\s*Test/i }))
  await page.keyboard.press('Enter')
  await tabTo(page, page.getByRole('button', { name: 'Continue to Pharmacy Search' }))
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/new-prescription\/search/, { timeout: 10_000 })
}

test.describe('Keyboard-only core flows', () => {
  test.beforeAll(async () => {
    await seedStaticData()
  })

  test.beforeEach(async () => {
    await cleanupTestOrders()
    await cleanupTestFavorites()
  })

  test.afterEach(async () => {
    await cleanupTestOrders()
    await cleanupTestFavorites()
  })

  test('the Rx builder, the price page and Review, with the keyboard only', async ({ page }) => {
    test.setTimeout(120_000)
    await signInAsProvider(page)
    await startSession(page)

    // Search, ingredient, formulation.
    await tabTo(page, page.getByLabel('Search medications'))
    await page.keyboard.type(TEST_CATALOG.ingredientName)
    await tabTo(page, page.getByRole('button', { name: new RegExp(TEST_CATALOG.ingredientName, 'i') }))
    await page.keyboard.press('Enter')
    await tabTo(page, page.getByRole('button', { name: new RegExp(TEST_CATALOG.formulationName, 'i') }))
    await page.keyboard.press('Enter')

    // The dose step: amount typed, the dropdowns with the arrow keys.
    await tabTo(page, page.getByLabel('Dose amount'))
    await page.keyboard.type('10')
    await arrowTo(page, page.getByLabel('Dose unit'), 'mg')
    await arrowTo(page, page.getByLabel('Frequency'), 'QD')
    await arrowTo(page, page.getByLabel('Timing'), null)
    await arrowTo(page, page.getByLabel('Duration'), null)
    await expect(page.getByLabel('Dose unit')).toHaveValue('mg')
    await expect(page.getByLabel('Frequency')).toHaveValue('QD')

    // Pharmacy, then on to the price page.
    await tabTo(page, page.getByRole('button', { name: /Test Pharmacy Tier2/ }))
    await page.keyboard.press('Enter')
    const toPrice = page.getByRole('button', { name: /Continue.*Set Retail Price/i })
    await expect(toPrice).toBeEnabled({ timeout: 10_000 })
    await tabTo(page, toPrice)
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/new-prescription\/margin/, { timeout: 10_000 })

    // The price page: the retail price, then Review.
    await tabTo(page, page.locator('#retail-price'))
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type('200.00')
    await expect(page.locator('#retail-price')).toHaveValue('200.00')
    await tabTo(page, page.getByRole('button', { name: /Review & Send/ }))
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/new-prescription\/review/, { timeout: 10_000 })

    // Review: the line's Rx details open and close with the keyboard.
    const row = page.locator('[data-testid^="rx-details-"]').first()
    await expect(row).toHaveAttribute('data-expanded', 'false', { timeout: 15_000 })
    await tabTo(page, row.getByRole('button', { name: /Rx details/ }))
    await page.keyboard.press('Enter')
    await expect(row).toHaveAttribute('data-expanded', 'true')
    await expect(row.getByLabel('Refills')).toBeVisible()
    await page.keyboard.press('Space')
    await expect(row).toHaveAttribute('data-expanded', 'false')
    await expectFocusInside(page)
  })

  test('Make favorite: the dialog takes focus, keeps Tab inside, closes on Escape with focus back on its opener, and saves for the patient', async ({ page }) => {
    test.setTimeout(120_000)
    await insertRecentOrder({
      formulationId: TEST_IDS.formulation, medicationName: TEST_CATALOG.formulationName,
      prescribedDose: '10 mg', frequencyCode: 'QD',
    })
    await signInAsProvider(page)
    await startSession(page)

    await tabTo(page, page.getByRole('button', { name: /^Favorites \(\d+\)$/ }))
    await page.keyboard.press('Enter')
    const item = page.getByTestId('favorites-frequent').getByTestId('frequent-item').filter({ hasText: TEST_CATALOG.formulationName })
    await expect(item).toHaveCount(1, { timeout: 15_000 })
    const opener = item.getByRole('button', { name: `Make ${TEST_CATALOG.formulationName} a favorite` })
    await tabTo(page, opener)
    await page.keyboard.press('Enter')

    const dialog = page.getByRole('dialog', { name: `Make ${TEST_CATALOG.formulationName} a favorite` })
    await expect(dialog).toBeVisible()
    const focusInDialog = () => dialog.evaluate(d => d.contains(document.activeElement))
    expect(await focusInDialog()).toBe(true)

    // Tab and Shift+Tab never leave it, however far they go.
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press('Tab')
      expect(await focusInDialog(), `Tab ${i + 1} stays in the dialog`).toBe(true)
    }
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press('Shift+Tab')
      expect(await focusInDialog(), `Shift+Tab ${i + 1} stays in the dialog`).toBe(true)
    }

    // Escape closes it; focus is back on Make favorite.
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    expect(await isFocused(opener)).toBe(true)

    // Space reopens it; "Only for <patient>" with the arrow keys; Enter saves.
    await page.keyboard.press('Space')
    await expect(dialog).toBeVisible()
    const practice = dialog.getByRole('radio', { name: 'The practice' })
    await tabTo(page, practice)
    await page.keyboard.press('ArrowDown')
    await expect(dialog.getByRole('radio', { name: /^Only for / })).toBeChecked()
    await tabTo(page, dialog.getByRole('button', { name: 'Save favorite' }))
    await page.keyboard.press('Enter')
    await expect(dialog).toHaveCount(0, { timeout: 10_000 })
    await expectFocusInside(page)

    await expect.poll(async () => {
      const { data } = await svc().from('provider_favorites')
        .select('patient_id')
        .eq('provider_id', TEST_IDS.provider)
        .eq('formulation_id', TEST_IDS.formulation)
      return data ?? []
    }, { timeout: 10_000 }).toEqual([{ patient_id: TEST_IDS.patient }])
  })
})
