import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

// ============================================================
// Public legal pages: WCAG 2.1 AA in a real browser
// ============================================================
//
// /legal/privacy and /legal/patient-terms open with no session (no
// redirect to /login), pass axe with the WCAG 2.0/2.1 A and AA tags
// (contrast included) and reflow at 320px. The footer links on /login and
// the expired checkout page lead to them. Nothing is seeded or written.

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

const PAGES = [
  { path: '/legal/privacy',       heading: 'Privacy Policy' },
  { path: '/legal/patient-terms', heading: 'Patient Terms of Use' },
]

async function axeViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
  return results.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)
}

async function expectReflowsAt320(page: Page) {
  await page.setViewportSize({ width: 320, height: 640 })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
}

test.describe('public legal pages', () => {
  for (const p of PAGES) {
    test(`${p.path} opens without a session and passes axe`, async ({ page }) => {
      await page.goto(p.path)
      await expect(page).toHaveURL(new RegExp(`${p.path}$`))
      await expect(page.getByRole('heading', { level: 1, name: p.heading })).toBeVisible()
      await expect(page.getByText('Version 1.0. Effective October 12, 2026.')).toBeVisible()
      await expect(page.locator('main')).not.toContainText(/draft|pending legal review/i)
      expect(await axeViolations(page)).toEqual([])
      await expectReflowsAt320(page)
    })
  }

  for (const from of ['/login', '/checkout/expired']) {
    test(`the footer on ${from} links to both pages`, async ({ page }) => {
      await page.goto(from)
      const legal = page.getByRole('navigation', { name: 'Legal' })
      await expect(legal.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/legal/privacy')
      await legal.getByRole('link', { name: 'Terms of Use' }).click()
      await expect(page.getByRole('heading', { level: 1, name: 'Patient Terms of Use' })).toBeVisible()
    })
  }
})
